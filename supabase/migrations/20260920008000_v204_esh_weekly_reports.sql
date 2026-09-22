-- ============================================================================
-- v204 — configured weekly Finding Management reports (§32-§37, FM64-FM82).
--
-- A report is a versioned definition, a transactionally consistent immutable
-- snapshot, and one separately authorised delivery per recipient. Report links
-- are not Action Owner links: they mint a report_viewer grant and a session
-- entitlement that can read only one run. Every read re-checks the definition,
-- recipient and scope versions. Restricted findings are never copied.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Definitions, scopes, recipients and immutable runs
-- ---------------------------------------------------------------------------

create table public.esh_report_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  name text not null check (length(btrim(name)) between 1 and 120),
  state text not null default 'draft' check (state in ('draft', 'active', 'paused')),
  timezone text not null default 'Asia/Kuala_Lumpur',
  schedule_isodow smallint not null default 1 check (schedule_isodow between 1 and 7),
  schedule_local_time time not null default '08:30',
  organization_wide boolean not null default false,
  include_descendants boolean not null default true,
  version integer not null default 1 check (version > 0),
  scope_version integer not null default 1 check (scope_version > 0),
  last_failure text,
  last_failed_at timestamptz,
  created_by uuid not null references public.user_profiles (id),
  updated_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.esh_report_departments (
  report_definition_id uuid not null references public.esh_report_definitions (id) on delete cascade,
  department_id uuid not null references public.departments (id),
  primary key (report_definition_id, department_id)
);

create table public.esh_report_recipients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  report_definition_id uuid not null references public.esh_report_definitions (id) on delete cascade,
  principal_id uuid not null,
  enabled boolean not null default true,
  entitlement_version integer not null default 1 check (entitlement_version > 0),
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, principal_id)
    references public.esh_email_principals (organization_id, id),
  unique (report_definition_id, principal_id),
  unique (organization_id, id)
);

create table public.esh_report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  report_definition_id uuid not null references public.esh_report_definitions (id),
  definition_name text not null,
  definition_version integer not null,
  scope_version integer not null,
  timezone text not null,
  cycle_local_date date not null,
  captured_at timestamptz not null default now(),
  closed_window_start timestamptz not null,
  closed_window_end timestamptz not null,
  state text not null default 'captured' check (state in ('captured', 'failed')),
  failure text,
  open_count integer not null default 0,
  overdue_count integer not null default 0,
  awaiting_count integer not null default 0,
  closed_count integer not null default 0,
  unique (report_definition_id, cycle_local_date, definition_version)
);

create table public.esh_report_snapshot_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.esh_report_runs (id) on delete cascade,
  signal text not null check (signal in ('open', 'overdue', 'awaiting_verification', 'closed')),
  department_id uuid references public.departments (id),
  department_name text,
  finding_id uuid not null,
  action_id uuid,
  reference text not null,
  finding_title text not null,
  location text,
  owner_email text,
  action_title text,
  action_state text,
  due_at timestamptz,
  due_is_date_only boolean,
  last_update_at timestamptz,
  closed_at timestamptz,
  unique (run_id, signal, finding_id, action_id)
);

create index esh_report_runs_definition_idx
  on public.esh_report_runs (report_definition_id, captured_at desc);
create index esh_report_rows_run_signal_idx
  on public.esh_report_snapshot_rows (run_id, signal, department_name, reference);
create index esh_report_recipients_principal_idx
  on public.esh_report_recipients (principal_id, enabled);

-- Delivery has its own outbox so Action Owner claims can remain narrowly
-- shaped. The worker drains both and completes both through matching routines.
create table public.esh_report_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  run_id uuid not null references public.esh_report_runs (id),
  recipient_id uuid not null references public.esh_report_recipients (id),
  state text not null default 'queued'
    check (state in ('queued', 'processing', 'provider_accepted', 'delivered',
                     'failed', 'suppressed', 'cancelled')),
  idempotency_key text not null unique,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index esh_report_outbox_state_idx
  on public.esh_report_outbox (state, next_attempt_at, created_at);

-- A captured run is a record of what was true that morning, so it is written
-- once. The capture computes its four counts after inserting the rows they
-- count, and an operator may mark a run failed; everything that says which
-- report this is, and which window it covers, is closed to rewriting. The
-- rows themselves are closed to both, the way the finding history is.
create or replace function focus.esh_report_run_is_written_once()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a captured report run cannot be deleted' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.report_definition_id is distinct from old.report_definition_id
     or new.definition_name is distinct from old.definition_name
     or new.definition_version is distinct from old.definition_version
     or new.scope_version is distinct from old.scope_version
     or new.timezone is distinct from old.timezone
     or new.cycle_local_date is distinct from old.cycle_local_date
     or new.captured_at is distinct from old.captured_at
     or new.closed_window_start is distinct from old.closed_window_start
     or new.closed_window_end is distinct from old.closed_window_end then
    raise exception 'a captured report run cannot be rewritten' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger esh_report_runs_written_once
  before update or delete on public.esh_report_runs
  for each row execute function focus.esh_report_run_is_written_once();

create trigger esh_report_snapshot_rows_written_once
  before update or delete on public.esh_report_snapshot_rows
  for each row execute function focus.reject_audit_mutation();

-- ---------------------------------------------------------------------------
-- 2. Report-only grants and session entitlements
-- ---------------------------------------------------------------------------

alter table public.esh_access_grants
  add column report_run_id uuid references public.esh_report_runs (id),
  add column report_recipient_id uuid references public.esh_report_recipients (id);

alter table public.esh_access_grants drop constraint esh_access_grants_purpose_check;
alter table public.esh_access_grants
  add constraint esh_access_grants_purpose_check
  check (purpose in ('owner_action', 'owner_inbox', 'escalation_action', 'report_viewer'));
alter table public.esh_access_grants drop constraint esh_access_grants_check;
alter table public.esh_access_grants
  add constraint esh_access_grants_check check (
    (purpose in ('owner_action', 'escalation_action')
      and action_id is not null and assignment_version is not null
      and report_run_id is null and report_recipient_id is null)
    or (purpose = 'owner_inbox' and action_id is null and assignment_version is null
      and report_run_id is null and report_recipient_id is null)
    or (purpose = 'report_viewer' and action_id is null and assignment_version is null
      and report_run_id is not null and report_recipient_id is not null)
  );

create table public.esh_report_session_entitlements (
  session_id uuid not null references public.esh_guest_sessions (id) on delete cascade,
  run_id uuid not null references public.esh_report_runs (id),
  recipient_id uuid not null references public.esh_report_recipients (id),
  definition_version integer not null,
  scope_version integer not null,
  entitlement_version integer not null,
  primary key (session_id, run_id)
);

-- ---------------------------------------------------------------------------
-- 3. RLS: staff configuration is still constrained by Finding authority.
-- ---------------------------------------------------------------------------

alter table public.esh_report_definitions enable row level security;
alter table public.esh_report_departments enable row level security;
alter table public.esh_report_recipients enable row level security;
alter table public.esh_report_runs enable row level security;
alter table public.esh_report_snapshot_rows enable row level security;
alter table public.esh_report_outbox enable row level security;
alter table public.esh_report_session_entitlements enable row level security;

create policy esh_report_definitions_select on public.esh_report_definitions
  for select to authenticated
  using (organization_id = focus.esh_organization_id()
         and (select focus.esh_can('manage_reports')));
create policy esh_report_departments_select on public.esh_report_departments
  for select to authenticated
  using (report_definition_id in (select id from public.esh_report_definitions));
create policy esh_report_recipients_select on public.esh_report_recipients
  for select to authenticated
  using (organization_id = focus.esh_organization_id()
         and (select focus.esh_can('manage_reports')));
create policy esh_report_runs_select on public.esh_report_runs
  for select to authenticated
  using (organization_id = focus.esh_organization_id()
         and (select focus.esh_can('manage_reports')));
create policy esh_report_snapshot_rows_select on public.esh_report_snapshot_rows
  for select to authenticated
  using (run_id in (select id from public.esh_report_runs));
create policy esh_report_outbox_select on public.esh_report_outbox
  for select to authenticated
  using (organization_id = focus.esh_organization_id()
         and (select focus.esh_can('manage_reports')));

revoke all on public.esh_report_definitions, public.esh_report_departments,
  public.esh_report_recipients, public.esh_report_runs,
  public.esh_report_snapshot_rows, public.esh_report_outbox,
  public.esh_report_session_entitlements from anon, authenticated;
grant select on public.esh_report_definitions, public.esh_report_departments,
  public.esh_report_recipients, public.esh_report_runs,
  public.esh_report_snapshot_rows, public.esh_report_outbox to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Scope and live entitlement checks
-- ---------------------------------------------------------------------------

create or replace function focus.esh_report_scope_departments(p_definition_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with recursive definition as (
    select * from public.esh_report_definitions where id = p_definition_id
  ), roots as (
    select department_id
      from public.esh_report_departments
     where report_definition_id = p_definition_id
  ), tree(id) as (
    select department_id from roots
    union
    select child.id
      from public.departments child
      join tree parent on child.parent_id = parent.id
      join definition d on d.include_descendants
     where child.status <> 'archived'
  )
  select coalesce(array_agg(distinct scoped.id), '{}'::uuid[])
    from (
      select department.id
        from public.departments department
        join definition d on d.organization_wide
       where department.status <> 'archived'
      union
      select id from tree
    ) scoped;
$$;

create or replace function focus.esh_report_recipient_live(
  p_recipient_id uuid,
  p_run_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.esh_report_recipients recipient
      join public.esh_report_definitions definition
        on definition.id = recipient.report_definition_id
      join public.esh_report_runs run
        on run.id = p_run_id and run.report_definition_id = definition.id
     where recipient.id = p_recipient_id
       and recipient.enabled
       and definition.state in ('active', 'paused')
       and definition.version = run.definition_version
       and definition.scope_version = run.scope_version
       and focus.esh_contact_usable(recipient.principal_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Configuration RPC. New definitions are Draft; activation is deliberate.
-- ---------------------------------------------------------------------------

create or replace function public.esh_save_report_definition(
  p_id uuid,
  p_name text,
  p_state text,
  p_timezone text,
  p_schedule_isodow integer,
  p_schedule_local_time time,
  p_organization_wide boolean,
  p_include_descendants boolean,
  p_department_ids uuid[],
  p_recipient_emails text[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  definition public.esh_report_definitions;
  before_scope uuid[];
  after_scope uuid[];
  address text;
  principal uuid;
  v_version integer;
  v_scope_version integer;
begin
  if actor is null or not focus.esh_can('manage_reports') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if length(btrim(coalesce(p_name, ''))) not between 1 and 120
     or p_state not in ('draft', 'active', 'paused')
     or p_schedule_isodow not between 1 and 7
     or p_timezone is null
     or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if not coalesce(p_organization_wide, false)
     and coalesce(cardinality(p_department_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'department_required');
  end if;
  if p_state = 'active' and coalesce(cardinality(p_recipient_emails), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'recipient_required');
  end if;

  if p_id is null then
    insert into public.esh_report_definitions
      (organization_id, name, state, timezone, schedule_isodow,
       schedule_local_time, organization_wide, include_descendants,
       created_by, updated_by)
    values
      (org, btrim(p_name), p_state, p_timezone, p_schedule_isodow,
       p_schedule_local_time, coalesce(p_organization_wide, false),
       coalesce(p_include_descendants, true), actor, actor)
    returning * into definition;
  else
    select * into definition from public.esh_report_definitions
     where id = p_id and organization_id = org for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
    before_scope := focus.esh_report_scope_departments(definition.id);
    v_version := definition.version + case
      when definition.name is distinct from btrim(p_name)
        or definition.timezone is distinct from p_timezone
        or definition.schedule_isodow is distinct from p_schedule_isodow
        or definition.schedule_local_time is distinct from p_schedule_local_time
        or definition.organization_wide is distinct from coalesce(p_organization_wide, false)
        or definition.include_descendants is distinct from coalesce(p_include_descendants, true)
      then 1 else 0 end;
    v_scope_version := definition.scope_version;
    update public.esh_report_definitions set
      name = btrim(p_name), state = p_state, timezone = p_timezone,
      schedule_isodow = p_schedule_isodow,
      schedule_local_time = p_schedule_local_time,
      organization_wide = coalesce(p_organization_wide, false),
      include_descendants = coalesce(p_include_descendants, true),
      version = v_version, updated_by = actor, updated_at = now()
     where id = definition.id returning * into definition;
  end if;

  delete from public.esh_report_departments where report_definition_id = definition.id;
  if not definition.organization_wide then
    insert into public.esh_report_departments (report_definition_id, department_id)
    select definition.id, department.id
      from public.departments department
     where department.id = any(coalesce(p_department_ids, '{}'::uuid[]))
       and department.status <> 'archived';
  end if;
  after_scope := focus.esh_report_scope_departments(definition.id);
  if p_id is not null and before_scope is distinct from after_scope then
    update public.esh_report_definitions set scope_version = scope_version + 1
     where id = definition.id returning * into definition;
  end if;

  -- Removed recipients are disabled and versioned so existing links die.
  update public.esh_report_recipients recipient set
    enabled = false, entitlement_version = entitlement_version + 1, updated_at = now()
   where recipient.report_definition_id = definition.id
     and not exists (
       select 1 from unnest(coalesce(p_recipient_emails, '{}'::text[])) supplied(email)
        where focus.esh_canonical_email(supplied.email) = (
          select p.canonical_email from public.esh_email_principals p
           where p.id = recipient.principal_id));

  foreach address in array coalesce(p_recipient_emails, '{}'::text[]) loop
    if not focus.esh_email_is_valid(address) then
      return jsonb_build_object('ok', false, 'code', 'recipient_invalid');
    end if;
    principal := focus.esh_principal_for(org, address, actor);
    insert into public.esh_report_recipients
      (organization_id, report_definition_id, principal_id, enabled, created_by)
    values (org, definition.id, principal, true, actor)
    on conflict (report_definition_id, principal_id) do update set
      enabled = true,
      entitlement_version = case when not public.esh_report_recipients.enabled
                                 then public.esh_report_recipients.entitlement_version + 1
                                 else public.esh_report_recipients.entitlement_version end,
      updated_at = now();
  end loop;

  -- Any change invalidates queued sends and grants whose version no longer
  -- matches. Pausing stops future runs but deliberately leaves old access.
  update public.esh_report_outbox outbox set state = 'cancelled', updated_at = now()
   where outbox.run_id in (
     select run.id from public.esh_report_runs run
      where run.report_definition_id = definition.id
        and (run.definition_version <> definition.version
             or run.scope_version <> definition.scope_version))
     and outbox.state in ('queued', 'failed');
  update public.esh_access_grants grant_row set revoked_at = now(), revoked_reason = 'report_changed'
   where grant_row.purpose = 'report_viewer'
     and grant_row.report_run_id in (
       select run.id from public.esh_report_runs run
        where run.report_definition_id = definition.id
          and (run.definition_version <> definition.version
               or run.scope_version <> definition.scope_version))
     and grant_row.revoked_at is null;
  update public.esh_guest_sessions session set revoked_at = now(), revoked_reason = 'report_changed'
   where session.id in (
     select entitlement.session_id
       from public.esh_report_session_entitlements entitlement
       join public.esh_report_runs run on run.id = entitlement.run_id
      where run.report_definition_id = definition.id
        and (run.definition_version <> definition.version
             or run.scope_version <> definition.scope_version))
     and session.revoked_at is null;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'report_definition_saved',
          jsonb_build_object('report_definition_id', definition.id,
                             'version', definition.version,
                             'scope_version', definition.scope_version,
                             'state', definition.state));
  return jsonb_build_object('ok', true, 'id', definition.id,
                            'version', definition.version,
                            'scope_version', definition.scope_version);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'name_exists');
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Scheduler: one consistent snapshot and one delivery per recipient.
-- ---------------------------------------------------------------------------

create or replace function public.esh_generate_weekly_reports(p_now timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  definition public.esh_report_definitions;
  v_run_id uuid;
  local_now timestamp;
  cycle_date date;
  local_week_start timestamp;
  window_start timestamptz;
  window_end timestamptz;
  created_count integer := 0;
  queued_count integer := 0;
  inserted_count integer := 0;
begin
  for definition in select * from public.esh_report_definitions where state = 'active' loop
    local_now := p_now at time zone definition.timezone;
    if extract(isodow from local_now)::integer <> definition.schedule_isodow
       or local_now::time < definition.schedule_local_time then
      continue;
    end if;
    cycle_date := local_now::date;
    if exists (select 1 from public.esh_report_runs run
                where run.report_definition_id = definition.id
                  and run.cycle_local_date = cycle_date
                  and run.definition_version = definition.version) then
      continue;
    end if;
    local_week_start := date_trunc('week', local_now);
    window_start := (local_week_start - interval '7 days') at time zone definition.timezone;
    window_end := local_week_start at time zone definition.timezone;

    insert into public.esh_report_runs
      (organization_id, report_definition_id, definition_name,
       definition_version, scope_version, timezone, cycle_local_date,
       captured_at, closed_window_start, closed_window_end)
    values
      (definition.organization_id, definition.id, definition.name,
       definition.version, definition.scope_version, definition.timezone,
       cycle_date, p_now, window_start, window_end)
    returning id into v_run_id;

    -- Open is a finding count, so choose one representative action for the
    -- concise row. Overdue and awaiting-review are action counts below.
    insert into public.esh_report_snapshot_rows
      (run_id, signal, department_id, department_name, finding_id, action_id,
       reference, finding_title, location, owner_email, action_title,
       action_state, due_at, due_is_date_only, last_update_at, closed_at)
    select v_run_id, 'open', finding.accountable_department_id, department.name,
           finding.id, action.id, finding.reference, finding.title, finding.location,
           principal.display_email, action.title, action.state, action.due_at,
           action.due_is_date_only, greatest(finding.updated_at, action.updated_at), finding.closed_at
      from public.esh_findings finding
      left join lateral (
        select candidate.* from public.esh_finding_actions candidate
         where candidate.finding_id = finding.id and candidate.state <> 'cancelled'
         order by candidate.sequence limit 1
      ) action on true
      left join public.departments department on department.id = finding.accountable_department_id
      left join public.esh_email_principals principal on principal.id = action.owner_principal_id
     where finding.organization_id = definition.organization_id
       and finding.status = 'open'
       and not finding.is_restricted
       and finding.accountable_department_id = any(focus.esh_report_scope_departments(definition.id));

    insert into public.esh_report_snapshot_rows
      (run_id, signal, department_id, department_name, finding_id, action_id,
       reference, finding_title, location, owner_email, action_title,
       action_state, due_at, due_is_date_only, last_update_at, closed_at)
    select v_run_id, signal.kind, finding.accountable_department_id, department.name,
           finding.id, action.id, finding.reference, finding.title, finding.location,
           principal.display_email, action.title, action.state, action.due_at,
           action.due_is_date_only, greatest(finding.updated_at, action.updated_at), finding.closed_at
      from public.esh_findings finding
      join public.esh_finding_actions action on action.finding_id = finding.id
      left join public.departments department on department.id = finding.accountable_department_id
      left join public.esh_email_principals principal on principal.id = action.owner_principal_id
      cross join lateral (
        select 'overdue'::text as kind
         where action.state in ('assigned', 'in_progress') and action.due_at < p_now
        union all
        select 'awaiting_verification' where action.state = 'awaiting_verification'
      ) signal
     where finding.organization_id = definition.organization_id
       and finding.status = 'open'
       and not finding.is_restricted
       and finding.accountable_department_id = any(focus.esh_report_scope_departments(definition.id));

    insert into public.esh_report_snapshot_rows
      (run_id, signal, department_id, department_name, finding_id, action_id,
       reference, finding_title, location, owner_email, action_title,
       action_state, due_at, due_is_date_only, last_update_at, closed_at)
    select v_run_id, 'closed', finding.accountable_department_id, department.name,
           finding.id, action.id, finding.reference, finding.title, finding.location,
           principal.display_email, action.title, action.state, action.due_at,
           action.due_is_date_only, greatest(finding.updated_at, action.updated_at), finding.closed_at
      from public.esh_findings finding
      left join lateral (
        select candidate.* from public.esh_finding_actions candidate
         where candidate.finding_id = finding.id
         order by candidate.sequence limit 1
      ) action on true
      left join public.departments department on department.id = finding.accountable_department_id
      left join public.esh_email_principals principal on principal.id = action.owner_principal_id
     where finding.organization_id = definition.organization_id
       and not finding.is_restricted
       and finding.status = 'closed'
       and finding.closed_at >= window_start and finding.closed_at < window_end
       and finding.accountable_department_id = any(focus.esh_report_scope_departments(definition.id));

    update public.esh_report_runs run set
      open_count = (select count(*) from public.esh_report_snapshot_rows row
                     where row.run_id = run.id and row.signal = 'open'),
      overdue_count = (select count(*) from public.esh_report_snapshot_rows row
                        where row.run_id = run.id and row.signal = 'overdue'),
      awaiting_count = (select count(*) from public.esh_report_snapshot_rows row
                         where row.run_id = run.id and row.signal = 'awaiting_verification'),
      closed_count = (select count(*) from public.esh_report_snapshot_rows row
                       where row.run_id = run.id and row.signal = 'closed')
     where run.id = v_run_id;

    insert into public.esh_report_outbox
      (organization_id, run_id, recipient_id, state, idempotency_key)
    select definition.organization_id, v_run_id, recipient.id,
           case when focus.esh_contact_usable(recipient.principal_id)
                then 'queued' else 'suppressed' end,
           'weekly-report:' || v_run_id || ':' || recipient.id
      from public.esh_report_recipients recipient
     where recipient.report_definition_id = definition.id and recipient.enabled
    on conflict (idempotency_key) do nothing;
    get diagnostics inserted_count = row_count;
    queued_count := queued_count + inserted_count;
    created_count := created_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'created', created_count, 'queued', queued_count);
exception when others then
  return jsonb_build_object('ok', false, 'code', 'capture_failed', 'message', sqlerrm);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Delivery claim/completion. Links are individual, not shared.
-- ---------------------------------------------------------------------------

create or replace function public.esh_report_dispatch_claim(
  p_outbox_id uuid,
  p_secret text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  outbox public.esh_report_outbox;
  recipient public.esh_report_recipients;
  run public.esh_report_runs;
  definition public.esh_report_definitions;
  principal public.esh_email_principals;
begin
  select * into outbox from public.esh_report_outbox
   where id = p_outbox_id for update skip locked;
  if not found then return jsonb_build_object('ok', false, 'code', 'busy'); end if;
  if not (outbox.state = 'queued'
          or (outbox.state = 'failed' and outbox.next_attempt_at <= now())
          or (outbox.state = 'processing' and outbox.updated_at < now() - interval '15 minutes')) then
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  select * into recipient from public.esh_report_recipients where id = outbox.recipient_id;
  select * into run from public.esh_report_runs where id = outbox.run_id;
  select * into definition from public.esh_report_definitions where id = run.report_definition_id;
  select * into principal from public.esh_email_principals where id = recipient.principal_id;
  if not focus.esh_report_recipient_live(recipient.id, run.id) then
    update public.esh_report_outbox set state = 'suppressed', last_error = 'access_changed',
      next_attempt_at = null, updated_at = now() where id = outbox.id;
    return jsonb_build_object('ok', false, 'code', 'suppressed');
  end if;
  if p_secret is null or p_secret !~ '^[A-Za-z0-9_-]{40,64}$' then
    raise exception 'esh_report_dispatch_claim: no valid secret';
  end if;
  update public.esh_report_outbox set state = 'processing', attempts = attempts + 1,
    updated_at = now() where id = outbox.id;
  insert into public.esh_access_grants
    (organization_id, principal_id, purpose, report_run_id, report_recipient_id,
     token_hash, issued_reason, expires_at)
  values
    (outbox.organization_id, recipient.principal_id, 'report_viewer', run.id,
     recipient.id, focus.esh_secret_hash(p_secret), 'notification', now() + interval '7 days');
  return jsonb_build_object(
    'ok', true, 'to', principal.display_email, 'run_id', run.id,
    'report_name', run.definition_name, 'captured_at', run.captured_at,
    'timezone', run.timezone, 'open_count', run.open_count,
    'overdue_count', run.overdue_count, 'awaiting_count', run.awaiting_count,
    'closed_count', run.closed_count, 'expires_minutes', 10080);
end;
$$;

create or replace function public.esh_report_dispatch_complete(
  p_outbox_id uuid,
  p_ok boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_permanent boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare outbox public.esh_report_outbox;
begin
  select * into outbox from public.esh_report_outbox where id = p_outbox_id for update;
  if not found or outbox.state <> 'processing' then
    return jsonb_build_object('ok', false, 'code', 'not_processing');
  end if;
  if p_ok then
    update public.esh_report_outbox set state = 'provider_accepted', sent_at = now(),
      provider_message_id = left(p_provider_message_id, 200), last_error = null,
      next_attempt_at = null, updated_at = now() where id = outbox.id;
  else
    update public.esh_report_outbox set state = 'failed',
      last_error = left(coalesce(p_error, 'delivery failed'), 500),
      next_attempt_at = case when p_permanent or attempts >= 5 then null
                             else now() + make_interval(mins => least(60, attempts * attempts * 2)) end,
      updated_at = now() where id = outbox.id;
    update public.esh_access_grants set revoked_at = now(), revoked_reason = 'send_failed'
     where purpose = 'report_viewer' and report_run_id = outbox.run_id
       and report_recipient_id = outbox.recipient_id and consumed_at is null
       and revoked_at is null;
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Report-link exchange and read. These do not call owner-link routines.
-- ---------------------------------------------------------------------------

create or replace function public.esh_report_guest_exchange(
  p_token text,
  p_new_session text,
  p_consume boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  grant_row public.esh_access_grants;
  recipient public.esh_report_recipients;
  run public.esh_report_runs;
  session_id uuid;
  identity integer;
  expires timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into grant_row from public.esh_access_grants
   where token_hash = focus.esh_secret_hash(p_token) and purpose = 'report_viewer'
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if not p_consume then return jsonb_build_object('ok', false, 'code', 'needs_tap'); end if;
  if grant_row.revoked_at is not null then return jsonb_build_object('ok', false, 'code', 'revoked'); end if;
  if grant_row.consumed_at is not null then return jsonb_build_object('ok', false, 'code', 'used'); end if;
  if grant_row.expires_at <= now() then return jsonb_build_object('ok', false, 'code', 'expired'); end if;
  if not focus.esh_report_recipient_live(grant_row.report_recipient_id, grant_row.report_run_id) then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;
  if p_new_session is null or length(p_new_session) < 40 then
    raise exception 'esh_report_guest_exchange: no session secret';
  end if;
  select * into recipient from public.esh_report_recipients where id = grant_row.report_recipient_id;
  select * into run from public.esh_report_runs where id = grant_row.report_run_id;
  select identity_version into identity from public.esh_email_principals where id = recipient.principal_id;
  expires := now() + interval '12 hours';
  insert into public.esh_guest_sessions
    (organization_id, principal_id, session_hash, inbox_scope, identity_version,
     grant_id, absolute_expires_at)
  values
    (grant_row.organization_id, recipient.principal_id,
     focus.esh_secret_hash(p_new_session), false, identity, grant_row.id, expires)
  returning id into session_id;
  insert into public.esh_report_session_entitlements
    (session_id, run_id, recipient_id, definition_version, scope_version,
     entitlement_version)
  values
    (session_id, run.id, recipient.id, run.definition_version, run.scope_version,
     recipient.entitlement_version);
  update public.esh_access_grants set consumed_at = now(), consumed_session_id = session_id
   where id = grant_row.id;
  return jsonb_build_object('ok', true,
    'destination', '/respond/reports/' || run.id,
    'new_session', true, 'session_expires_at', expires);
end;
$$;

-- Neutral recovery: a recognised token identifies one subscription; a typed
-- address may identify several. The return never reveals which case matched.
create or replace function public.esh_report_request_link(
  p_token text,
  p_email text,
  p_organization_slug text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  principal_id uuid;
  queued integer := 0;
begin
  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{40,64}$' then
    select grant_row.principal_id into principal_id
      from public.esh_access_grants grant_row
     where grant_row.token_hash = focus.esh_secret_hash(p_token)
       and grant_row.purpose = 'report_viewer'
     limit 1;
  elsif focus.esh_email_is_valid(p_email) then
    select principal.id into principal_id
      from public.esh_email_principals principal
      join public.organizations organization on organization.id = principal.organization_id
     where organization.slug = p_organization_slug
       and principal.canonical_email = focus.esh_canonical_email(p_email)
     limit 1;
  end if;
  if principal_id is not null and focus.esh_contact_usable(principal_id) then
    insert into public.esh_report_outbox
      (organization_id, run_id, recipient_id, state, idempotency_key)
    select recipient.organization_id, run.id, recipient.id, 'queued',
           'report-recovery:' || recipient.id || ':' || run.id || ':' ||
           to_char(date_trunc('hour', now()), 'YYYYMMDDHH24')
      from public.esh_report_recipients recipient
      join public.esh_report_definitions definition
        on definition.id = recipient.report_definition_id and definition.state in ('active', 'paused')
      join lateral (
        select candidate.id
          from public.esh_report_runs candidate
         where candidate.report_definition_id = definition.id
           and candidate.definition_version = definition.version
           and candidate.scope_version = definition.scope_version
         order by candidate.captured_at desc limit 1
      ) run on true
     where recipient.principal_id = principal_id and recipient.enabled
    on conflict (idempotency_key) do nothing;
    get diagnostics queued = row_count;
  end if;
  return jsonb_build_object('ok', true, 'queued', queued);
end;
$$;

create or replace function public.esh_guest_report(
  p_session text,
  p_run_id uuid,
  p_live boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  session public.esh_guest_sessions;
  entitlement public.esh_report_session_entitlements;
  recipient public.esh_report_recipients;
  run public.esh_report_runs;
  definition public.esh_report_definitions;
  rows jsonb;
begin
  session := focus.esh_guest_resolve(p_session, true);
  if session.id is null then return jsonb_build_object('ok', false, 'code', 'no_session'); end if;
  select * into entitlement from public.esh_report_session_entitlements
   where session_id = session.id and run_id = p_run_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_available'); end if;
  select * into recipient from public.esh_report_recipients where id = entitlement.recipient_id;
  select * into run from public.esh_report_runs where id = entitlement.run_id;
  select * into definition from public.esh_report_definitions where id = run.report_definition_id;
  if not focus.esh_report_recipient_live(recipient.id, run.id)
     or entitlement.definition_version <> definition.version
     or entitlement.scope_version <> definition.scope_version
     or entitlement.entitlement_version <> recipient.entitlement_version then
    return jsonb_build_object('ok', false, 'code', 'access_changed');
  end if;

  if p_live then
    select coalesce(jsonb_agg(to_jsonb(live_row) order by live_row.signal, live_row.reference), '[]') into rows
      from (
        select 'open'::text as signal, department.name as department_name,
               finding.reference, finding.title as finding_title, finding.location,
               principal.display_email as owner_email, action.title as action_title,
               action.state as action_state, action.due_at, action.due_is_date_only,
               greatest(finding.updated_at, action.updated_at) as last_update_at,
               finding.closed_at
          from public.esh_findings finding
          left join lateral (
            select candidate.* from public.esh_finding_actions candidate
             where candidate.finding_id = finding.id and candidate.state <> 'cancelled'
             order by candidate.sequence limit 1
          ) action on true
          left join public.departments department on department.id = finding.accountable_department_id
          left join public.esh_email_principals principal on principal.id = action.owner_principal_id
         where finding.organization_id = definition.organization_id
           and finding.status = 'open'
           and not finding.is_restricted
           and finding.accountable_department_id = any(focus.esh_report_scope_departments(definition.id))
        union all
        select signal.kind, department.name, finding.reference, finding.title, finding.location,
               principal.display_email, action.title, action.state, action.due_at,
               action.due_is_date_only, greatest(finding.updated_at, action.updated_at),
               finding.closed_at
          from public.esh_findings finding
          join public.esh_finding_actions action on action.finding_id = finding.id
          left join public.departments department on department.id = finding.accountable_department_id
          left join public.esh_email_principals principal on principal.id = action.owner_principal_id
          cross join lateral (
            select 'overdue'::text as kind where action.state in ('assigned', 'in_progress')
              and action.due_at < now()
            union all select 'awaiting_verification' where action.state = 'awaiting_verification'
          ) signal
         where finding.organization_id = definition.organization_id
           and finding.status = 'open'
           and not finding.is_restricted
           and finding.accountable_department_id = any(focus.esh_report_scope_departments(definition.id))
        union all
        select 'closed'::text, department.name, finding.reference, finding.title,
               finding.location, principal.display_email, action.title, action.state,
               action.due_at, action.due_is_date_only,
               greatest(finding.updated_at, action.updated_at), finding.closed_at
          from public.esh_findings finding
          left join lateral (
            select candidate.* from public.esh_finding_actions candidate
             where candidate.finding_id = finding.id order by candidate.sequence limit 1
          ) action on true
          left join public.departments department on department.id = finding.accountable_department_id
          left join public.esh_email_principals principal on principal.id = action.owner_principal_id
         where finding.organization_id = definition.organization_id
           and finding.status = 'closed'
           and finding.closed_at >= run.closed_window_start
           and finding.closed_at < run.closed_window_end
           and not finding.is_restricted
           and finding.accountable_department_id = any(focus.esh_report_scope_departments(definition.id))
      ) live_row;
  else
    select coalesce(jsonb_agg(to_jsonb(snapshot) - 'id' - 'run_id' - 'finding_id' - 'action_id'
                              order by snapshot.signal, snapshot.reference), '[]') into rows
      from public.esh_report_snapshot_rows snapshot where snapshot.run_id = run.id;
  end if;
  return jsonb_build_object(
    'ok', true, 'mode', case when p_live then 'live' else 'snapshot' end,
    'report_name', run.definition_name, 'captured_at', run.captured_at,
    'timezone', run.timezone, 'closed_window_start', run.closed_window_start,
    'closed_window_end', run.closed_window_end,
    'open_count', case when p_live then null else run.open_count end,
    'overdue_count', case when p_live then null else run.overdue_count end,
    'awaiting_count', case when p_live then null else run.awaiting_count end,
    'closed_count', case when p_live then null else run.closed_count end,
    'rows', rows);
end;
$$;

-- The report subscription count v203 left at zero, and nothing else.
--
-- This function was rewritten here first, and the rewrite quietly dropped
-- three of v203's conditions: the administrator gate stopped working for an
-- administrator without Finding access (the organisation came from the
-- caller's own ESH scope, which such an administrator does not have, so the
-- whole directory came back empty), a closed finding's action still counted as
-- live work, and a superseded assignment's escalation still counted as active.
-- v203's body is the one that was tested, so it stands and only the count
-- changes.
drop function public.esh_admin_contacts(text);

create function public.esh_admin_contacts(p_search text)
returns table (
  id uuid,
  staff_user_id uuid,
  display_email text,
  display_name text,
  status text,
  access_enabled boolean,
  access_changed_at timestamptz,
  access_changed_by text,
  access_reason text,
  open_actions integer,
  configured_escalations integer,
  active_escalations integer,
  report_subscriptions integer,
  held_notifications integer,
  failed_notifications integer,
  last_access_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select principal.id,
         principal.staff_user_id,
         principal.display_email,
         principal.display_name,
         principal.status,
         principal.access_enabled,
         case when principal.access_enabled
              then principal.access_enabled_at else principal.access_disabled_at end,
         (select profile.full_name
            from public.user_profiles profile
           where profile.id = case when principal.access_enabled
                                   then principal.access_enabled_by
                                   else principal.access_disabled_by end),
         principal.access_reason,
         (select count(*)::int
            from public.esh_finding_actions action
            join public.esh_findings finding on finding.id = action.finding_id
           where action.owner_principal_id = principal.id
             and action.state in ('assigned', 'in_progress', 'awaiting_verification')
             and finding.status = 'open'),
         (select count(*)::int
            from public.esh_action_escalation_recipients route
           where route.principal_id = principal.id and route.removed_at is null),
         (select count(*)::int
            from public.esh_escalation_entitlements entitlement
            join public.esh_finding_actions action on action.id = entitlement.action_id
           where entitlement.principal_id = principal.id
             and entitlement.revoked_at is null
             and entitlement.assignment_version = action.assignment_version),
         (select count(*)::int
            from public.esh_report_recipients recipient
            join public.esh_report_definitions definition
              on definition.id = recipient.report_definition_id
           where recipient.principal_id = principal.id
             and recipient.enabled
             and definition.state in ('active', 'paused')),
         (select count(*)::int
            from public.esh_notification_outbox outbox
           where outbox.recipient_principal_id = principal.id
             and outbox.state = 'held_rollout'),
         (select count(*)::int
            from public.esh_notification_outbox outbox
           where outbox.recipient_principal_id = principal.id
             and outbox.state = 'failed'),
         (select max(session.last_used_at)
            from public.esh_guest_sessions session
           where session.principal_id = principal.id),
         principal.created_at
    from public.esh_email_principals principal
   where focus.is_admin()
     and (coalesce(btrim(p_search), '') = ''
          or position(lower(btrim(p_search)) in principal.canonical_email) > 0
          or position(lower(btrim(p_search)) in lower(coalesce(principal.display_name, ''))) > 0)
   order by coalesce(principal.display_name, principal.display_email), principal.canonical_email
   limit 500;
$$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_report_scope_departments(uuid) from public, anon, authenticated;
revoke all on function focus.esh_report_recipient_live(uuid, uuid) from public, anon, authenticated;
revoke all on function public.esh_save_report_definition(uuid, text, text, text, integer, time, boolean, boolean, uuid[], text[]) from public, anon;
revoke all on function public.esh_generate_weekly_reports(timestamptz) from public, anon, authenticated;
revoke all on function public.esh_report_dispatch_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.esh_report_dispatch_complete(uuid, boolean, text, text, boolean) from public, anon, authenticated;
revoke all on function public.esh_report_guest_exchange(text, text, boolean) from public, anon, authenticated;
revoke all on function public.esh_report_request_link(text, text, text) from public, anon, authenticated;
revoke all on function public.esh_guest_report(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.esh_admin_contacts(text) from public, anon;

grant execute on function focus.esh_report_scope_departments(uuid) to authenticated, service_role;
grant execute on function focus.esh_report_recipient_live(uuid, uuid) to service_role;
grant execute on function public.esh_save_report_definition(uuid, text, text, text, integer, time, boolean, boolean, uuid[], text[]) to authenticated;
grant execute on function public.esh_generate_weekly_reports(timestamptz) to service_role;
grant execute on function public.esh_report_dispatch_claim(uuid, text) to service_role;
grant execute on function public.esh_report_dispatch_complete(uuid, boolean, text, text, boolean) to service_role;
grant execute on function public.esh_report_guest_exchange(text, text, boolean) to service_role;
grant execute on function public.esh_report_request_link(text, text, text) to service_role;
grant execute on function public.esh_guest_report(text, uuid, boolean) to service_role;
grant execute on function public.esh_admin_contacts(text) to authenticated;
