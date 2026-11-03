-- v287 — ESH classifies the hazard; the person who reported it does not.
--
-- Stage 0 forbade inferring a taxonomy, and until the lean package arrived
-- there was no approved list to build on: v279 and v280 both say so in their
-- own headers. The package supplies one, as candidate categories rather than
-- an instruction to overwrite anything — and nothing here overwrites anything,
-- because no finding in this database has ever carried a category.
--
-- Four decisions are built into the shape below, and each is the package's:
--
--   * A table rather than an enum. ESH can retire a category with `active`
--     without a migration, and a new one is an insert. An enum would make
--     both a schema change, and `drop type` is not something to do to a column
--     thousands of rows deep.
--   * Stable codes. The label on screen may be reworded; `slips_falls` is
--     what the data says, for ever, and what a report groups by.
--   * One primary, one optional secondary. Not a list: a finding that is
--     genuinely three things is a finding that has not been thought about, and
--     a list makes every count ambiguous.
--   * Optional, never required. The employee does not classify, ESH does,
--     during review — so a finding exists before it is classified, and
--     historical records stay uncategorised rather than being guessed at. The
--     register and the distribution both say how many are uncategorised, which
--     is the honest way to make the gap visible.

create table public.esh_hazard_categories (
  code text primary key check (code ~ '^[a-z][a-z_]{2,31}$'),
  label text not null check (length(btrim(label)) between 1 and 60),
  description text not null check (length(btrim(description)) between 1 and 200),
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.esh_hazard_categories is
  'v287 — the hazard categories ESH assigns during review. Codes are stable; '
  'labels are wording. Retire with active = false rather than deleting, so '
  'findings already classified keep their meaning.';

-- TAMCO's main operational risks, from the approved package. "other" exists so
-- that a category nobody anticipated is recorded as unclassifiable rather than
-- forced into the nearest wrong box, and sorts last.
insert into public.esh_hazard_categories (code, label, description, sort_order) values
  ('electrical', 'Electrical and testing',
   'Live work, test benches, panels, earthing, insulation and arc flash.', 10),
  ('machinery', 'Machinery and equipment',
   'Guarding, moving parts, tooling, maintenance and isolation.', 20),
  ('lifting_traffic', 'Lifting and vehicle traffic',
   'Cranes, slings, forklifts, loading bays and pedestrian separation.', 30),
  ('slips_falls', 'Slips, trips and falls',
   'Walkways, housekeeping, spills, working at height and edge protection.', 40),
  ('fire', 'Fire and explosion',
   'Ignition sources, hot work, flammables, extinguishers and escape routes.', 50),
  ('chemical', 'Chemicals and hazardous substances',
   'Storage, labelling, decanting, spill control and exposure.', 60),
  ('ergonomics', 'Ergonomics and manual handling',
   'Lifting by hand, repetitive work, posture and workstation layout.', 70),
  ('environment', 'Environmental',
   'Spills to ground or drain, waste, emissions, noise and lighting.', 80),
  ('other', 'Something else',
   'A hazard none of the categories above describes. Say what it is.', 999);

alter table public.esh_hazard_categories enable row level security;

-- Everybody signed in reads the labels; nobody writes them through the API.
revoke all on table public.esh_hazard_categories from anon, authenticated;
grant select on table public.esh_hazard_categories to authenticated;

create policy esh_hazard_categories_read on public.esh_hazard_categories
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- The finding's own classification
-- ---------------------------------------------------------------------------

alter table public.esh_findings
  add column hazard_category text references public.esh_hazard_categories (code),
  add column hazard_secondary text references public.esh_hazard_categories (code),
  add column hazard_set_at timestamptz,
  add column hazard_set_by uuid references public.user_profiles (id);

-- A secondary category without a primary is not a classification, and the same
-- category twice is a mistake the database can refuse outright.
alter table public.esh_findings
  add constraint esh_findings_hazard_shape
  check (hazard_secondary is null
         or (hazard_category is not null and hazard_secondary <> hazard_category));

create index esh_findings_hazard_idx
  on public.esh_findings (organization_id, hazard_category)
  where hazard_category is not null;

comment on column public.esh_findings.hazard_category is
  'v287 — the one hazard category ESH assigned during review. Null means not '
  'yet classified, which is a fact about the review and not about the hazard.';

-- ---------------------------------------------------------------------------
-- The register, which now carries the classification it filters on
-- ---------------------------------------------------------------------------
--
-- `create or replace`, with the three columns appended at the end of the select
-- list and the join added — never `drop view`. A dropped view comes back
-- without `security_invoker`, which is the whole of its row-level security, and
-- that is exactly how v280 nearly leaked the register.

create or replace view public.esh_register_rows
with (security_invoker = true)
as
SELECT f.id AS finding_id,
    f.organization_id,
    f.reference,
    f.title,
    f.location,
    f.status,
    f.is_restricted,
    f.risk_level,
    f.accountable_department_id,
    d.name AS department_name,
    f.created_at,
    f.closed_at,
    a.id AS action_id,
    a.state AS action_state,
    a.priority,
    a.due_at,
    a.due_is_date_only,
    ( SELECT count(*) AS count
           FROM esh_finding_actions x
          WHERE x.finding_id = f.id) AS action_count,
    p.display_email AS owner_email,
    COALESCE(held.any_held, false) AS notification_held,
    COALESCE((a.state = ANY (ARRAY['assigned'::text, 'in_progress'::text])) AND a.due_at < now(), false) AS is_overdue,
    (f.status = ANY (ARRAY['draft'::text, 'new'::text])) OR f.status = 'open'::text AND (COALESCE((a.state = ANY (ARRAY['assigned'::text, 'in_progress'::text])) AND a.due_at < now(), false) OR COALESCE(a.state = 'awaiting_verification'::text, false) OR COALESCE(failed.any_failed, false)) AS needs_attention,
    COALESCE(latest.occurred_at, f.created_at) AS last_update_at,
    COALESCE(latest.event_type, 'finding_created'::text) AS last_update_type,
    COALESCE(failed.any_failed, false) AS notification_failed,
    escalated.level AS escalation_level,
    COALESCE(focus.esh_changes_requested(a.id), false) AS changes_requested,
    f.hazard_category,
    f.hazard_secondary,
    hz.label as hazard_label
   FROM esh_findings f
     LEFT JOIN departments d ON d.id = f.accountable_department_id
     left join public.esh_hazard_categories hz on hz.code = f.hazard_category
     LEFT JOIN LATERAL ( SELECT x.id,
            x.organization_id,
            x.finding_id,
            x.sequence,
            x.title,
            x.required_outcome,
            x.evidence_instruction,
            x.evidence_rule,
            x.evidence_exception_reason,
            x.priority,
            x.state,
            x.owner_principal_id,
            x.assignment_version,
            x.baseline_due_at,
            x.due_at,
            x.due_is_date_only,
            x.reviewer_user_id,
            x.no_further_escalation_reason,
            x.draft_owner_email,
            x.draft_escalation,
            x.created_by,
            x.created_at,
            x.updated_at,
            x.assigned_at,
            x.accepted_at,
            x.row_version,
            x.current_submission_id,
            x.followup_active_from
           FROM esh_finding_actions x
          WHERE x.finding_id = f.id
          ORDER BY x.sequence
         LIMIT 1) a ON true
     LEFT JOIN esh_email_principals p ON p.id = a.owner_principal_id
     LEFT JOIN LATERAL ( SELECT true AS any_held
           FROM esh_notification_outbox o
          WHERE o.action_id = a.id AND o.state = 'held_rollout'::text
         LIMIT 1) held ON true
     LEFT JOIN LATERAL ( SELECT max(e.level) AS level
           FROM esh_escalation_entitlements e
          WHERE e.action_id = a.id AND e.revoked_at IS NULL AND e.assignment_version = a.assignment_version) escalated ON true
     LEFT JOIN LATERAL ( SELECT true AS any_failed
           FROM esh_notification_outbox o
          WHERE o.action_id = a.id AND (o.state = 'bounced'::text OR o.state = 'failed'::text AND o.next_attempt_at IS NULL)
         LIMIT 1) failed ON true
     LEFT JOIN LATERAL ( SELECT e.occurred_at,
            e.event_type
           FROM esh_audit_events e
          WHERE e.finding_id = f.id AND (e.event_type = ANY (ARRAY['finding_created'::text, 'action_assigned'::text, 'action_started'::text, 'owner_message'::text, 'esh_message'::text, 'escalation_message'::text, 'submission_created'::text, 'submission_withdrawn'::text]))
          ORDER BY e.occurred_at DESC, (array_position(ARRAY['submission_created'::text, 'submission_withdrawn'::text, 'owner_message'::text, 'esh_message'::text, 'escalation_message'::text, 'action_started'::text, 'action_assigned'::text, 'finding_created'::text], e.event_type))
         LIMIT 1) latest ON true;

create or replace view public.esh_action_register_rows
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
       a.sequence as action_sequence,
       a.title as action_title,
       a.state as action_state,
       a.priority,
       a.baseline_due_at,
       a.due_at,
       a.due_is_date_only,
       (select count(*) from public.esh_finding_actions x where x.finding_id = f.id) as action_count,
       p.display_email as owner_email,
       coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false) as is_overdue,
       coalesce(held.any_held, false) as notification_held,
       coalesce(failed.any_failed, false) as notification_failed,
       (coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false)
        or coalesce(a.state = 'awaiting_verification', false)
        or coalesce(failed.any_failed, false)) as needs_attention,
       coalesce(latest.occurred_at, a.assigned_at, a.created_at) as last_update_at,
       coalesce(latest.event_type, 'action_assigned') as last_update_type,
       coalesce(focus.esh_changes_requested(a.id), false) as changes_requested,
       f.hazard_category,
       f.hazard_secondary,
       hz.label as hazard_label
  from public.esh_findings f
  join public.esh_finding_actions a on a.finding_id = f.id
  left join public.departments d on d.id = f.accountable_department_id
  left join public.esh_hazard_categories hz on hz.code = f.hazard_category
  left join public.esh_email_principals p on p.id = a.owner_principal_id
  left join lateral (
    select true as any_held
      from public.esh_notification_outbox o
     where o.action_id = a.id and o.state = 'held_rollout'
     limit 1
  ) held on true
  left join lateral (
    select true as any_failed
      from public.esh_notification_outbox o
     where o.action_id = a.id
       and (o.state = 'bounced' or (o.state = 'failed' and o.next_attempt_at is null))
     limit 1
  ) failed on true
  left join lateral (
    select e.occurred_at, e.event_type
      from public.esh_audit_events e
     where e.action_id = a.id
       and e.event_type in ('action_assigned', 'action_started', 'owner_message', 'esh_message',
                            'escalation_message', 'submission_created', 'submission_withdrawn')
     order by e.occurred_at desc,
              array_position(array['submission_created', 'submission_withdrawn',
                                   'owner_message', 'esh_message', 'escalation_message',
                                   'action_started', 'action_assigned'],
                             e.event_type)
     limit 1
  ) latest on true;

alter view public.esh_register_rows set (security_invoker = true);
alter view public.esh_action_register_rows set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Assigning it
-- ---------------------------------------------------------------------------

create or replace function public.esh_set_finding_hazard(
  p_finding_id uuid,
  p_primary text,
  p_secondary text default null
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
  f public.esh_findings%rowtype;
  v_primary text := nullif(btrim(coalesce(p_primary, '')), '');
  v_secondary text := nullif(btrim(coalesce(p_secondary, '')), '');
  was_primary text;
  was_secondary text;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  select * into f
    from public.esh_findings
   where id = p_finding_id
     and organization_id = org
   for update;
  /*
   * `<> all`, with the null branch written out. `department_id <> any (...)`
   * is TRUE as soon as the coordinator covers more than one department, which
   * is how six Stage 2 procedures shipped refusing the departments they were
   * scoped to; and `= any` on a null department is null rather than false, so
   * an unrouted finding needs saying separately.
   */
  if not found
     or (not focus.esh_scope_all()
         and (f.accountable_department_id is null
              or f.accountable_department_id <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Clearing is allowed: a classification ESH no longer stands behind should
  -- be removable, and an uncategorised finding is a visible, countable state.
  if v_primary is null then
    if v_secondary is not null then
      return jsonb_build_object('ok', false, 'code', 'secondary_without_primary');
    end if;
  else
    if not exists (select 1 from public.esh_hazard_categories
                    where code = v_primary and active) then
      return jsonb_build_object('ok', false, 'code', 'unknown_category');
    end if;
    if v_secondary is not null then
      if v_secondary = v_primary then
        return jsonb_build_object('ok', false, 'code', 'same_category_twice');
      end if;
      if not exists (select 1 from public.esh_hazard_categories
                      where code = v_secondary and active) then
        return jsonb_build_object('ok', false, 'code', 'unknown_category');
      end if;
    end if;
  end if;

  was_primary := f.hazard_category;
  was_secondary := f.hazard_secondary;

  update public.esh_findings set
    hazard_category = v_primary,
    hazard_secondary = v_secondary,
    hazard_set_at = case when v_primary is null then null else now() end,
    hazard_set_by = case when v_primary is null then null else actor end,
    updated_at = now(),
    row_version = row_version + 1
   where id = f.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'hazard_classified', f.id,
          jsonb_build_object('from', was_primary, 'to', v_primary,
                             'from_secondary', was_secondary, 'to_secondary', v_secondary));

  return jsonb_build_object('ok', true, 'hazard_category', v_primary,
                            'hazard_secondary', v_secondary);
end;
$$;

comment on function public.esh_set_finding_hazard(uuid, text, text) is
  'v287 — a Coordinator records what kind of hazard a finding they cover is. '
  'Null clears it. Secondary is optional and must differ from primary.';

revoke all on function public.esh_set_finding_hazard(uuid, text, text) from public, anon;
grant execute on function public.esh_set_finding_hazard(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What management reads: the distribution, including what is not classified
-- ---------------------------------------------------------------------------
--
-- One view, no scoring and no analytics engine. `security_invoker` so the
-- counts are the reader's own: a coordinator scoped to two departments sees the
-- distribution of what they can see, and the same predicate that governs the
-- register governs this.

create view public.esh_hazard_distribution
with (security_invoker = true)
as
select c.code,
       c.label,
       c.sort_order,
       count(f.id) as findings,
       count(f.id) filter (where f.status in ('new', 'open')) as open_findings,
       count(f.id) filter (where f.risk_level in ('high', 'critical')) as significant_findings,
       count(f.id) filter (
         where exists (select 1 from public.esh_finding_connections k
                        where k.finding_id = f.id
                          and k.kind in ('recurred_as', 'reported_again_as', 'duplicate_of'))
       ) as recurring_findings,
       max(f.created_at) as latest_at
  from public.esh_hazard_categories c
  left join public.esh_findings f on f.hazard_category = c.code
 where c.active
 group by c.code, c.label, c.sort_order;

comment on view public.esh_hazard_distribution is
  'v287 — findings per hazard category for the reader, every active category '
  'included so an empty one reads as zero rather than as absent.';

grant select on public.esh_hazard_distribution to authenticated;
