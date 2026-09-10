-- ============================================================================
-- v155 - Trackable Steps, stage 2: waiting on others
--
-- "You shouldn't have to open every parent task." The owner of a piece of work
-- could see "1/3 steps" and nothing about whose steps they were, so a step
-- handed to Amer and now two days late looked, from the Active list, exactly
-- like one that was fine. The work itself was not overdue; the thing it was
-- waiting on was.
--
-- Two reads, both appended - `create or replace view` may only add columns at
-- the end, and inserting one renames every column after it:
--
--   task_overview          delegated_open_count, delegated_overdue_count and
--                          next_delegated_due_at, for the Active card and for
--                          Needs attention. A delegated step is one assigned
--                          to anybody but the work's owner and not yet done;
--                          its date is its own, or its task's when it has
--                          none (v154).
--   shared_contributions   assignee_name, so the owner's "Waiting on others"
--                          can say who. The owner reads the same projection
--                          the assignee's Shared list reads - one step record,
--                          seen from the other side - and RLS already lets
--                          each of them see it.
--
-- Nothing is written, nothing is backfilled, and both views keep
-- security_invoker: this adds what can be read about rows people can already
-- read, and grants nothing.
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
            AND ci.state <> 'completed'::checklist_item_state) AS next_delegated_due_at
   FROM tasks t
     LEFT JOIN user_profiles owner ON owner.id = t.primary_owner_id
     LEFT JOIN public.person_display owner_dir ON owner_dir.id = t.primary_owner_id
     LEFT JOIN user_profiles assigner ON assigner.id = t.assigned_by
     LEFT JOIN public.person_display assigner_dir ON assigner_dir.id = t.assigned_by
  WHERE t.deleted_at IS NULL;

create or replace view public.shared_contributions
with (security_invoker = true)
as
select
  item.id as checklist_item_id,
  item.task_id,
  item.action as title,
  item.assigned_to as assignee_id,
  item.evidence_rule,
  item.due_at as item_due_at,
  item.depends_on_item_id,
  item.state,
  item.completed_at,
  item.position,
  parent.title as parent_title,
  parent.status as parent_status,
  parent.work_class as parent_work_class,
  parent.due_at as parent_due_at,
  parent.due_is_date_only as parent_due_is_date_only,
  parent.primary_owner_id,
  coalesce(owner.full_name, 'Team member') as primary_owner_name,
  prerequisite.action as prerequisite_title,
  case
    when parent.status = 'backlog' then 'waiting_for_owner'
    when parent.status = 'paused' then 'waiting_parent_paused'
    when item.depends_on_item_id is not null
         and coalesce(prerequisite.state, 'waiting') <> 'completed'
      then 'waiting_prerequisite'
    when parent.status = 'active' then 'ready'
    else 'waiting'
  end as readiness,
  -- v146 §10 — appended, because `create or replace view` may only add columns
  -- at the end and inserting one renames every column after it.
  item.assigned_by,
  item.assigned_at,
  assigner.full_name as assigned_by_name,
  -- v155 - whose it is, by name, for the owner waiting on it. The assignee's
  -- Shared list never needed it: that list is theirs.
  assignee.full_name as assignee_name
from public.task_checklist_items item
join public.tasks parent on parent.id = item.task_id
left join public.team_directory owner on owner.id = parent.primary_owner_id
left join public.team_directory assigner on assigner.id = item.assigned_by
left join public.team_directory assignee on assignee.id = item.assigned_to
left join public.task_checklist_items prerequisite on prerequisite.id = item.depends_on_item_id
where item.assigned_to is not null
  and item.assigned_to <> parent.primary_owner_id
  and item.state <> 'completed'
  and parent.status in ('backlog', 'active', 'paused');

-- Reproduced from 20260909009000_v150_completion_attribution.sql and 20260909004000_v146_shared_contribution_provenance.sql with the columns appended.
