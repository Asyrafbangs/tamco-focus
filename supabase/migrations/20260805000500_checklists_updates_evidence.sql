-- ============================================================================
-- TAMCO Focus — checklists, updates, attachments, evidence, and barriers
--
-- Implements MASTER_PRODUCT_SPEC.md sections 11, 12, 13.3, 14, 20.4.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Checklist items (section 11.1).
--
-- `state` is stored rather than derived because the Waiting -> Ready handoff
-- (section 13.3) must be observable by the collaborator's My Day query without
-- recomputing a dependency graph on every read.
-- ---------------------------------------------------------------------------

create type public.checklist_item_state as enum (
  'waiting',
  'ready',
  'completed'
);

create table public.task_checklist_items (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  position smallint not null,

  action text not null,
  assigned_to uuid references public.user_profiles (id),

  evidence_rule public.evidence_rule not null default 'not_required',

  -- section 11.1 — a due date only when it differs from the parent task.
  due_at timestamptz,

  -- section 11.1 — dependency on another checklist item drives the handoff.
  depends_on_item_id uuid references public.task_checklist_items (id) on delete set null,

  state public.checklist_item_state not null default 'ready',
  completed_by uuid references public.user_profiles (id),
  completed_at timestamptz,
  completion_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_checklist_items_action_not_blank check (length(btrim(action)) > 0),
  constraint task_checklist_items_position_positive check (position >= 0),
  constraint task_checklist_items_not_self_dependent
    check (depends_on_item_id is null or depends_on_item_id <> id),
  constraint task_checklist_items_completion_consistent check (
    (state = 'completed' and completed_at is not null and completed_by is not null)
    or (state <> 'completed' and completed_at is null and completed_by is null)
  ),
  constraint task_checklist_items_position_unique unique (task_id, position)
    deferrable initially deferred
);

create index task_checklist_items_task_idx on public.task_checklist_items (task_id, position);
create index task_checklist_items_assignee_idx
  on public.task_checklist_items (assigned_to, state)
  where assigned_to is not null;
create index task_checklist_items_depends_idx
  on public.task_checklist_items (depends_on_item_id)
  where depends_on_item_id is not null;

create trigger task_checklist_items_touch_updated_at
  before update on public.task_checklist_items
  for each row execute function focus.touch_updated_at();

-- section 13.3 — when a prerequisite completes, its dependents become Ready.
-- Reopening the prerequisite (section 11.4) returns them to Waiting, because a
-- handoff that was never really finished must not stay actionable.
create or replace function focus.propagate_checklist_handoff()
returns trigger
language plpgsql
as $$
begin
  if new.state = 'completed' and old.state is distinct from 'completed' then
    update public.task_checklist_items
       set state = 'ready'
     where depends_on_item_id = new.id
       and state = 'waiting';

  elsif old.state = 'completed' and new.state is distinct from 'completed' then
    update public.task_checklist_items
       set state = 'waiting'
     where depends_on_item_id = new.id
       and state = 'ready';
  end if;

  return new;
end;
$$;

create trigger task_checklist_items_propagate_handoff
  after update of state on public.task_checklist_items
  for each row execute function focus.propagate_checklist_handoff();

-- A new item that depends on an unfinished prerequisite starts Waiting.
create or replace function focus.default_checklist_item_state()
returns trigger
language plpgsql
as $$
begin
  if new.depends_on_item_id is not null and new.state = 'ready' then
    if not exists (
      select 1 from public.task_checklist_items
       where id = new.depends_on_item_id and state = 'completed'
    ) then
      new.state := 'waiting';
    end if;
  end if;
  return new;
end;
$$;

create trigger task_checklist_items_default_state
  before insert on public.task_checklist_items
  for each row execute function focus.default_checklist_item_state();

-- ---------------------------------------------------------------------------
-- Barriers (section 14).
-- ---------------------------------------------------------------------------

create table public.barriers (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,

  -- section 14.2 — the three questions the barrier form asks.
  description text not null,
  support_needed text not null,
  impact public.barrier_impact not null,

  add_to_meeting_queue boolean not null default false,

  status public.barrier_status not null default 'open',
  raised_by uuid not null references public.user_profiles (id),
  raised_at timestamptz not null default now(),
  resolved_by uuid references public.user_profiles (id),
  resolved_at timestamptz,
  resolution_note text,

  constraint barriers_description_not_blank check (length(btrim(description)) > 0),
  constraint barriers_support_not_blank check (length(btrim(support_needed)) > 0),
  constraint barriers_resolution_consistent check (
    (status = 'resolved' and resolved_at is not null and resolved_by is not null)
    or (status = 'open' and resolved_at is null and resolved_by is null)
  )
);

create index barriers_task_idx on public.barriers (task_id, status);
create index barriers_open_idx on public.barriers (status, raised_at) where status = 'open';

-- ---------------------------------------------------------------------------
-- Updates (section 12).
-- ---------------------------------------------------------------------------

create table public.task_updates (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null references public.user_profiles (id),

  body text,

  -- section 12.1 — an evidence-only update carries attachments and no prose.
  is_evidence_only boolean not null default false,

  -- Set when the update was posted as part of raising a barrier, so the
  -- activity feed can show them as one event rather than two.
  barrier_id uuid references public.barriers (id) on delete set null,

  -- section 15.2 of PRODUCTION_LOGIC.md — mere viewing does not reset stale
  -- age, but a written update does. This flag records whether this row is one
  -- of the qualifying events.
  is_meaningful boolean not null default true,

  created_at timestamptz not null default now(),

  constraint task_updates_body_present_unless_evidence_only check (
    is_evidence_only = true or length(btrim(coalesce(body, ''))) > 0
  )
);

create index task_updates_task_idx on public.task_updates (task_id, created_at desc);
create index task_updates_author_idx on public.task_updates (author_id, created_at desc);

-- section 12.2 — mention recipients are part of the automatic record.
create table public.task_update_mentions (
  update_id uuid not null references public.task_updates (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id),
  primary key (update_id, user_id)
);

create index task_update_mentions_user_idx on public.task_update_mentions (user_id);

-- ---------------------------------------------------------------------------
-- Attachments (section 12, section 28.1).
--
-- The file itself lives in a PRIVATE Storage bucket. This table is the
-- ownership and authorisation record; `storage_path` is never handed to the
-- browser directly, only exchanged for a short-lived signed URL by an
-- authorised server route.
-- ---------------------------------------------------------------------------

create table public.attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,

  -- An attachment may be evidence for a specific checklist item, the payload of
  -- an update, or completion evidence for the task as a whole.
  checklist_item_id uuid references public.task_checklist_items (id) on delete cascade,
  update_id uuid references public.task_updates (id) on delete cascade,

  storage_bucket text not null default 'task-attachments',
  storage_path text not null,

  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  checksum_sha256 text,

  is_evidence boolean not null default false,

  -- Honest recording of scan state. `pending` means no scan has run — the
  -- application never claims a file was scanned when it was not.
  virus_scan_state text not null default 'not_scanned',

  uploaded_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),

  constraint attachments_file_name_not_blank check (length(btrim(file_name)) > 0),
  constraint attachments_byte_size_positive check (byte_size > 0),
  constraint attachments_storage_path_unique unique (storage_bucket, storage_path),
  constraint attachments_scan_state_known
    check (virus_scan_state in ('not_scanned', 'pending', 'clean', 'infected'))
);

create index attachments_task_idx on public.attachments (task_id, created_at desc);
create index attachments_checklist_item_idx on public.attachments (checklist_item_id)
  where checklist_item_id is not null;
create index attachments_update_idx on public.attachments (update_id)
  where update_id is not null;
create index attachments_evidence_idx on public.attachments (task_id)
  where is_evidence = true;

-- ---------------------------------------------------------------------------
-- Evidence view log (section 20.4).
--
-- Opening an attachment records reviewer, attachment, and time automatically.
-- There is deliberately no manual "Viewed" checkbox anywhere in the product,
-- and viewing is explicitly NOT acceptance (section 20.5).
-- ---------------------------------------------------------------------------

create table public.attachment_views (
  id uuid primary key default extensions.gen_random_uuid(),
  attachment_id uuid not null references public.attachments (id) on delete cascade,
  viewer_id uuid not null references public.user_profiles (id),
  viewed_at timestamptz not null default now()
);

create index attachment_views_attachment_idx
  on public.attachment_views (attachment_id, viewed_at desc);
create index attachment_views_viewer_idx on public.attachment_views (viewer_id, viewed_at desc);

-- ---------------------------------------------------------------------------
-- Capture Work staging (section 8).
--
-- Capture is a two-step flow: record the work in about ten seconds, then
-- confirm a recommended destination. The intermediate state is persisted so a
-- dropped connection between "Add Work" and "Confirm & Create" cannot lose
-- what the employee already typed or attached (section 27.4).
-- ---------------------------------------------------------------------------

create table public.work_captures (
  id uuid primary key default extensions.gen_random_uuid(),
  captured_by uuid not null references public.user_profiles (id),

  title text not null,
  timing_choice text not null,
  due_at timestamptz,
  due_is_date_only boolean not null default true,

  -- section 8.7 — the user must see why a destination was recommended, and the
  -- final choice must be audited alongside the recommendation.
  recommended_destination public.capture_destination not null,
  recommendation_reason text not null,
  chosen_destination public.capture_destination,

  -- section 8.6 — recorded only when the explicit urgency question was asked
  -- and answered. Keyword detection alone never sets a mandatory outcome.
  urgency_question_asked boolean not null default false,
  urgency_question_answer boolean,
  followup_question text,
  followup_answer text,

  status public.capture_status not null default 'pending_confirmation',
  created_task_id uuid references public.tasks (id) on delete set null,

  created_at timestamptz not null default now(),
  resolved_at timestamptz,

  constraint work_captures_title_not_blank check (length(btrim(title)) > 0),
  constraint work_captures_timing_known
    check (timing_choice in ('today', 'this_week', 'choose_date', 'no_date')),
  constraint work_captures_reason_not_blank check (length(btrim(recommendation_reason)) > 0),
  constraint work_captures_resolution_consistent check (
    (status = 'pending_confirmation' and resolved_at is null)
    or (status <> 'pending_confirmation' and resolved_at is not null)
  ),
  -- A mandatory outcome is only reachable once the question was actually asked
  -- and answered yes. This is the database-level expression of section 8.6.
  constraint work_captures_mandatory_requires_answer check (
    chosen_destination is distinct from 'mandatory_operational_action'
    or (urgency_question_asked = true and urgency_question_answer = true)
  )
);

create index work_captures_user_idx on public.work_captures (captured_by, status, created_at desc);

-- Attachments captured before the task exists (section 8.3). They are moved on
-- to the created task at confirmation time.
create table public.work_capture_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  capture_id uuid not null references public.work_captures (id) on delete cascade,
  storage_bucket text not null default 'task-attachments',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  created_at timestamptz not null default now(),

  constraint work_capture_attachments_size_positive check (byte_size > 0),
  constraint work_capture_attachments_path_unique unique (storage_bucket, storage_path)
);
