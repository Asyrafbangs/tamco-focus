-- ============================================================================
-- v162 - completed work leaves the calendar, and whoever assigned it is told
--
-- "Remove all the completed items from the calendar - it's bothering and not
-- needed. Once they're completed I get a notification anyway." The calendar
-- kept every task that was not cancelled, so a finished month read the same
-- as an unfinished one. Completed steps already left it (v156).
--
-- The second half was only half true. A step's completion told its owner
-- (v158); a task's completion told nobody - not the manager who assigned it,
-- unless a completion review had been asked for. So the calendar can let go of
-- finished work only once finishing it is announced:
--
--   plan_events            the task branch leaves out completed work.
--   notify_work_completed  whoever assigned the work is told, quietly - the
--                          bell, not email (v158's `quiet`) - when somebody
--                          else completes it. Not for work they completed
--                          themselves, not for work nobody assigned, and not
--                          for a routine occurrence: a schedule closes those
--                          every week, and a notice each time would be noise.
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
   * Routine occurrences are excluded here rather than in the procedure,
   * because the drawer may still correct one and the calendar should not.
   * Completed and cancelled work has no row to offer a move on (v162).
   */
  case
    when t.work_class = 'routine_occurrence' then false
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
  -- v162 - done is done: completed work leaves the calendar with cancelled.
  and t.status not in ('cancelled', 'completed')
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

-- v156 - a step somebody owes, dated by its own date or else the task's.
-- v159 - including the owner's own. One row per open step handed to anybody
-- but its task's owner, and one per step of the owner's own - assigned to
-- them or to nobody - that has a date of its own; an undated one is due with
-- the work and counted on its row. `assignee_id` is whoever owes the step, so
-- an unassigned one names the owner. Which rows a person sees is the page's
-- decision; RLS, through security_invoker, decides who may read them at all.
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
  coalesce(step.assigned_to, parent.primary_owner_id),
  assignee.full_name,
  parent.title,
  parent.due_at,
  step.due_at is not null,
  0
from public.task_checklist_items step
join public.tasks parent on parent.id = step.task_id
left join public.team_directory assignee
  on assignee.id = coalesce(step.assigned_to, parent.primary_owner_id)
where step.state <> 'completed'
  and coalesce(step.due_at, parent.due_at) is not null
  and parent.status in ('backlog', 'active', 'paused')
  and parent.deleted_at is null
  and ( (step.assigned_to is not null and step.assigned_to <> parent.primary_owner_id)
     or step.due_at is not null );

create or replace function focus.notify_work_completed()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  completer uuid;
  completer_name text;
begin
  if new.status <> 'completed'
     or old.status = 'completed'
     or new.work_class = 'routine_occurrence'
     or new.assigned_by is null
     or new.assigned_by = new.primary_owner_id then
    return new;
  end if;

  -- Who pressed the button (v150); the signed-in person when that is unset.
  completer := coalesce(new.completed_by, focus.current_user_id());
  if completer is not distinct from new.assigned_by then
    return new;
  end if;

  -- A completion review addressed to them already says it was completed -
  -- "Completion review needed", written by complete_task in the same update.
  if new.review_status = 'pending' and new.reviewer_id is not distinct from new.assigned_by then
    return new;
  end if;

  if not exists (
    select 1 from public.user_profiles
     where id = new.assigned_by and status = 'active'
  ) then
    return new;
  end if;

  select full_name into completer_name
    from public.user_profiles where id = completer;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, actor_id, entity_type, entity_id, quiet
  ) values (
    new.assigned_by,
    'collaboration_handoff',
    'digest',
    false,
    'Work completed',
    format('%s · Completed by %s.', new.title, coalesce(completer_name, 'a colleague')),
    new.id,
    completer,
    'task',
    new.id,
    true
  );

  return new;
end;
$$;

drop trigger if exists tasks_notify_work_completed on public.tasks;
create trigger tasks_notify_work_completed
  after update of status on public.tasks
  for each row execute function focus.notify_work_completed();

-- plan_events reproduced from 20260911005000_v159_own_steps.sql with its task
-- branch changed as above.
