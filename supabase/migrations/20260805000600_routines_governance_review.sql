-- ============================================================================
-- TAMCO Focus — routine work, governance proposals, meeting queue, review
--
-- Implements MASTER_PRODUCT_SPEC.md sections 8.8, 16, 19, 20.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Routine templates (section 16.1, 16.2).
--
-- A template is controlled and does NOT stay permanently Active. It generates
-- separate occurrences, each of which is a task.
-- ---------------------------------------------------------------------------

create table public.routine_templates (
  id uuid primary key default extensions.gen_random_uuid(),

  title text not null,
  description text,

  default_owner_id uuid not null references public.user_profiles (id),

  frequency public.recurrence_frequency not null,
  -- Every `interval_count` periods: 2 + 'weekly' is fortnightly.
  interval_count smallint not null default 1,
  -- ISO weekday (1 = Monday) for weekly recurrence.
  weekday smallint,
  -- Day of month for monthly recurrence. 29-31 clamp to the month's last day.
  day_of_month smallint,
  -- Organisation-local time of day the occurrence is due.
  due_time time not null default '17:00',

  -- section 20.7 — ordinary occurrences may auto-archive; mandatory evidence
  -- or policy forces a review.
  requires_completion_review boolean not null default false,
  evidence_required boolean not null default false,

  is_active boolean not null default true,

  -- Watermark: occurrences have been generated up to and including this date,
  -- which is what makes generation idempotent and safely repeatable.
  generated_through date,

  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint routine_templates_title_not_blank check (length(btrim(title)) > 0),
  constraint routine_templates_interval_positive check (interval_count between 1 and 52),
  constraint routine_templates_weekday_range check (weekday is null or weekday between 1 and 7),
  constraint routine_templates_day_of_month_range
    check (day_of_month is null or day_of_month between 1 and 31),
  -- Each frequency needs exactly the fields it uses, and none of the others.
  constraint routine_templates_schedule_fields_match_frequency check (
    (frequency = 'daily'   and weekday is null and day_of_month is null)
    or (frequency = 'weekly'  and weekday is not null and day_of_month is null)
    or (frequency = 'monthly' and weekday is null and day_of_month is not null)
  )
);

create index routine_templates_active_idx on public.routine_templates (is_active, generated_through);
create index routine_templates_owner_idx on public.routine_templates (default_owner_id);

create trigger routine_templates_touch_updated_at
  before update on public.routine_templates
  for each row execute function focus.touch_updated_at();

-- Now that the template table exists, close the loop from tasks.
alter table public.tasks
  add constraint tasks_routine_template_fk
  foreign key (routine_template_id) references public.routine_templates (id);

-- One occurrence per template per cycle date. This is the constraint that makes
-- occurrence generation safe to re-run: a duplicated job inserts nothing.
create unique index tasks_routine_occurrence_unique
  on public.tasks (routine_template_id, occurrence_date)
  where routine_template_id is not null;

-- Checklist steps copied on to each generated occurrence (section 16.5).
create table public.routine_template_items (
  id uuid primary key default extensions.gen_random_uuid(),
  template_id uuid not null references public.routine_templates (id) on delete cascade,
  position smallint not null,
  action text not null,
  evidence_rule public.evidence_rule not null default 'not_required',

  constraint routine_template_items_action_not_blank check (length(btrim(action)) > 0),
  constraint routine_template_items_position_unique unique (template_id, position)
);

-- ---------------------------------------------------------------------------
-- Routine findings (section 16.4).
--
-- Minor findings close inside the occurrence. Significant findings create
-- linked Operational Available Work whose owner then decides activation under
-- the ordinary focus rules — the finding never force-activates anything.
-- ---------------------------------------------------------------------------

create table public.routine_findings (
  id uuid primary key default extensions.gen_random_uuid(),
  occurrence_task_id uuid not null references public.tasks (id) on delete cascade,
  severity public.finding_severity not null,
  description text not null,
  -- Set for significant findings and immediate risks.
  created_task_id uuid references public.tasks (id) on delete set null,
  recorded_by uuid not null references public.user_profiles (id),
  recorded_at timestamptz not null default now(),

  constraint routine_findings_description_not_blank check (length(btrim(description)) > 0),
  -- A minor finding is corrected and closed inside the occurrence, so it must
  -- not spawn separate work; anything more severe must.
  constraint routine_findings_followup_matches_severity check (
    (severity = 'minor' and created_task_id is null)
    or (severity <> 'minor')
  )
);

create index routine_findings_occurrence_idx on public.routine_findings (occurrence_task_id);

-- ---------------------------------------------------------------------------
-- Governance proposals (section 8.8).
--
-- Employees may create and manage their own work. These are the narrow cases
-- that genuinely need manager or administrator review: Major Project proposals
-- and new recurring Routine Templates.
-- ---------------------------------------------------------------------------

create table public.work_proposals (
  id uuid primary key default extensions.gen_random_uuid(),
  kind text not null,

  title text not null,
  rationale text,

  proposed_by uuid not null references public.user_profiles (id),
  status public.proposal_status not null default 'pending',

  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,
  decision_note text,

  -- Populated on approval.
  created_task_id uuid references public.tasks (id) on delete set null,
  created_template_id uuid references public.routine_templates (id) on delete set null,

  -- Carries the proposed schedule for a routine template request.
  payload jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint work_proposals_kind_known
    check (kind in ('major_project', 'routine_template')),
  constraint work_proposals_title_not_blank check (length(btrim(title)) > 0),
  constraint work_proposals_decision_consistent check (
    (status = 'pending' and decided_at is null and decided_by is null)
    or (status <> 'pending' and decided_at is not null and decided_by is not null)
  )
);

create index work_proposals_status_idx on public.work_proposals (status, created_at desc);
create index work_proposals_proposer_idx on public.work_proposals (proposed_by);

-- ---------------------------------------------------------------------------
-- Meeting / decision queue (section 19).
--
-- Meetings discuss only what needs a decision, support, escalation,
-- reprioritisation, or clarification.
-- ---------------------------------------------------------------------------

create table public.meeting_queue_items (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid references public.tasks (id) on delete cascade,
  barrier_id uuid references public.barriers (id) on delete cascade,

  source public.meeting_item_source not null,
  summary text not null,

  status public.meeting_item_status not null default 'open',

  -- section 19.3 — the decision record.
  decision text,
  decision_owner_id uuid references public.user_profiles (id),
  decision_due_at timestamptz,
  decided_by uuid references public.user_profiles (id),
  decided_at timestamptz,

  created_at timestamptz not null default now(),

  constraint meeting_queue_items_summary_not_blank check (length(btrim(summary)) > 0),
  constraint meeting_queue_items_decision_consistent check (
    (status = 'decided'
      and decided_at is not null
      and decided_by is not null
      and length(btrim(coalesce(decision, ''))) > 0)
    or (status <> 'decided' and decided_at is null)
  ),
  -- Every queue item must point at the work it concerns.
  constraint meeting_queue_items_subject_present
    check (task_id is not null or barrier_id is not null)
);

create index meeting_queue_items_status_idx on public.meeting_queue_items (status, created_at desc);
create index meeting_queue_items_task_idx on public.meeting_queue_items (task_id);

-- A barrier should reach the queue once, not once per retry.
create unique index meeting_queue_items_barrier_unique
  on public.meeting_queue_items (barrier_id)
  where barrier_id is not null;

-- ---------------------------------------------------------------------------
-- Completion review (section 20).
--
-- Pending Review is review metadata on the task, not a fifth state. This table
-- records the decision itself and preserves the full history across repeated
-- Request Changes cycles.
-- ---------------------------------------------------------------------------

create table public.completion_reviews (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,

  submitted_by uuid not null references public.user_profiles (id),
  submitted_at timestamptz not null default now(),

  reviewer_id uuid references public.user_profiles (id),
  decision public.review_decision,
  decision_note text,
  decided_at timestamptz,

  -- section 22.3 — dual verification where required.
  second_reviewer_id uuid references public.user_profiles (id),
  second_decision public.review_decision,
  second_decided_at timestamptz,

  constraint completion_reviews_decision_consistent check (
    (decision is null and decided_at is null)
    or (decision is not null and decided_at is not null and reviewer_id is not null)
  ),
  constraint completion_reviews_second_decision_consistent check (
    (second_decision is null and second_decided_at is null)
    or (second_decision is not null
        and second_decided_at is not null
        and second_reviewer_id is not null)
  )
);

create index completion_reviews_task_idx on public.completion_reviews (task_id, submitted_at desc);
create index completion_reviews_pending_idx
  on public.completion_reviews (reviewer_id, submitted_at)
  where decision is null;

-- Only one review may be awaiting a decision for a task at a time.
create unique index completion_reviews_one_open_per_task
  on public.completion_reviews (task_id)
  where decision is null;
