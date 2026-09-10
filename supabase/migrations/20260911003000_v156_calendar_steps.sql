-- ============================================================================
-- v156 - Trackable Steps, stage 3: a calendar that knows about steps
--
-- "The calendar should understand both Tasks and Steps. But we need to avoid
-- clutter." The Monthly Plan knew only the task's own date, so the execution
-- plan underneath it - Amer's input due on the 10th, Fadli's review on the
-- 14th, the report on the 16th - was invisible to everybody, including Amer.
--
-- plan_events gains a fourth branch: one row per open step handed to anybody
-- but its task's owner, dated by its own date or else the task's (v154). Seven
-- columns are appended to every branch, because a union must agree on them and
-- `create or replace view` may only add at the end:
--
--   step_id, assignee_id, assignee_name, parent_title, parent_due_at
--                          what the step is, who owes it, what it is part of
--                          and when that is due
--   step_has_own_date      whether its date is its own or the task's
--   steps_due_with_task    on the task's own row: open steps due that same
--                          day. The calendar says "3 steps due" once instead
--                          of drawing four copies of the same day.
--
-- Which step rows a person sees is the page's decision, not the view's: the
-- assignee always sees their own; the owner, and a manager's Team scope, see a
-- delegated step only when it is due before the work itself. Step rows never
-- move by dragging - a step's date belongs to its step, where v154's rule
-- applies.
-- ============================================================================

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
  null::uuid as barrier_id,
  t.version as task_version,
  /*
   * A CASE rather than an AND, because a CASE is evaluated in order and an AND
   * is not: the authority check walks the reporting tree, and there is no
   * reason to walk it for work that could not be moved whatever the answer.
   * The two refusals mirror the procedure's own — completed or cancelled work
   * "cannot receive a new due date" — and routine occurrences are excluded
   * here rather than there, because the drawer may still correct one and the
   * calendar should not.
   */
  case
    when t.work_class = 'routine_occurrence' then false
    when t.status in ('completed', 'cancelled') then false
    else focus.can_edit_task(t.id)
  end as can_reschedule,
  -- v156 - the step columns, empty on every row that is not a step.
  null::uuid as step_id,
  null::uuid as assignee_id,
  null::text as assignee_name,
  null::text as parent_title,
  null::timestamptz as parent_due_at,
  null::boolean as step_has_own_date,
  -- Open steps due on the task's own day - by inheriting its date (v154), or
  -- by being given that same day - are counted here, not drawn beside it.
  ( select count(*)
      from public.task_checklist_items ci
     where ci.task_id = t.id
       and ci.state <> 'completed'
       and ( ci.due_at is null
          or (ci.due_at at time zone focus.org_time_zone())::date
             = (t.due_at at time zone focus.org_time_zone())::date ) )::integer
    as steps_due_with_task
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
  null::uuid,
  t.version,
  -- A review deadline belongs to the review, not to the due date.
  false,
  null::uuid,
  null::uuid,
  null::text,
  null::text,
  null::timestamptz,
  null::boolean,
  0
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
  e.barrier_id,
  null::integer,
  -- A meeting has other people in it. Moving it is a reschedule they would
  -- need telling about, which is a different feature from this one.
  false,
  null::uuid,
  null::uuid,
  null::text,
  null::text,
  null::timestamptz,
  null::boolean,
  0
from public.calendar_events e
where e.cancelled_at is null
  and not exists (
    select 1 from public.tasks t
     where t.id = e.task_id and t.deleted_at is not null
  )

union all

-- v156 - a step somebody owes. One row per open step handed to anybody but
-- its task's owner, dated by its own date or else the task's. Who sees which
-- is decided by the page, per viewer: the assignee always sees theirs; the
-- owner, and a manager's Team scope, only when it is due before the work
-- itself. The rows exist either way - RLS, through security_invoker, decides
-- who may read them at all.
select
  parent.id,
  step.action,
  parent.primary_owner_id,
  parent.status,
  parent.work_class,
  coalesce(step.due_at, parent.due_at),
  case when step.due_at is null then parent.due_is_date_only else true end,
  'step',
  null::uuid,
  null::uuid,
  parent.version,
  -- A step's date is changed in its step, where the rule that it may not pass
  -- its task is applied (v154); the calendar does not drag it.
  false,
  step.id,
  step.assigned_to,
  assignee.full_name,
  parent.title,
  parent.due_at,
  step.due_at is not null,
  0
from public.task_checklist_items step
join public.tasks parent on parent.id = step.task_id
left join public.team_directory assignee on assignee.id = step.assigned_to
where step.assigned_to is not null
  and step.assigned_to <> parent.primary_owner_id
  and step.state <> 'completed'
  and coalesce(step.due_at, parent.due_at) is not null
  and parent.status in ('backlog', 'active', 'paused')
  and parent.deleted_at is null;

-- Reproduced from 20260910001000_v153_plan_events_reschedule.sql with the step branch and columns added.
