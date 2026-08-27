-- ---------------------------------------------------------------------------
-- v77 - deleted work disappears from the calendar and the team counts too.
--
-- Reported: the Monthly Plan still showed routines and tasks that had been
-- deleted. It did, and so did My Team.
--
-- `plan_events` and `team_load_summary` both predate the Bin. When soft delete
-- arrived, `task_overview` gained `deleted_at is null` and became the thing
-- almost everything reads -- but these two select from `public.tasks`
-- directly, and nobody went back for them. So work that had been binned kept
-- its square on the calendar and kept counting towards a manager's available,
-- overdue, stale and routine figures.
--
-- Nothing was wrong with the delete. The work was gone from every list that
-- reads `task_overview`, which is why this took a while to notice: the two
-- surfaces that disagreed are the two that bypass it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The calendar.
-- ---------------------------------------------------------------------------

create or replace view public.plan_events
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
  end as event_kind,
  null::uuid as event_id,
  null::uuid as barrier_id
from public.tasks t
where t.due_at is not null
  and t.status <> 'cancelled'
  and t.deleted_at is null

union all

select
  t.id,
  t.title,
  t.primary_owner_id,
  t.status,
  t.work_class,
  t.review_at,
  false,
  'review',
  null::uuid,
  null::uuid
from public.tasks t
where t.review_at is not null
  and t.status in ('backlog', 'active', 'paused')
  and t.deleted_at is null

union all

-- A booked discussion. `primary_owner_id` carries whoever arranged it so the
-- "Only me" filter keeps working without a special case. A discussion about
-- work that has since been deleted goes with it.
select
  e.task_id,
  e.title,
  e.created_by,
  'active'::public.task_status,
  'operational_action'::public.work_class,
  e.starts_at,
  false,
  'discussion',
  e.id,
  e.barrier_id
from public.calendar_events e
where e.cancelled_at is null
  and not exists (
    select 1 from public.tasks t
     where t.id = e.task_id and t.deleted_at is not null
  );

comment on view public.plan_events is
  'Everything with a date, for the Monthly Plan. Excludes deleted work, which kept appearing on the calendar after being binned.';

-- ---------------------------------------------------------------------------
-- The team counts.
--
-- Reproduced from v69 with two filters added and nothing else changed.
-- ---------------------------------------------------------------------------

create or replace view public.team_load_summary
with (security_invoker = true)
as
with settings as (
  select focus.stale_threshold_days() as stale_days
),
task_stats as (
  select
    t.primary_owner_id as user_id,
    count(*) filter (
      where t.status = 'backlog'
        and t.work_class in ('major_project', 'operational_action', 'self_development')
    )::integer as available_work_count,
    count(*) filter (
      where t.status = 'active'
        and t.due_at is not null
        and now() > t.due_at
    )::integer as overdue_count,
    count(*) filter (
      where t.status = 'active'
        and t.last_meaningful_update_at
            < now() - make_interval(days => settings.stale_days)
    )::integer as stale_count,
    count(*) filter (
      where t.work_class = 'routine_occurrence'
        and t.occurrence_date between date_trunc('week', current_date)::date
                                 and (date_trunc('week', current_date) + interval '6 days')::date
    )::integer as routines_this_week,
    count(*) filter (
      where t.work_class = 'routine_occurrence'
        and t.status = 'completed'
        and t.occurrence_date between date_trunc('week', current_date)::date
                                 and (date_trunc('week', current_date) + interval '6 days')::date
    )::integer as routines_completed_this_week,
    count(*) filter (
      where t.work_class = 'routine_occurrence'
        and t.status in ('backlog', 'active')
        and t.due_at is not null
        and now() > t.due_at
    )::integer as routines_overdue,
    count(*) filter (
      where t.origin = 'self_initiated'
        and t.work_class = 'quick_action'
        and t.created_at >= date_trunc('week', current_date)
    )::integer as quick_actions_created_this_week,
    count(*) filter (
      where t.origin = 'self_initiated'
        and t.work_class = 'operational_action'
        and t.created_at >= date_trunc('week', current_date)
    )::integer as operational_created_this_week
  from public.tasks t
  cross join settings
  -- Binned work is not work. Without this, every count on My Team — available,
  -- overdue, stale, routines due — counted things sitting in somebody's Bin.
  where t.deleted_at is null
  group by t.primary_owner_id
),
barrier_stats as (
  select
    t.primary_owner_id as user_id,
    count(*)::integer as open_barrier_count
  from public.barriers b
  join public.tasks t on t.id = b.task_id
  where b.status = 'open'
    and t.deleted_at is null
  group by t.primary_owner_id
),
proposal_stats as (
  select
    wp.proposed_by as user_id,
    count(*)::integer as decisions_pending
  from public.work_proposals wp
  where wp.status = 'pending'
  group by wp.proposed_by
)
select
  p.id as user_id,
  p.full_name,
  p.employee_id,
  p.department_id,
  p.reporting_manager_id,
  coalesce(ts.available_work_count, 0)::integer as available_work_count,
  coalesce(ts.overdue_count, 0)::integer as overdue_count,
  coalesce(ts.stale_count, 0)::integer as stale_count,
  coalesce(bs.open_barrier_count, 0)::integer as open_barrier_count,
  coalesce(ts.routines_this_week, 0)::integer as routines_this_week,
  coalesce(ts.routines_completed_this_week, 0)::integer as routines_completed_this_week,
  coalesce(ts.routines_overdue, 0)::integer as routines_overdue,
  coalesce(ts.quick_actions_created_this_week, 0)::integer as quick_actions_created_this_week,
  coalesce(ts.operational_created_this_week, 0)::integer as operational_created_this_week,
  coalesce(ps.decisions_pending, 0)::integer as decisions_pending
from public.user_profiles p
left join task_stats ts on ts.user_id = p.id
left join barrier_stats bs on bs.user_id = p.id
left join proposal_stats ps on ps.user_id = p.id
where p.status = 'active'
  and (auth.uid() is null or focus.can_view_user(p.id));
