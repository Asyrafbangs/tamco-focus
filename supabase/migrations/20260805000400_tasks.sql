-- ============================================================================
-- TAMCO Focus — the task record
--
-- Implements MASTER_PRODUCT_SPEC.md sections 6, 7, 10, 31B.5-31B.7 and
-- PRODUCTION_LOGIC.md sections 1, 5, 6, 15.
--
-- Two design decisions worth stating once, here:
--
-- 1. A routine occurrence IS a task (`work_class = 'routine_occurrence'` with
--    `routine_template_id` set), not a parallel record type. Section 16.1
--    requires each occurrence to carry its own due date, owner, checklist,
--    evidence, findings, status, completion record, and audit history — which
--    is exactly the task machinery. Modelling it separately would duplicate
--    every one of those tables. The template stays a template and is never
--    itself Active (section 16.1).
--
-- 2. `due_at` always stores the exact instant a commitment expires. For a
--    date-only commitment it holds the organisation-local END of that date in
--    UTC, and `due_is_date_only` records how to render it. This is what stops
--    the accidental one-day-early overdue that section 31B.7 calls out: the
--    single comparison `now() > due_at` is correct for both kinds of due date.
-- ============================================================================

create table public.tasks (
  id uuid primary key default extensions.gen_random_uuid(),

  title text not null,
  description text,

  -- section 10.3 / 25 — "Do Next" is first-class, shown on the row and detail.
  next_action text,

  status public.task_status not null default 'backlog',
  work_class public.work_class not null,
  focus_bucket public.focus_bucket,
  origin public.work_origin not null,
  urgency public.urgency_level not null default 'normal',

  -- section 13.1 — exactly one accountable person.
  primary_owner_id uuid not null references public.user_profiles (id),
  created_by uuid not null references public.user_profiles (id),

  -- Timing. See the header note on `due_at`.
  due_at timestamptz,
  due_is_date_only boolean not null default true,
  review_at timestamptz,

  -- section 11.3 — when a checklist exists it is the single progress source and
  -- this column is maintained from it. Manual entry is only used for tasks
  -- without a checklist.
  progress_percent smallint not null default 0,

  -- section 7.4 — the over-target condition and the reason that produced it.
  over_focus_target boolean not null default false,
  activation_reason_code public.activation_reason,
  activation_reason_note text,
  activated_by uuid references public.user_profiles (id),
  activated_at timestamptz,

  -- section 8.6 / PRODUCTION_LOGIC.md section 4 — mandatory controlled work.
  -- Never set from keyword detection alone; only after the explicit question.
  is_mandatory boolean not null default false,
  mandatory_justification text,

  -- section 16 — set only for generated routine occurrences.
  routine_template_id uuid,
  occurrence_date date,

  -- section 14.3 — a barrier does not by itself pause a task.
  paused_reason text,
  paused_restart_at timestamptz,

  -- section 20.2 — review is metadata, not a fifth state.
  review_status public.review_status not null default 'not_required',
  reviewer_id uuid references public.user_profiles (id),

  -- section 31B.5 — the four independently calculated timeline anchors. These
  -- are stored timestamps, never incrementing day counters (section 15.1).
  created_at timestamptz not null default now(),
  state_entered_at timestamptz not null default now(),
  last_meaningful_update_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,

  updated_at timestamptz not null default now(),

  -- section 6 of PRODUCTION_LOGIC.md — optimistic concurrency. Every
  -- state-changing procedure compares this before committing.
  version integer not null default 1,

  constraint tasks_title_not_blank check (length(btrim(title)) > 0),
  constraint tasks_title_length check (length(title) <= 200),
  constraint tasks_progress_range check (progress_percent between 0 and 100),

  -- section 6.3 / 7.1 — only the three sustained classes carry a focus bucket.
  -- Quick Actions, routine occurrences, and collaborative contributions
  -- explicitly do not consume focus targets.
  constraint tasks_focus_bucket_matches_class check (
    (work_class = 'major_project'      and focus_bucket = 'major')
    or (work_class = 'operational_action' and focus_bucket = 'operational')
    or (work_class = 'self_development'   and focus_bucket = 'self_development')
    or (work_class in ('quick_action', 'routine_occurrence', 'collaborative_contribution')
        and focus_bucket is null)
  ),

  -- A routine occurrence must name its template and its cycle date; nothing
  -- else may claim to be one.
  constraint tasks_routine_fields_consistent check (
    (work_class = 'routine_occurrence'
      and routine_template_id is not null
      and occurrence_date is not null)
    or (work_class <> 'routine_occurrence'
      and routine_template_id is null
      and occurrence_date is null)
  ),

  -- Terminal timestamps must agree with the terminal state.
  constraint tasks_completed_at_consistent check (
    (status = 'completed' and completed_at is not null)
    or (status <> 'completed' and completed_at is null)
  ),
  constraint tasks_cancelled_at_consistent check (
    (status = 'cancelled' and cancelled_at is not null)
    or (status <> 'cancelled' and cancelled_at is null)
  ),

  -- section 7.4 — "Other" is the only reason that additionally requires a note.
  constraint tasks_activation_note_required_for_other check (
    activation_reason_code is distinct from 'other'
    or length(btrim(coalesce(activation_reason_note, ''))) > 0
  ),

  -- Only an active task may currently be over target; the flag is cleared when
  -- the count returns to or below target (PRODUCTION_LOGIC.md section 2.5).
  constraint tasks_over_target_only_when_active check (
    over_focus_target = false or status = 'active'
  ),

  -- Mandatory work must record why it was classified that way.
  constraint tasks_mandatory_requires_justification check (
    is_mandatory = false
    or length(btrim(coalesce(mandatory_justification, ''))) > 0
  ),

  -- A paused task must carry restart or review information (section 14.3).
  constraint tasks_paused_requires_restart_information check (
    status <> 'paused'
    or paused_restart_at is not null
    or review_at is not null
    or length(btrim(coalesce(paused_reason, ''))) > 0
  ),

  constraint tasks_version_positive check (version >= 1)
);

-- Focus counting is the hottest read path in the product: every activation,
-- every badge, and every Team Load row recalculates it from committed state.
create index tasks_focus_count_idx
  on public.tasks (primary_owner_id, focus_bucket)
  where status = 'active' and focus_bucket is not null;

create index tasks_owner_status_idx on public.tasks (primary_owner_id, status);
create index tasks_due_idx on public.tasks (due_at)
  where status in ('backlog', 'active', 'paused');
create index tasks_review_idx on public.tasks (review_at)
  where status in ('backlog', 'active', 'paused');
create index tasks_stale_idx on public.tasks (last_meaningful_update_at)
  where status = 'active';
create index tasks_routine_template_idx on public.tasks (routine_template_id, occurrence_date)
  where routine_template_id is not null;
create index tasks_review_queue_idx on public.tasks (reviewer_id, review_status)
  where review_status = 'pending';
create index tasks_mandatory_idx on public.tasks (is_mandatory)
  where is_mandatory = true and status <> 'completed';

create trigger tasks_touch_updated_at
  before update on public.tasks
  for each row execute function focus.touch_updated_at();

-- ---------------------------------------------------------------------------
-- State entry timestamp.
--
-- section 31B.5: current-state age resets on each valid state transition and
-- ONLY on a state transition. Deriving it from a trigger rather than from
-- application code means no caller can forget to set it, and no caller can
-- reset it by touching an unrelated column.
-- ---------------------------------------------------------------------------

create or replace function focus.stamp_state_entered_at()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.state_entered_at := now();
  end if;
  return new;
end;
$$;

create trigger tasks_stamp_state_entered_at
  before update on public.tasks
  for each row execute function focus.stamp_state_entered_at();

-- ---------------------------------------------------------------------------
-- Collaborators (section 13).
--
-- A collaborator contributes without becoming the primary owner and without
-- consuming a second focus target (section 13.2).
-- ---------------------------------------------------------------------------

create table public.task_collaborators (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id),
  added_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),

  constraint task_collaborators_unique unique (task_id, user_id)
);

create index task_collaborators_user_idx on public.task_collaborators (user_id);

-- The primary owner is accountable through `tasks.primary_owner_id`; listing
-- them again as a collaborator would double-count them in every "shared with
-- me" query.
create or replace function focus.assert_collaborator_is_not_owner()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from public.tasks
     where id = new.task_id and primary_owner_id = new.user_id
  ) then
    raise exception 'The primary owner is already accountable and cannot also be a collaborator'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger task_collaborators_not_owner
  before insert or update on public.task_collaborators
  for each row execute function focus.assert_collaborator_is_not_owner();

-- ---------------------------------------------------------------------------
-- Related Work (section 15).
--
-- User-facing wording is "Before this task" / "After this task" / "Related
-- only". A relationship must never silently change status, owner, priority,
-- due date, or focus target (section 15.3) — nothing in this schema does.
-- ---------------------------------------------------------------------------

create table public.task_relations (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  related_task_id uuid not null references public.tasks (id) on delete cascade,
  relation public.relation_type not null,
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),

  constraint task_relations_not_self check (task_id <> related_task_id),
  constraint task_relations_unique unique (task_id, related_task_id)
);

create index task_relations_related_idx on public.task_relations (related_task_id);
