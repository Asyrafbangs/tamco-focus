-- ============================================================================
-- v197 — ESH Finding Management: foundations, and nobody in until enabled.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md,
-- intake in docs/esh-finding-management-impact-map.md.
--
-- This stage adds the module's spine and the gate in front of it:
--
--   * one organisation row, carried by every Finding table (spec §8, §21);
--   * the rollout gate (§43): mode Restricted, one entitlement seeded for the
--     uniquely resolved verified identity izzul.asyraf@tamco.com.my, everybody
--     else Off. The gate fails closed: without a rollout row nobody is in;
--   * staff Finding access — Viewer / Coordinator / Verifier, an explicit
--     department scope, report management (§31.1) — kept apart from the Focus
--     role, which this stage does not touch;
--   * findings, their corrective actions, email contacts, ownership intervals,
--     escalation routes, the notification outbox and an append-only audit.
--
-- Guests (email links) arrive in v198: nothing here is reachable without a
-- staff session, and a contact's access starts Off, so every owner email this
-- stage records is held rather than sent.
--
-- Every new table is `esh_` prefixed: Focus already has `routine_findings`,
-- which is a different thing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Organisation
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  name text not null check (length(btrim(name)) > 0),
  timezone text not null default 'Asia/Kuala_Lumpur',
  created_at timestamptz not null default now()
);

insert into public.organizations (id, slug, name)
values ('e5e50000-0000-4000-8000-000000000001', 'tamco', 'TAMCO');

alter table public.organizations enable row level security;

create policy organizations_select on public.organizations
  as permissive for select to authenticated
  using ((select focus.is_active_account()));

-- ---------------------------------------------------------------------------
-- Rollout gate (§43)
-- ---------------------------------------------------------------------------

/*
 * Restricted is the only mode this release knows. A broad launch is a future,
 * explicit decision and a migration that adds its value; there is no date on
 * which this opens by itself and no fallback that enables everybody.
 */
create table public.esh_rollout_settings (
  organization_id uuid primary key references public.organizations (id),
  mode text not null default 'restricted' check (mode = 'restricted'),
  bootstrap_email text not null,
  bootstrap_user_id uuid references public.user_profiles (id),
  bootstrap_outcome text not null check (bootstrap_outcome in ('resolved', 'unresolved')),
  initialized_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.esh_rollout_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Staff Finding access (§31.1, §43.2)
-- ---------------------------------------------------------------------------

create table public.esh_staff_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  user_id uuid not null references public.user_profiles (id),
  -- The rollout entitlement: Off unless an administrator (or the first-setup
  -- seed below) turned it on.
  enabled boolean not null default false,
  preset text not null default 'viewer' check (preset in ('viewer', 'coordinator', 'verifier')),
  -- Never the default: a new permission names its departments (§31.1).
  scope_all_departments boolean not null default false,
  can_manage_reports boolean not null default false,
  authorization_version integer not null default 1,
  -- Null with `enabled` means the rollout's first setup, not an administrator.
  enabled_by uuid references public.user_profiles (id),
  enabled_at timestamptz,
  disabled_by uuid references public.user_profiles (id),
  disabled_at timestamptz,
  updated_by uuid references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id)
);

create table public.esh_staff_access_departments (
  access_id uuid not null references public.esh_staff_access (id) on delete cascade,
  department_id uuid not null references public.departments (id),
  -- Choosing a parent does not silently include its children (§31.1).
  include_descendants boolean not null default false,
  primary key (access_id, department_id)
);

alter table public.esh_staff_access enable row level security;
alter table public.esh_staff_access_departments enable row level security;

/*
 * First setup: the one identity §43.1 names, resolved from trusted server-side
 * data — a confirmed auth address and an active profile — and only if exactly
 * one matches. Anything else leaves the module restricted to nobody and says
 * so in `bootstrap_outcome`, rather than guessing or creating an account.
 *
 * It is organisation-wide visibility and nothing more: §43.1 grants sight, and
 * says in as many words that it does not grant closure authority. Coordinator
 * or Verifier is an administrator's decision in Identity & Access.
 */
do $$
declare
  matches uuid[];
  resolved uuid;
begin
  select coalesce(array_agg(p.id), '{}') into matches
    from public.user_profiles p
    join auth.users u on u.id = p.id
   where lower(btrim(u.email)) = 'izzul.asyraf@tamco.com.my'
     and u.email_confirmed_at is not null
     and p.status = 'active';

  resolved := case when cardinality(matches) = 1 then matches[1] end;

  insert into public.esh_rollout_settings
    (organization_id, bootstrap_email, bootstrap_user_id, bootstrap_outcome)
  values
    ('e5e50000-0000-4000-8000-000000000001', 'izzul.asyraf@tamco.com.my', resolved,
     case when resolved is null then 'unresolved' else 'resolved' end);

  if resolved is not null then
    insert into public.esh_staff_access
      (organization_id, user_id, enabled, preset, scope_all_departments, enabled_at)
    values
      ('e5e50000-0000-4000-8000-000000000001', resolved, true, 'viewer', true, now());
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The central guard
--
-- Every Finding read and write asks these. Access is the intersection of an
-- active account, a readable rollout row and an enabled entitlement; lose any
-- one and the answer is nothing.
-- ---------------------------------------------------------------------------

create or replace function focus.esh_my_access()
returns table (
  organization_id uuid,
  access_id uuid,
  preset text,
  scope_all boolean,
  can_manage_reports boolean,
  authorization_version integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.organization_id, a.id, a.preset, a.scope_all_departments, a.can_manage_reports,
         a.authorization_version
    from public.esh_staff_access a
    join public.esh_rollout_settings r on r.organization_id = a.organization_id
   where a.user_id = auth.uid()
     and a.enabled
     and focus.is_active_account();
$$;

create or replace function focus.esh_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from focus.esh_my_access());
$$;

create or replace function focus.esh_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select organization_id from focus.esh_my_access();
$$;

create or replace function focus.esh_scope_all()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select scope_all from focus.esh_my_access()), false);
$$;

/*
 * Capabilities are cumulative: a Verifier coordinates, a Coordinator views.
 * Report management is separate and grants no finding content by itself.
 */
create or replace function focus.esh_can(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select case p_capability
             when 'view' then true
             when 'coordinate' then a.preset in ('coordinator', 'verifier')
             when 'verify' then a.preset = 'verifier'
             when 'manage_reports' then a.can_manage_reports
             else false
           end
      from focus.esh_my_access() a
  ), false);
$$;

/*
 * The departments the signed-in person may read, as one array: every
 * department for organisation-wide scope, otherwise those chosen plus the
 * descendants of any chosen with `include_descendants`.
 */
create or replace function focus.esh_visible_department_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive me as (
    select * from focus.esh_my_access()
  ),
  chosen as (
    select d.department_id, d.include_descendants
      from public.esh_staff_access_departments d
      join me on d.access_id = me.access_id
  ),
  tree (id, descend) as (
    select c.department_id, c.include_descendants from chosen c
    union
    select child.id, true
      from public.departments child
      join tree on child.parent_id = tree.id
     where tree.descend
  )
  select case
           when not exists (select 1 from me) then '{}'::uuid[]
           when (select scope_all from me) then
             (select coalesce(array_agg(d.id), '{}'::uuid[]) from public.departments d)
           else (select coalesce(array_agg(distinct tree.id), '{}'::uuid[]) from tree)
         end;
$$;

/*
 * What the application reads to decide what to show: the same rows the
 * database enforces, so the screen can never claim an access the server would
 * refuse (§31.1 "Effective access").
 */
create or replace function public.esh_current_access()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select jsonb_build_object(
             'enabled', true,
             'organization_id', a.organization_id,
             'preset', a.preset,
             'scope_all', a.scope_all,
             'can_manage_reports', a.can_manage_reports,
             'authorization_version', a.authorization_version,
             'department_ids', to_jsonb(focus.esh_visible_department_ids()),
             'can_coordinate', a.preset in ('coordinator', 'verifier'),
             'can_verify', a.preset = 'verifier'
           )
      from focus.esh_my_access() a
  ), jsonb_build_object('enabled', false));
$$;

-- ---------------------------------------------------------------------------
-- Email contacts (§8)
-- ---------------------------------------------------------------------------

/*
 * TAMCO's documented comparison rule: surrounding whitespace is not part of an
 * address, and corporate mailboxes are case-insensitive in both parts. Nothing
 * else is normalised — no alias merging, no plus-suffix or dot stripping — and
 * this is the only place the rule lives.
 */
create or replace function focus.esh_canonical_email(p_email text)
returns text
language sql
immutable
as $$
  select lower(btrim(coalesce(p_email, '')));
$$;

create or replace function focus.esh_email_is_valid(p_email text)
returns boolean
language sql
immutable
as $$
  select length(btrim(coalesce(p_email, ''))) between 3 and 254
     and btrim(p_email) ~ '^[^@\s<>(),;:"\[\]]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$';
$$;

create table public.esh_email_principals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  display_email text not null,
  canonical_email text not null,
  display_name text,
  -- Metadata only: a matching staff account never lends a guest its rights.
  staff_user_id uuid references public.user_profiles (id),
  status text not null default 'active' check (status in ('active', 'disabled')),
  -- The contact's rollout entitlement (§43.2). Off until an administrator
  -- enables it; assigning work to an address does not.
  access_enabled boolean not null default false,
  access_enabled_by uuid references public.user_profiles (id),
  access_enabled_at timestamptz,
  identity_version integer not null default 1,
  created_by uuid references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (canonical_email = focus.esh_canonical_email(display_email)),
  check (focus.esh_email_is_valid(display_email)),
  unique (organization_id, canonical_email),
  unique (organization_id, id)
);

alter table public.esh_email_principals enable row level security;

-- ---------------------------------------------------------------------------
-- Findings and corrective actions (§6, §7, §21)
-- ---------------------------------------------------------------------------

create table public.esh_reference_counters (
  organization_id uuid primary key references public.organizations (id),
  next_value integer not null default 1
);

alter table public.esh_reference_counters enable row level security;

create table public.esh_findings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  -- A display identifier, never an authorisation token (§21).
  reference text not null,
  title text not null check (length(btrim(title)) > 0),
  description text,
  source text not null default 'esh_inspection'
    check (source in ('esh_inspection', 'audit', 'incident', 'observation', 'import', 'other')),
  source_reference text,
  reported_on date,
  location text,
  -- Required once assigned; null only while a draft or an unmapped import.
  accountable_department_id uuid references public.departments (id),
  -- The organisation's assessment method is not configured yet (§39), so an
  -- unassessed finding says so rather than defaulting to Low.
  risk_level text not null default 'not_assessed'
    check (risk_level in ('not_assessed', 'low', 'medium', 'high', 'critical')),
  risk_assessed_by uuid references public.user_profiles (id),
  risk_assessed_at timestamptz,
  is_restricted boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft', 'new', 'open', 'closed', 'cancelled', 'duplicate', 'withdrawn')),
  status_reason text,
  closed_at timestamptz,
  closed_by uuid references public.user_profiles (id),
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  row_version integer not null default 1,
  check (status = 'draft' or accountable_department_id is not null or source = 'import'),
  check (status not in ('cancelled', 'duplicate', 'withdrawn') or length(btrim(coalesce(status_reason, ''))) > 0),
  unique (organization_id, reference),
  unique (organization_id, id)
);

create index esh_findings_org_status_idx on public.esh_findings (organization_id, status);
create index esh_findings_department_idx on public.esh_findings (accountable_department_id);

create table public.esh_finding_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  finding_id uuid not null,
  sequence smallint not null default 1,
  title text not null check (length(btrim(title)) > 0),
  required_outcome text,
  evidence_instruction text,
  -- New actions need a result and at least one file (§12); an exception is a
  -- deliberate ESH decision with a reason.
  evidence_rule text not null default 'file_required'
    check (evidence_rule in ('file_required', 'no_file_exception')),
  evidence_exception_reason text,
  priority text check (priority in ('urgent', 'high', 'normal')),
  state text not null default 'draft'
    check (state in ('draft', 'assigned', 'in_progress', 'awaiting_verification', 'accepted', 'cancelled')),
  owner_principal_id uuid,
  assignment_version integer not null default 0,
  baseline_due_at timestamptz,
  due_at timestamptz,
  due_is_date_only boolean not null default true,
  -- A named ESH reviewer, or null for the Verification queue as a group.
  reviewer_user_id uuid references public.user_profiles (id),
  no_further_escalation_reason text,
  -- What a draft remembers before anything is committed: addresses are not
  -- contacts until the work is actually assigned (§8).
  draft_owner_email text,
  draft_escalation jsonb not null default '[]'::jsonb,
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  assigned_at timestamptz,
  accepted_at timestamptz,
  row_version integer not null default 1,
  foreign key (organization_id, finding_id) references public.esh_findings (organization_id, id),
  foreign key (organization_id, owner_principal_id)
    references public.esh_email_principals (organization_id, id),
  check (evidence_rule = 'file_required' or length(btrim(coalesce(evidence_exception_reason, ''))) > 0),
  check (state = 'draft' or (owner_principal_id is not null and due_at is not null
                             and priority is not null and required_outcome is not null)),
  unique (finding_id, sequence),
  unique (organization_id, id)
);

create index esh_actions_owner_state_due_idx
  on public.esh_finding_actions (organization_id, owner_principal_id, state, due_at);
create index esh_actions_finding_idx on public.esh_finding_actions (finding_id);

create table public.esh_action_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  principal_id uuid not null,
  version integer not null check (version > 0),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  assigned_by uuid not null references public.user_profiles (id),
  reason text,
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  foreign key (organization_id, principal_id) references public.esh_email_principals (organization_id, id),
  unique (action_id, version)
);

-- At most one current owner per action (§21).
create unique index esh_one_current_owner
  on public.esh_action_assignments (action_id) where ended_at is null;

create table public.esh_action_escalation_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  level smallint not null check (level between 1 and 9),
  principal_id uuid not null,
  added_by uuid not null references public.user_profiles (id),
  added_at timestamptz not null default now(),
  removed_by uuid references public.user_profiles (id),
  removed_at timestamptz,
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  foreign key (organization_id, principal_id) references public.esh_email_principals (organization_id, id)
);

create unique index esh_escalation_unique_live
  on public.esh_action_escalation_recipients (action_id, level, principal_id)
  where removed_at is null;

alter table public.esh_findings enable row level security;
alter table public.esh_finding_actions enable row level security;
alter table public.esh_action_assignments enable row level security;
alter table public.esh_action_escalation_recipients enable row level security;

-- ---------------------------------------------------------------------------
-- Notification outbox (§17, §22)
--
-- The business transaction records who must be told and why; dispatch happens
-- after commit (v198). No bearer token is ever stored here: `link_intents`
-- names the grants to mint at send time.
-- ---------------------------------------------------------------------------

create table public.esh_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  event_type text not null check (event_type in ('owner_assignment')),
  recipient_principal_id uuid,
  finding_id uuid,
  action_id uuid,
  -- `held_rollout` is its own state (§43.4): neither a failure, nor a bounce,
  -- nor a delivery, and never shown as the owner ignoring anything.
  state text not null
    check (state in ('held_rollout', 'queued', 'processing', 'provider_accepted', 'failed', 'suppressed', 'cancelled')),
  link_intents jsonb not null default '[]'::jsonb,
  idempotency_key text not null unique,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (organization_id, recipient_principal_id)
    references public.esh_email_principals (organization_id, id),
  foreign key (organization_id, finding_id) references public.esh_findings (organization_id, id),
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id)
);

create index esh_outbox_state_idx on public.esh_notification_outbox (state, next_attempt_at);

alter table public.esh_notification_outbox enable row level security;

-- ---------------------------------------------------------------------------
-- Audit (§21): append-only, and actors may be staff, contacts or the system.
-- ---------------------------------------------------------------------------

create table public.esh_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  occurred_at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('staff', 'principal', 'system')),
  actor_user_id uuid references public.user_profiles (id),
  actor_principal_id uuid,
  event_type text not null,
  finding_id uuid,
  action_id uuid,
  subject_user_id uuid references public.user_profiles (id),
  subject_principal_id uuid,
  detail jsonb not null default '{}'::jsonb
);

create index esh_audit_finding_idx on public.esh_audit_events (finding_id, occurred_at);

create trigger esh_audit_events_no_update
  before update on public.esh_audit_events
  for each row execute function focus.reject_audit_mutation();
create trigger esh_audit_events_no_delete
  before delete on public.esh_audit_events
  for each row execute function focus.reject_audit_mutation();

alter table public.esh_audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Read policies. Nothing is written directly: every change goes through a
-- procedure below, so no insert, update or delete policy exists.
-- ---------------------------------------------------------------------------

create policy esh_rollout_settings_select on public.esh_rollout_settings
  as permissive for select to authenticated
  using ((select focus.is_admin()) or (select focus.esh_enabled()));

create policy esh_staff_access_select on public.esh_staff_access
  as permissive for select to authenticated
  using (user_id = (select auth.uid()) or (select focus.is_admin()));

create policy esh_staff_access_departments_select on public.esh_staff_access_departments
  as permissive for select to authenticated
  using (access_id in (select a.id from public.esh_staff_access a));

create policy esh_email_principals_select on public.esh_email_principals
  as permissive for select to authenticated
  using ((select focus.esh_enabled()) and organization_id = (select focus.esh_organization_id()));

/*
 * A finding is read within scope. Drafts are unfinished work: only those who
 * could finish them — coordinators in scope, and whoever started one — see
 * them. A finding with no department yet belongs to organisation-wide scope.
 */
create policy esh_findings_select on public.esh_findings
  as permissive for select to authenticated
  using (
    (select focus.esh_enabled())
    and organization_id = (select focus.esh_organization_id())
    and (
      (select focus.esh_scope_all())
      or accountable_department_id = any ((select focus.esh_visible_department_ids())::uuid[])
      or (status = 'draft' and created_by = (select auth.uid()))
    )
    and (status <> 'draft' or (select focus.esh_can('coordinate')))
  );

create policy esh_finding_actions_select on public.esh_finding_actions
  as permissive for select to authenticated
  using (finding_id in (select f.id from public.esh_findings f));

create policy esh_action_assignments_select on public.esh_action_assignments
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));

create policy esh_action_escalation_recipients_select on public.esh_action_escalation_recipients
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));

-- Whoever may read a finding may see whether its owner has been told: the
-- register's Needs attention must mean the same thing to every reader.
create policy esh_notification_outbox_select on public.esh_notification_outbox
  as permissive for select to authenticated
  using (finding_id in (select f.id from public.esh_findings f));

create policy esh_audit_events_select on public.esh_audit_events
  as permissive for select to authenticated
  using (
    (finding_id is not null and finding_id in (select f.id from public.esh_findings f))
    or (finding_id is null and (select focus.is_admin()))
  );

/*
 * The register, as one definition (§24).
 *
 * Every list, count and filter reads this view, so a number on one screen and
 * the rows behind it can never disagree. `security_invoker`: it shows only
 * what the reader's own policies already allow.
 *
 * Last update is the last meaningful event — something a person did — never a
 * reminder the system sent (§24).
 */
create view public.esh_register_rows
with (security_invoker = true)
as
select f.id as finding_id,
       f.organization_id,
       f.reference,
       f.title,
       f.location,
       f.status,
       f.is_restricted,
       f.risk_level,
       f.accountable_department_id,
       d.name as department_name,
       f.created_at,
       f.closed_at,
       a.id as action_id,
       a.state as action_state,
       a.priority,
       a.due_at,
       a.due_is_date_only,
       (select count(*) from public.esh_finding_actions x where x.finding_id = f.id) as action_count,
       p.display_email as owner_email,
       coalesce(held.any_held, false) as notification_held,
       coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false) as is_overdue,
       (f.status in ('draft', 'new')
        or (f.status = 'open'
            and (coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false)
                 or coalesce(held.any_held, false)))) as needs_attention,
       coalesce(latest.occurred_at, f.created_at) as last_update_at,
       coalesce(latest.event_type, 'finding_created') as last_update_type
  from public.esh_findings f
  left join public.departments d on d.id = f.accountable_department_id
  left join lateral (
    select * from public.esh_finding_actions x
     where x.finding_id = f.id
     order by x.sequence
     limit 1
  ) a on true
  left join public.esh_email_principals p on p.id = a.owner_principal_id
  left join lateral (
    select true as any_held
      from public.esh_notification_outbox o
     where o.action_id = a.id and o.state = 'held_rollout'
     limit 1
  ) held on true
  left join lateral (
    select e.occurred_at, e.event_type
      from public.esh_audit_events e
     where e.finding_id = f.id
       and e.event_type in ('finding_created', 'action_assigned')
     -- Events in one transaction share a timestamp; the later step wins.
     order by e.occurred_at desc,
              array_position(array['action_assigned', 'finding_created'], e.event_type)
     limit 1
  ) latest on true;

revoke all on public.organizations, public.esh_rollout_settings, public.esh_staff_access,
  public.esh_staff_access_departments, public.esh_email_principals, public.esh_reference_counters,
  public.esh_findings, public.esh_finding_actions, public.esh_action_assignments,
  public.esh_action_escalation_recipients, public.esh_notification_outbox, public.esh_audit_events,
  public.esh_register_rows
  from anon, authenticated;

grant select on public.organizations, public.esh_rollout_settings, public.esh_staff_access,
  public.esh_staff_access_departments, public.esh_email_principals, public.esh_findings,
  public.esh_finding_actions, public.esh_action_assignments,
  public.esh_action_escalation_recipients, public.esh_notification_outbox, public.esh_audit_events,
  public.esh_register_rows
  to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers used by the procedures
-- ---------------------------------------------------------------------------

create or replace function focus.esh_next_reference(p_organization_id uuid)
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.esh_reference_counters as c (organization_id, next_value)
  values (p_organization_id, 2)
  on conflict (organization_id) do update set next_value = c.next_value + 1
  returning 'F-' || lpad((next_value - 1)::text, 3, '0');
$$;

/*
 * The contact for an address, created on first use (§8): assignment is how a
 * new contact comes into being, and it is not an account.
 */
create or replace function focus.esh_principal_for(
  p_organization_id uuid,
  p_email text,
  p_actor uuid
)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.esh_email_principals as p
    (organization_id, display_email, canonical_email, created_by)
  values
    (p_organization_id, btrim(p_email), focus.esh_canonical_email(p_email), p_actor)
  on conflict (organization_id, canonical_email) do update set updated_at = p.updated_at
  returning id;
$$;

/*
 * A due date without a time means 17:00 in the organisation's zone (§16's
 * proposed default), stored as the instant it is.
 */
create or replace function focus.esh_due_instant(
  p_organization_id uuid,
  p_due_date date,
  p_due_time time
)
returns timestamptz
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ((p_due_date + coalesce(p_due_time, time '17:00'))::timestamp
          at time zone (select o.timezone from public.organizations o where o.id = p_organization_id));
$$;

-- ---------------------------------------------------------------------------
-- Staff access (administrators, §43.2)
-- ---------------------------------------------------------------------------

/*
 * Enable, change or disable one person's Finding access.
 *
 * Maintaining access is an administrator's job; it grants the administrator
 * nothing (§43.1, FM59). Each save is audited and bumps the authorisation
 * version, so anything cached against the old answer can tell it is stale.
 */
create or replace function public.esh_set_staff_access(
  p_user_id uuid,
  p_enabled boolean,
  p_preset text,
  p_scope_all boolean,
  p_department_ids uuid[],
  p_include_descendants boolean default false,
  p_can_manage_reports boolean default false,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid;
  target public.user_profiles%rowtype;
  before_row public.esh_staff_access%rowtype;
  after_row public.esh_staff_access%rowtype;
  before_departments uuid[];
  departments uuid[] := coalesce(p_department_ids, '{}');
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if not focus.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  -- Fail closed: without the rollout row there is nothing to grant into.
  select organization_id into org from public.esh_rollout_settings limit 1;
  if org is null then
    return jsonb_build_object('ok', false, 'code', 'rollout_not_configured');
  end if;

  select * into target from public.user_profiles where id = p_user_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  if p_enabled and target.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'account_not_active');
  end if;
  if p_preset not in ('viewer', 'coordinator', 'verifier') then
    return jsonb_build_object('ok', false, 'code', 'preset_invalid');
  end if;
  if p_enabled and not coalesce(p_scope_all, false) and cardinality(departments) = 0 then
    return jsonb_build_object('ok', false, 'code', 'scope_required');
  end if;
  if exists (
    select 1 from unnest(departments) d(id)
     where not exists (select 1 from public.departments x where x.id = d.id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'department_not_found');
  end if;

  select * into before_row from public.esh_staff_access
   where organization_id = org and user_id = p_user_id;
  select coalesce(array_agg(department_id order by department_id), '{}') into before_departments
    from public.esh_staff_access_departments where access_id = before_row.id;

  insert into public.esh_staff_access as a
    (organization_id, user_id, enabled, preset, scope_all_departments, can_manage_reports,
     enabled_by, enabled_at, updated_by)
  values
    (org, p_user_id, p_enabled, p_preset, coalesce(p_scope_all, false),
     coalesce(p_can_manage_reports, false),
     case when p_enabled then actor end, case when p_enabled then now() end, actor)
  on conflict (organization_id, user_id) do update set
    enabled = excluded.enabled,
    preset = excluded.preset,
    scope_all_departments = excluded.scope_all_departments,
    can_manage_reports = excluded.can_manage_reports,
    authorization_version = a.authorization_version + 1,
    enabled_by = case when excluded.enabled and not a.enabled then actor else a.enabled_by end,
    enabled_at = case when excluded.enabled and not a.enabled then now() else a.enabled_at end,
    disabled_by = case when not excluded.enabled and a.enabled then actor else a.disabled_by end,
    disabled_at = case when not excluded.enabled and a.enabled then now() else a.disabled_at end,
    updated_by = actor,
    updated_at = now()
  returning * into after_row;

  delete from public.esh_staff_access_departments where access_id = after_row.id;
  if not after_row.scope_all_departments then
    insert into public.esh_staff_access_departments (access_id, department_id, include_descendants)
    select after_row.id, d.id, coalesce(p_include_descendants, false)
      from (select distinct unnest(departments) as id) d;
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, subject_user_id, detail)
  values
    (org, 'staff', actor, 'staff_access_changed', p_user_id,
     jsonb_build_object(
       'reason', nullif(btrim(coalesce(p_reason, '')), ''),
       'before', case when before_row.id is null then null else jsonb_build_object(
         'enabled', before_row.enabled, 'preset', before_row.preset,
         'scope_all', before_row.scope_all_departments,
         'department_ids', to_jsonb(before_departments),
         'can_manage_reports', before_row.can_manage_reports) end,
       'after', jsonb_build_object(
         'enabled', after_row.enabled, 'preset', after_row.preset,
         'scope_all', after_row.scope_all_departments,
         'department_ids', case when after_row.scope_all_departments then '[]'::jsonb
                                else to_jsonb((select array_agg(distinct x order by x) from unnest(departments) x)) end,
         'can_manage_reports', after_row.can_manage_reports),
       'authorization_version', after_row.authorization_version));

  return jsonb_build_object(
    'ok', true,
    'enabled', after_row.enabled,
    'preset', after_row.preset,
    'authorization_version', after_row.authorization_version);
end;
$$;

-- ---------------------------------------------------------------------------
-- Findings: save a draft, or assign (§7)
-- ---------------------------------------------------------------------------

/*
 * One procedure for the one form: Save draft keeps whatever is there, Assign
 * commits the finding, its action, the owner's contact and ownership interval,
 * the escalation route, the audit and the owner's notification together (§7,
 * §22). Nothing is sent from here — the outbox row is the promise to send, and
 * during the restricted rollout it is held (§43.4).
 *
 * p_payload fields: title, description, source, source_reference, reported_on
 * (YYYY-MM-DD), location, accountable_department_id, risk_level,
 * is_restricted, action_title, required_outcome, evidence_instruction,
 * priority, owner_email, due_date (YYYY-MM-DD), due_time (HH:MM, optional),
 * reviewer_user_id, escalation ([{level, email}]), no_further_escalation_reason.
 */
create or replace function public.esh_save_finding(
  p_finding_id uuid,
  p_payload jsonb,
  p_assign boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  prior jsonb;
  existing public.esh_findings%rowtype;
  existing_action public.esh_finding_actions%rowtype;
  v_finding_id uuid;
  v_action_id uuid;
  v_reference text;
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_description text := nullif(btrim(coalesce(p_payload->>'description', '')), '');
  v_source text := coalesce(nullif(p_payload->>'source', ''), 'esh_inspection');
  v_source_reference text := nullif(btrim(coalesce(p_payload->>'source_reference', '')), '');
  v_location text := nullif(btrim(coalesce(p_payload->>'location', '')), '');
  v_department uuid;
  v_risk text := coalesce(nullif(p_payload->>'risk_level', ''), 'not_assessed');
  v_restricted boolean := coalesce((p_payload->>'is_restricted')::boolean, false);
  v_action_title text := nullif(btrim(coalesce(p_payload->>'action_title', '')), '');
  v_outcome text := nullif(btrim(coalesce(p_payload->>'required_outcome', '')), '');
  v_instruction text := nullif(btrim(coalesce(p_payload->>'evidence_instruction', '')), '');
  v_priority text := nullif(p_payload->>'priority', '');
  v_owner_email text := nullif(btrim(coalesce(p_payload->>'owner_email', '')), '');
  v_reviewer uuid;
  v_no_escalation text := nullif(btrim(coalesce(p_payload->>'no_further_escalation_reason', '')), '');
  v_escalation jsonb := coalesce(p_payload->'escalation', '[]'::jsonb);
  v_reported_on date;
  v_due_date date;
  v_due_time time;
  v_due timestamptz;
  owner_principal uuid;
  owner_contact public.esh_email_principals%rowtype;
  problems text[] := '{}';
  warnings text[] := '{}';
  entry jsonb;
  seen text[] := '{}';
  entry_key text;
  levels int[] := '{}';
  level_no int;
  esc_principal uuid;
  reviewer_profile public.user_profiles%rowtype;
  outbox_state text;
  v_result jsonb;
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  if p_idempotency_key is not null then
    select l.result into prior from public.operation_log l
     where l.actor_id = actor and l.idempotency_key = p_idempotency_key;
    if found then
      return prior;
    end if;
  end if;

  -- Parse what arrived, recording what did not parse rather than raising.
  begin
    v_department := nullif(p_payload->>'accountable_department_id', '')::uuid;
  exception when others then
    problems := array_append(problems, 'department_invalid');
  end;
  begin
    v_reviewer := nullif(p_payload->>'reviewer_user_id', '')::uuid;
  exception when others then
    problems := array_append(problems, 'reviewer_invalid');
  end;
  begin
    v_reported_on := nullif(p_payload->>'reported_on', '')::date;
  exception when others then
    problems := array_append(problems, 'reported_on_invalid');
  end;
  begin
    v_due_date := nullif(p_payload->>'due_date', '')::date;
  exception when others then
    problems := array_append(problems, 'due_date_invalid');
  end;
  begin
    v_due_time := nullif(p_payload->>'due_time', '')::time;
  exception when others then
    problems := array_append(problems, 'due_time_invalid');
  end;

  if length(v_title) = 0 then
    problems := array_append(problems, 'title_required');
  end if;
  if v_source not in ('esh_inspection', 'audit', 'incident', 'observation', 'other') then
    problems := array_append(problems, 'source_invalid');
  end if;
  if v_risk not in ('not_assessed', 'low', 'medium', 'high', 'critical') then
    problems := array_append(problems, 'risk_invalid');
  end if;
  if v_priority is not null and v_priority not in ('urgent', 'high', 'normal') then
    problems := array_append(problems, 'priority_invalid');
  end if;
  if v_owner_email is not null and not focus.esh_email_is_valid(v_owner_email) then
    problems := array_append(problems, 'owner_email_invalid');
  end if;
  if jsonb_typeof(v_escalation) <> 'array' then
    problems := array_append(problems, 'escalation_invalid');
    v_escalation := '[]'::jsonb;
  end if;

  -- Scope: a coordinator files work only in departments they may read.
  if v_department is not null then
    if not exists (select 1 from public.departments d where d.id = v_department) then
      problems := array_append(problems, 'department_not_found');
    elsif not (v_department = any (focus.esh_visible_department_ids())) then
      problems := array_append(problems, 'department_out_of_scope');
    end if;
  end if;

  -- The escalation route: valid addresses, levels from 1 without gaps,
  -- duplicates at one level dropped.
  for entry in select value from jsonb_array_elements(v_escalation) loop
    begin
      level_no := (entry->>'level')::int;
    exception when others then
      level_no := null;
    end;
    if level_no is null or level_no < 1 or level_no > 9 then
      problems := array_append(problems, 'escalation_level_invalid');
      continue;
    end if;
    if not focus.esh_email_is_valid(entry->>'email') then
      problems := array_append(problems, 'escalation_email_invalid');
      continue;
    end if;
    entry_key := level_no::text || ':' || focus.esh_canonical_email(entry->>'email');
    if entry_key = any (seen) then
      continue;
    end if;
    seen := seen || entry_key;
    if not (level_no = any (levels)) then
      levels := levels || level_no;
    end if;
    if v_owner_email is not null
       and focus.esh_canonical_email(entry->>'email') = focus.esh_canonical_email(v_owner_email) then
      warnings := array_append(warnings, 'owner_is_escalation_recipient');
    end if;
  end loop;
  if cardinality(levels) > 0 and (select max(l) from unnest(levels) l) <> cardinality(levels) then
    problems := array_append(problems, 'escalation_levels_have_gaps');
  end if;

  if v_reviewer is not null then
    select p.* into reviewer_profile
      from public.user_profiles p
      join public.esh_staff_access a on a.user_id = p.id and a.organization_id = org
     where p.id = v_reviewer and p.status = 'active' and a.enabled and a.preset = 'verifier';
    if not found then
      problems := array_append(problems, 'reviewer_not_verifier');
    elsif v_owner_email is not null
          and focus.esh_canonical_email(reviewer_profile.email) = focus.esh_canonical_email(v_owner_email) then
      -- An owner never verifies their own correction (§5).
      problems := array_append(problems, 'reviewer_is_owner');
    end if;
  end if;

  if p_assign then
    if v_description is null then problems := array_append(problems, 'description_required'); end if;
    if v_department is null then problems := array_append(problems, 'department_required'); end if;
    if v_reported_on is null then problems := array_append(problems, 'reported_on_required'); end if;
    if v_outcome is null then problems := array_append(problems, 'required_outcome_required'); end if;
    if v_priority is null then problems := array_append(problems, 'priority_required'); end if;
    if v_owner_email is null then problems := array_append(problems, 'owner_email_required'); end if;
    if v_due_date is null then problems := array_append(problems, 'due_date_required'); end if;
    if cardinality(levels) = 0 and v_no_escalation is null then
      problems := array_append(problems, 'escalation_decision_required');
    end if;
    if v_due_date is not null and v_reported_on is not null and v_due_date < v_reported_on then
      problems := array_append(problems, 'due_before_reported');
    end if;
  end if;

  if cardinality(problems) > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid',
      'problems', to_jsonb((select array_agg(distinct x) from unnest(problems) x)));
  end if;

  -- An existing draft: only a draft is edited here, and only by someone who
  -- can see it.
  if p_finding_id is not null then
    select * into existing from public.esh_findings
     where id = p_finding_id and organization_id = org
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    if existing.status <> 'draft' then
      return jsonb_build_object('ok', false, 'code', 'not_a_draft');
    end if;
    if not (existing.created_by = actor or focus.esh_scope_all()
            or existing.accountable_department_id = any (focus.esh_visible_department_ids())) then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    select * into existing_action from public.esh_finding_actions
     where finding_id = existing.id and sequence = 1
     for update;
  end if;

  if v_due_date is not null then
    v_due := focus.esh_due_instant(org, v_due_date, v_due_time);
  end if;

  if existing.id is null then
    v_reference := focus.esh_next_reference(org);
    insert into public.esh_findings
      (organization_id, reference, title, description, source, source_reference, reported_on,
       location, accountable_department_id, risk_level, is_restricted, status, created_by,
       risk_assessed_by, risk_assessed_at)
    values
      (org, v_reference, v_title, v_description, v_source, v_source_reference, v_reported_on,
       v_location, v_department, v_risk, v_restricted, 'draft', actor,
       case when v_risk <> 'not_assessed' then actor end,
       case when v_risk <> 'not_assessed' then now() end)
    returning id into v_finding_id;

    insert into public.esh_finding_actions
      (organization_id, finding_id, sequence, title, required_outcome, evidence_instruction,
       priority, due_at, due_is_date_only, reviewer_user_id, no_further_escalation_reason,
       draft_owner_email, draft_escalation, created_by)
    values
      (org, v_finding_id, 1, coalesce(v_action_title, v_title), v_outcome, v_instruction,
       v_priority, v_due, v_due_time is null, v_reviewer, v_no_escalation,
       v_owner_email, v_escalation, actor)
    returning id into v_action_id;

    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
    values
      (org, 'staff', actor, 'finding_created', v_finding_id, v_action_id,
       jsonb_build_object('reference', v_reference, 'title', v_title));
  else
    v_finding_id := existing.id;
    v_reference := existing.reference;
    update public.esh_findings set
      title = v_title,
      description = v_description,
      source = v_source,
      source_reference = v_source_reference,
      reported_on = v_reported_on,
      location = v_location,
      accountable_department_id = v_department,
      risk_level = v_risk,
      risk_assessed_by = case when v_risk <> risk_level then
                           case when v_risk = 'not_assessed' then null else actor end
                         else risk_assessed_by end,
      risk_assessed_at = case when v_risk <> risk_level then
                           case when v_risk = 'not_assessed' then null else now() end
                         else risk_assessed_at end,
      is_restricted = v_restricted,
      updated_at = now(),
      row_version = row_version + 1
     where id = existing.id;

    update public.esh_finding_actions set
      title = coalesce(v_action_title, v_title),
      required_outcome = v_outcome,
      evidence_instruction = v_instruction,
      priority = v_priority,
      due_at = v_due,
      due_is_date_only = v_due_time is null,
      reviewer_user_id = v_reviewer,
      no_further_escalation_reason = v_no_escalation,
      draft_owner_email = v_owner_email,
      draft_escalation = v_escalation,
      updated_at = now(),
      row_version = row_version + 1
     where id = existing_action.id
    returning id into v_action_id;

    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
    values
      (org, 'staff', actor, 'finding_draft_saved', v_finding_id, v_action_id, '{}'::jsonb);
  end if;

  if not p_assign then
    v_result := jsonb_build_object(
      'ok', true, 'finding_id', v_finding_id, 'action_id', v_action_id,
      'reference', v_reference, 'status', 'draft',
      'warnings', to_jsonb((select coalesce(array_agg(distinct x), '{}') from unnest(warnings) x)));
    return focus.remember_operation(actor, p_idempotency_key, 'esh_save_finding', v_result);
  end if;

  -- Assign: the contact, the ownership interval, the route, the promise to
  -- notify — together, or not at all.
  owner_principal := focus.esh_principal_for(org, v_owner_email, actor);
  select * into owner_contact from public.esh_email_principals where id = owner_principal;

  update public.esh_findings set status = 'open', updated_at = now(), row_version = row_version + 1
   where id = v_finding_id;

  update public.esh_finding_actions set
    state = 'assigned',
    owner_principal_id = owner_principal,
    assignment_version = 1,
    baseline_due_at = v_due,
    due_at = v_due,
    assigned_at = now(),
    draft_owner_email = null,
    draft_escalation = '[]'::jsonb,
    updated_at = now(),
    row_version = row_version + 1
   where id = v_action_id;

  insert into public.esh_action_assignments
    (organization_id, action_id, principal_id, version, assigned_by)
  values (org, v_action_id, owner_principal, 1, actor);

  for entry in select value from jsonb_array_elements(v_escalation) loop
    esc_principal := focus.esh_principal_for(org, entry->>'email', actor);
    insert into public.esh_action_escalation_recipients
      (organization_id, action_id, level, principal_id, added_by)
    values (org, v_action_id, (entry->>'level')::smallint, esc_principal, actor)
    on conflict (action_id, level, principal_id) where removed_at is null do nothing;
  end loop;

  -- Held while this contact's access is off (§43.4): the rollout, not the
  -- owner, is why nothing was sent.
  outbox_state := case
                    when owner_contact.status = 'active' and owner_contact.access_enabled then 'queued'
                    else 'held_rollout'
                  end;
  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
     link_intents, idempotency_key, next_attempt_at)
  values
    (org, 'owner_assignment', owner_principal, v_finding_id, v_action_id, outbox_state,
     '["owner_action", "owner_inbox"]'::jsonb,
     'owner_assignment:' || v_action_id || ':1',
     case when outbox_state = 'queued' then now() end);

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id,
     subject_principal_id, detail)
  values
    (org, 'staff', actor, 'action_assigned', v_finding_id, v_action_id, owner_principal,
     jsonb_build_object(
       'owner_email', owner_contact.display_email,
       'due_at', v_due,
       'priority', v_priority,
       'escalation_levels', to_jsonb(levels),
       'no_further_escalation_reason', v_no_escalation,
       'notification', outbox_state));

  v_result := jsonb_build_object(
    'ok', true, 'finding_id', v_finding_id, 'action_id', v_action_id,
    'reference', v_reference, 'status', 'open', 'notification', outbox_state,
    'warnings', to_jsonb((select coalesce(array_agg(distinct x), '{}') from unnest(warnings) x)));
  return focus.remember_operation(actor, p_idempotency_key, 'esh_save_finding', v_result);
end;
$$;

/*
 * Who can be named as a finding's ESH reviewer: enabled Verifiers, names only,
 * and only for someone who is choosing one. Access rows themselves stay
 * readable to their owner and to administrators alone.
 */
create or replace function public.esh_list_verifiers()
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.full_name, p.email
    from public.esh_staff_access a
    join public.user_profiles p on p.id = a.user_id
   where focus.esh_can('coordinate')
     and a.organization_id = focus.esh_organization_id()
     and a.enabled
     and a.preset = 'verifier'
     and p.status = 'active'
   order by p.full_name;
$$;

-- ---------------------------------------------------------------------------
-- Grants: the guard helpers are called from policies as the reader; the
-- procedures are the only way in for writes.
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_my_access() from public, anon;
revoke all on function focus.esh_enabled() from public, anon;
revoke all on function focus.esh_organization_id() from public, anon;
revoke all on function focus.esh_scope_all() from public, anon;
revoke all on function focus.esh_can(text) from public, anon;
revoke all on function focus.esh_visible_department_ids() from public, anon;
revoke all on function focus.esh_next_reference(uuid) from public, anon, authenticated;
revoke all on function focus.esh_principal_for(uuid, text, uuid) from public, anon, authenticated;
revoke all on function focus.esh_due_instant(uuid, date, time) from public, anon, authenticated;
revoke all on function public.esh_current_access() from public, anon;
revoke all on function public.esh_set_staff_access(uuid, boolean, text, boolean, uuid[], boolean, boolean, text)
  from public, anon;
revoke all on function public.esh_save_finding(uuid, jsonb, boolean, text) from public, anon;
revoke all on function public.esh_list_verifiers() from public, anon;

grant execute on function focus.esh_my_access() to authenticated, service_role;
grant execute on function focus.esh_enabled() to authenticated, service_role;
grant execute on function focus.esh_organization_id() to authenticated, service_role;
grant execute on function focus.esh_scope_all() to authenticated, service_role;
grant execute on function focus.esh_can(text) to authenticated, service_role;
grant execute on function focus.esh_visible_department_ids() to authenticated, service_role;
grant execute on function focus.esh_canonical_email(text) to authenticated, service_role;
grant execute on function focus.esh_email_is_valid(text) to authenticated, service_role;
grant execute on function public.esh_current_access() to authenticated;
grant execute on function public.esh_set_staff_access(uuid, boolean, text, boolean, uuid[], boolean, boolean, text)
  to authenticated;
grant execute on function public.esh_save_finding(uuid, jsonb, boolean, text) to authenticated;
grant execute on function public.esh_list_verifiers() to authenticated;
