-- ============================================================================
-- v150 — a completion stays attributed to whoever did it
--
-- Manager and Employee Change Specification §20: "Store the completion actor
-- separately if a permitted person completes on someone's behalf. Never
-- rewrite historical attribution merely because today's owner/manager
-- changed."
--
-- Neither held. `tasks` recorded WHEN a task was completed and nothing about
-- WHO, so a manager completing on somebody's behalf left no trace outside the
-- audit trail — and every delivery figure read `primary_owner_id`, which is
-- today's owner rather than the one at the time. Reassigning a finished task
-- therefore moved its completion out of one person's history and into
-- another's, months after the fact, and last quarter's numbers changed.
--
-- Two columns, filled at completion and never afterwards:
--
--   completed_owner_id  who the work belonged to when it was finished, which
--                       is who the delivery belongs to for ever
--   completed_by        who pressed the button, which is usually the same
--                       person and occasionally their manager
--
-- Existing rows are backfilled from `primary_owner_id`, which is the best
-- available answer and the one already being used. `completed_by` is left null
-- rather than guessed: the audit trail knows, this column would only be
-- pretending to.
-- ============================================================================

alter table public.tasks
  add column if not exists completed_owner_id uuid references public.user_profiles (id),
  add column if not exists completed_by uuid references public.user_profiles (id);

comment on column public.tasks.completed_owner_id is
  'Section 20. Who the work was attributed to at completion. Frozen: '
  'reassigning a finished task does not move its delivery.';
comment on column public.tasks.completed_by is
  'Section 20. Who performed the completion, when that is not the owner. Null '
  'on rows completed before v150 rather than guessed.';

update public.tasks
   set completed_owner_id = primary_owner_id
 where status = 'completed'
   and completed_at is not null
   and completed_owner_id is null;

-- Delivery is read by owner and period, over a table that keeps everything.
create index if not exists tasks_completed_owner_idx
  on public.tasks (completed_owner_id, completed_at desc)
  where status = 'completed' and deleted_at is null;

-- ----------------------------------------------------------------------------
-- Completion records both, and reopening clears them.
--
-- A reopened task has no completion to attribute. §20 keeps it out of current
-- totals, and leaving a stale owner behind would put it back the moment
-- anything read the frozen column instead of the status.
-- ----------------------------------------------------------------------------

create or replace function focus.freeze_completion_attribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_owner_id := coalesce(new.completed_owner_id, new.primary_owner_id);
    new.completed_by := coalesce(new.completed_by, auth.uid(), new.primary_owner_id);
  elsif new.status <> 'completed' and old.status = 'completed' then
    new.completed_owner_id := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_freeze_completion_attribution on public.tasks;
create trigger tasks_freeze_completion_attribution
  before update of status on public.tasks
  for each row execute function focus.freeze_completion_attribution();

-- ----------------------------------------------------------------------------
-- The view every delivery figure reads.
--
-- `completed_owner_id` is appended and falls back to today's owner for rows
-- that predate the column, which is what those figures already said.
-- ----------------------------------------------------------------------------

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
    t.completed_by
   FROM tasks t
     LEFT JOIN user_profiles owner ON owner.id = t.primary_owner_id
     LEFT JOIN public.person_display owner_dir ON owner_dir.id = t.primary_owner_id
     LEFT JOIN user_profiles assigner ON assigner.id = t.assigned_by
     LEFT JOIN public.person_display assigner_dir ON assigner_dir.id = t.assigned_by
  WHERE t.deleted_at IS NULL;
