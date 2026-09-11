-- ============================================================================
-- v159 - Trackable Steps: your own steps, too
--
-- "The due you assign to another user shows, but the one you assign to
-- yourself doesn't." Every stage drew its line at "assigned to somebody other
-- than the owner" - right for delegation, and wrong for the owner's own steps,
-- which then appeared nowhere but the drawer: no square on the calendar, no
-- warning on the card when one was late.
--
--   task_overview   own_step_overdue_count and next_own_step_due_at, over the
--                   owner's open steps (assigned to them or to nobody) that
--                   have a date of their own. Appended.
--   plan_events     the step branch also returns those steps, and names
--                   whoever owes a step - the owner, for an unassigned one.
--                   No columns change.
--
-- Nothing is written or backfilled; both views stay security_invoker, and the
-- application reads the new columns defensively, so either order of
-- deployment is safe.
-- ============================================================================

create or replace view public.task_overview
with (security_invoker = true) as
  SELECT t.id,
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
    coalesce(owner.full_name, owner_dir.full_name) AS owner_name,
    coalesce(owner.employee_id, owner_dir.employee_id) AS owner_employee_id,
    owner.department_id AS owner_department_id,
    t.assigned_by,
    coalesce(assigner.full_name, assigner_dir.full_name) AS assigned_by_name,
    t.assignment_batch_id,
    t.classification_rule_code,
    t.classification_rule_text,
    t.routine_template_id,
    t.occurrence_date,
    t.created_at,
    t.state_entered_at,
    t.last_meaningful_update_at,
    t.due_at,
    t.due_is_date_only,
    t.review_at,
    t.completed_at,
    t.cancelled_at,
    t.due_at IS NOT NULL AND (t.status = ANY (ARRAY['backlog'::task_status, 'active'::task_status, 'paused'::task_status])) AND now() > t.due_at AS is_overdue,
    t.status = 'active'::task_status AND t.last_meaningful_update_at < (now() - make_interval(days => focus.stale_threshold_days())) AS is_stale,
    ( SELECT count(*) AS count
           FROM barriers b
          WHERE b.task_id = t.id AND b.status = 'open'::barrier_status) AS open_barrier_count,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id) AS checklist_total,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.state = 'completed'::checklist_item_state) AS checklist_completed,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.state = 'ready'::checklist_item_state) AS checklist_ready,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.evidence_rule = 'required'::evidence_rule AND NOT (EXISTS ( SELECT 1
                   FROM attachments a
                  WHERE a.checklist_item_id = ci.id))) AS missing_evidence_count,
    ( SELECT count(*) AS count
           FROM attachments a
          WHERE a.task_id = t.id) AS attachment_count,
    ( SELECT count(*) AS count
           FROM task_collaborators c
          WHERE c.task_id = t.id) AS collaborator_count,
    t.completion_evidence_rule,
    t.completion_evidence_instruction,
    ( SELECT count(*) AS count
           FROM attachments a
          WHERE a.task_id = t.id AND a.is_evidence) AS evidence_count,
    t.work_purpose,
    t.routine_area,
    t.routine_completion_opens_on,
    -- v150 §20 — who this delivery belongs to, decided once and not moved by a
    -- later reassignment.
    coalesce(t.completed_owner_id, t.primary_owner_id) AS completed_owner_id,
    t.completed_by,
    -- v155 - the steps this work has handed to other people, and how they
    -- stand. A step with no date of its own is due when its task is (v154),
    -- so "overdue" reads the step's own date first and the task's after it.
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id
            AND ci.assigned_to IS NOT NULL
            AND ci.assigned_to <> t.primary_owner_id
            AND ci.state <> 'completed'::checklist_item_state) AS delegated_open_count,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id
            AND ci.assigned_to IS NOT NULL
            AND ci.assigned_to <> t.primary_owner_id
            AND ci.state <> 'completed'::checklist_item_state
            AND COALESCE(ci.due_at, t.due_at) < now()) AS delegated_overdue_count,
    ( SELECT min(COALESCE(ci.due_at, t.due_at)) AS min
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id
            AND ci.assigned_to IS NOT NULL
            AND ci.assigned_to <> t.primary_owner_id
            AND ci.state <> 'completed'::checklist_item_state) AS next_delegated_due_at,
    -- v159 - the owner's own steps: assigned to them, or to nobody, with a date
    -- of their own. An undated one is due when the work is, and the work's own
    -- overdue flag already says when that has passed.
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id
            AND (ci.assigned_to IS NULL OR ci.assigned_to = t.primary_owner_id)
            AND ci.state <> 'completed'::checklist_item_state
            AND ci.due_at IS NOT NULL
            AND ci.due_at < now()) AS own_step_overdue_count,
    ( SELECT min(ci.due_at) AS min
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id
            AND (ci.assigned_to IS NULL OR ci.assigned_to = t.primary_owner_id)
            AND ci.state <> 'completed'::checklist_item_state
            AND ci.due_at IS NOT NULL) AS next_own_step_due_at
   FROM tasks t
     LEFT JOIN user_profiles owner ON owner.id = t.primary_owner_id
     LEFT JOIN public.person_display owner_dir ON owner_dir.id = t.primary_owner_id
     LEFT JOIN user_profiles assigner ON assigner.id = t.assigned_by
     LEFT JOIN public.person_display assigner_dir ON assigner_dir.id = t.assigned_by
  WHERE t.deleted_at IS NULL;

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

-- Reproduced from 20260911002000_v155_waiting_on_others.sql (task_overview) and
-- 20260911003000_v156_calendar_steps.sql (plan_events) with the changes above.
