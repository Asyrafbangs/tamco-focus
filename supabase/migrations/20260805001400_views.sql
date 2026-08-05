-- ============================================================================
-- TAMCO Focus — read views
--
-- Implements MASTER_PRODUCT_SPEC.md sections 18, 31B.5-31B.7.
--
-- Every view is `security_invoker = true`, so the caller's RLS policies apply.
-- A view is not a way around row-level security here; it is a way to express a
-- join once.
--
-- Division of labour for durations, so the rule is stated exactly once:
--   * SQL owns the PREDICATES — is this overdue, is this stale. They must be
--     indexable, and the weekly email worker filters on them at scale.
--   * The TypeScript domain layer owns the DURATIONS and their labels, from the
--     raw timestamps these views expose. Section 15.4 requires desktop, mobile,
--     email, and exports to share one calculation, and that shared place is
--     `src/domain/duration.ts`.
-- ============================================================================

-- Stale threshold is a manager setting, read once per statement.
create or replace function focus.stale_threshold_days()
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((focus.setting('focus.stale_update_threshold_days'))::integer, 7);
$$;

-- ---------------------------------------------------------------------------
-- Task overview — the single joined read the interface uses everywhere.
-- ---------------------------------------------------------------------------

create view public.task_overview
with (security_invoker = true)
as
select
  t.id,
  t.title,
  t.description,
  t.next_action,
  t.status,
  t.work_class,
  t.focus_bucket,
  t.origin,
  t.urgency,
  t.is_mandatory,
  t.progress_percent,
  t.over_focus_target,
  t.activation_reason_code,
  t.activation_reason_note,
  t.review_status,
  t.reviewer_id,
  t.version,

  t.primary_owner_id,
  owner.full_name        as owner_name,
  owner.employee_id      as owner_employee_id,
  owner.department_id    as owner_department_id,

  t.routine_template_id,
  t.occurrence_date,

  -- Raw timestamps. The TypeScript duration module derives every displayed age
  -- from exactly these values.
  t.created_at,
  t.state_entered_at,
  t.last_meaningful_update_at,
  t.due_at,
  t.due_is_date_only,
  t.review_at,
  t.completed_at,
  t.cancelled_at,

  -- Predicates. Section 31B.5: overdue age is zero before the due timestamp and
  -- stops at completion. Because `due_at` already stores the organisation-local
  -- END of a date-only commitment, this single comparison is correct for both
  -- date-only and date-time due dates.
  (
    t.due_at is not null
    and t.status in ('backlog', 'active', 'paused')
    and now() > t.due_at
  ) as is_overdue,

  -- Stale applies only to Active work (section 15.2).
  (
    t.status = 'active'
    and t.last_meaningful_update_at
        < now() - make_interval(days => focus.stale_threshold_days())
  ) as is_stale,

  (
    select count(*) from public.barriers b
     where b.task_id = t.id and b.status = 'open'
  ) as open_barrier_count,

  (
    select count(*) from public.task_checklist_items ci where ci.task_id = t.id
  ) as checklist_total,

  (
    select count(*) from public.task_checklist_items ci
     where ci.task_id = t.id and ci.state = 'completed'
  ) as checklist_completed,

  (
    select count(*) from public.task_checklist_items ci
     where ci.task_id = t.id and ci.state = 'ready'
  ) as checklist_ready,

  -- Required evidence that has not been supplied. Drives both the completion
  -- block (section 20.1) and the My Day "missing mandatory evidence" exception
  -- (section 9.3).
  (
    select count(*) from public.task_checklist_items ci
     where ci.task_id = t.id
       and ci.evidence_rule = 'required'
       and not exists (select 1 from public.attachments a where a.checklist_item_id = ci.id)
  ) as missing_evidence_count,

  (
    select count(*) from public.attachments a where a.task_id = t.id
  ) as attachment_count,

  (
    select count(*) from public.task_collaborators c where c.task_id = t.id
  ) as collaborator_count

from public.tasks t
join public.user_profiles owner on owner.id = t.primary_owner_id;

-- ---------------------------------------------------------------------------
-- Focus summary — count against target per person per bucket.
--
-- This is what renders `6 / 5` in red with the written "Over focus target"
-- label (section 7.4). The count always comes from committed state.
-- ---------------------------------------------------------------------------

create view public.focus_summary
with (security_invoker = true)
as
select
  p.id as user_id,
  p.full_name,
  b.bucket,
  (
    select count(*)
      from public.tasks t
     where t.primary_owner_id = p.id
       and t.focus_bucket = b.bucket
       and t.status = 'active'
  )::integer as active_count,
  focus.effective_focus_target(p.id, b.bucket) as recommended_target,
  (
    select count(*)
      from public.tasks t
     where t.primary_owner_id = p.id
       and t.focus_bucket = b.bucket
       and t.status = 'active'
  ) > coalesce(focus.effective_focus_target(p.id, b.bucket), 0) as is_over_target,
  (
    select min(t.activated_at)
      from public.tasks t
     where t.primary_owner_id = p.id
       and t.focus_bucket = b.bucket
       and t.status = 'active'
       and t.over_focus_target
  ) as over_target_since
from public.user_profiles p
cross join (
  select unnest(enum_range(null::public.focus_bucket)) as bucket
) b
where p.status = 'active';

-- ---------------------------------------------------------------------------
-- Available Work needing selection, and routine load, for Team Load
-- (section 18.3).
-- ---------------------------------------------------------------------------

create view public.team_load_summary
with (security_invoker = true)
as
select
  p.id as user_id,
  p.full_name,
  p.employee_id,
  p.department_id,
  p.reporting_manager_id,

  (select count(*) from public.tasks t
    where t.primary_owner_id = p.id and t.status = 'backlog'
      and t.work_class in ('major_project', 'operational_action', 'self_development')
  )::integer as available_work_count,

  (select count(*) from public.tasks t
    where t.primary_owner_id = p.id and t.status = 'active'
      and t.due_at is not null and now() > t.due_at
  )::integer as overdue_count,

  (select count(*) from public.tasks t
    where t.primary_owner_id = p.id and t.status = 'active'
      and t.last_meaningful_update_at
          < now() - make_interval(days => focus.stale_threshold_days())
  )::integer as stale_count,

  (select count(*) from public.barriers b
     join public.tasks t on t.id = b.task_id
    where t.primary_owner_id = p.id and b.status = 'open'
  )::integer as open_barrier_count,

  -- Section 16.6 — routine burden is shown even though it consumes no focus
  -- target.
  (select count(*) from public.tasks t
    where t.primary_owner_id = p.id
      and t.work_class = 'routine_occurrence'
      and t.occurrence_date between date_trunc('week', current_date)::date
                               and (date_trunc('week', current_date) + interval '6 days')::date
  )::integer as routines_this_week,

  (select count(*) from public.tasks t
    where t.primary_owner_id = p.id
      and t.work_class = 'routine_occurrence'
      and t.status = 'completed'
      and t.occurrence_date between date_trunc('week', current_date)::date
                               and (date_trunc('week', current_date) + interval '6 days')::date
  )::integer as routines_completed_this_week,

  (select count(*) from public.tasks t
    where t.primary_owner_id = p.id
      and t.work_class = 'routine_occurrence'
      and t.status in ('backlog', 'active')
      and t.due_at is not null and now() > t.due_at
  )::integer as routines_overdue,

  -- Section 18.4 — a compact weekly summary of employee-initiated work rather
  -- than every Quick Action individually.
  (select count(*) from public.tasks t
    where t.primary_owner_id = p.id
      and t.origin = 'self_initiated'
      and t.work_class = 'quick_action'
      and t.created_at >= date_trunc('week', current_date)
  )::integer as quick_actions_created_this_week,

  (select count(*) from public.tasks t
    where t.primary_owner_id = p.id
      and t.origin = 'self_initiated'
      and t.work_class = 'operational_action'
      and t.created_at >= date_trunc('week', current_date)
  )::integer as operational_created_this_week,

  (select count(*) from public.work_proposals wp
    where wp.proposed_by = p.id and wp.status = 'pending'
  )::integer as decisions_pending

from public.user_profiles p
where p.status = 'active';

-- ---------------------------------------------------------------------------
-- Monthly Plan feed (section 17.2).
--
-- One row per dated commitment, already labelled with the kind of event it is
-- so the calendar and the mobile agenda render from the same source.
-- ---------------------------------------------------------------------------

create view public.plan_events
with (security_invoker = true)
as
select
  t.id as task_id,
  t.title,
  t.primary_owner_id,
  t.status,
  t.work_class,
  t.due_at as occurs_at,
  t.due_is_date_only,
  case
    when t.work_class = 'routine_occurrence' then 'routine'
    when t.due_at is not null
         and t.status in ('backlog', 'active', 'paused')
         and now() > t.due_at then 'overdue'
    else 'due'
  end as event_kind
from public.tasks t
where t.due_at is not null
  and t.status <> 'cancelled'

union all

select
  t.id,
  t.title,
  t.primary_owner_id,
  t.status,
  t.work_class,
  t.review_at,
  false,
  'review'
from public.tasks t
where t.review_at is not null
  and t.status in ('backlog', 'active', 'paused');

grant select on public.task_overview, public.focus_summary,
                public.team_load_summary, public.plan_events
to authenticated;
