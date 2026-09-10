-- ============================================================================
-- v153 — a due date can be moved on the calendar, through the governed path
--
-- MASTER_PRODUCT_SPEC.md §17.3: "The calendar is primarily informational. It
-- must not allow ungoverned drag-and-drop changes to due date, ownership, or
-- task state."
--
-- The Product Owner has asked for the calendar to move like Outlook's: drag a
-- task's due date to another day. The word that makes that compatible with
-- §17.3 is "ungoverned". A drop on the Monthly Plan calls exactly what the
-- task drawer's Edit due date calls — `change_task_due_date` — so it passes
-- the same authority check (`focus.can_edit_task`), refuses completed and
-- cancelled work the same way, carries the same optimistic-concurrency
-- version, and writes the same `task_due_date_changed` audit event with the
-- previous and new dates. Nothing about the change is new except where the
-- gesture starts. Undo is a second change back, audited in its own right, so
-- the history says "moved, then moved back" rather than pretending neither
-- happened.
--
-- What moves: a task's due date, and nothing else. Routine occurrences follow
-- their template's schedule, a "Review by" date belongs to the review, and a
-- meeting has attendees who would need telling — so all three stay fixed.
--
-- The calendar needs two things it could not previously know.
--
--   task_version    the version to pass as `p_expected_version`, so a drop
--                   made on a stale calendar is refused with "This work
--                   changed while it was open" instead of silently
--                   overwriting a date somebody else set a minute ago
--   can_reschedule  whether THIS viewer may move THIS item, so nobody is
--                   offered a drag the server will refuse. It is derived from
--                   the same function the procedure checks, evaluated as the
--                   caller: `plan_events` is `security_invoker`, and
--                   `auth.uid()` inside `can_edit_task` is the viewer. It is
--                   a courtesy to the interface, not the control — the
--                   procedure decides again on every call.
--
-- Both are appended: `create or replace view` may only add columns at the end,
-- and inserting one before an existing column renames every column after it.
-- Each branch of the union gains them in the same two positions.
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
  end as can_reschedule
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
  false
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
  false
from public.calendar_events e
where e.cancelled_at is null
  and not exists (
    select 1 from public.tasks t
     where t.id = e.task_id and t.deleted_at is not null
  );

comment on view public.plan_events is
  'Everything with a date, for the Monthly Plan. Excludes deleted work. can_reschedule says whether the viewer may move a due date here; change_task_due_date decides again on every call.';
