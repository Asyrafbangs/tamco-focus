-- ---------------------------------------------------------------------------
-- v40 — manager assignment, batch assignment, and auditable classification.
--
-- Three additions, none of which changes the meaning of an existing column:
--
--   1. `assigned_by` records that somebody other than the owner directed this
--      work. It is provenance, not priority: v40 section 4 is explicit that
--      manager-assigned work must not outrank more critical work simply
--      because a manager created it. Nothing sorts on this column.
--
--   2. `assignment_batch_id` groups the independent task records produced when
--      one instruction is assigned separately to several people (section 6).
--      The tasks stay wholly independent — their own state, progress, due date,
--      evidence and audit trail. The batch id exists so the instruction can be
--      traced, not so the tasks can be treated as one.
--
--   3. `classification_rule_code` / `classification_rule_text` record WHY a
--      work class was chosen (section 12). Without them the audit trail can say
--      a task became Operational but not on what basis, which invites the
--      reading that something semantically "understood" the request. It did
--      not: a deterministic rule fired, and these columns name it.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists assigned_by uuid references public.user_profiles (id),
  add column if not exists assignment_batch_id uuid,
  add column if not exists classification_rule_code text,
  add column if not exists classification_rule_text text;

comment on column public.tasks.assigned_by is
  'The manager who directed this work, when it was not self-initiated. '
  'Provenance only - never a sort key and never a priority input.';

comment on column public.tasks.assignment_batch_id is
  'Groups the independent task records created from one multi-person '
  'assignment. Shared identifier, independent accountability.';

comment on column public.tasks.classification_rule_code is
  'Stable code for the deterministic rule that selected this work class.';

comment on column public.tasks.classification_rule_text is
  'The same rule in the words shown to the person at capture time.';

-- A batch is only ever read whole, so the id alone is the useful index.
create index if not exists tasks_assignment_batch_idx
  on public.tasks (assignment_batch_id)
  where assignment_batch_id is not null;

-- "What has my manager given me that I have not started?" is the query behind
-- the Available list and behind My Day's exception check.
create index if not exists tasks_assigned_by_idx
  on public.tasks (assigned_by, status)
  where assigned_by is not null;

-- Rule text is only meaningful alongside its code.
alter table public.tasks
  drop constraint if exists tasks_classification_rule_complete;
alter table public.tasks
  add constraint tasks_classification_rule_complete check (
    (classification_rule_code is null and classification_rule_text is null)
    or (classification_rule_code is not null
        and length(btrim(coalesce(classification_rule_text, ''))) > 0)
  );

-- ---------------------------------------------------------------------------
-- `task_overview` is the single joined read every list uses, so the new columns
-- have to reach it. Recreated rather than replaced because adding columns to a
-- view is not a permitted CREATE OR REPLACE change.
-- ---------------------------------------------------------------------------

drop view if exists public.task_overview cascade;

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

  -- v40. Provenance and the rule that classified the work. `assigned_by_name`
  -- is what the row prints as "Assigned by Izzul"; none of these four are ever
  -- an ordering input (v40 section 4).
  t.assigned_by,
  assigner.full_name     as assigned_by_name,
  t.assignment_batch_id,
  t.classification_rule_code,
  t.classification_rule_text,

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
join public.user_profiles owner on owner.id = t.primary_owner_id
left join public.user_profiles assigner on assigner.id = t.assigned_by;

grant select on public.task_overview to authenticated;
