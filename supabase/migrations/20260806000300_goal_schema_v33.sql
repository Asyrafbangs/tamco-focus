-- ============================================================================
-- TAMCO Focus v33 — persistent Goal, milestone, update, evidence and agreement
-- model. Existing task data is untouched; every new relationship is additive.
-- ============================================================================

create table public.goals (
  id uuid primary key default extensions.gen_random_uuid(),
  owner_id uuid not null references public.user_profiles (id),
  manager_id uuid references public.user_profiles (id),
  created_by uuid not null references public.user_profiles (id),

  title text not null,
  category text not null default 'performance',
  status public.goal_status not null default 'draft',
  health public.goal_health not null default 'on_track',

  -- The employee-reported value is deliberately independent of the weighted
  -- milestone value exposed by the read view.
  reported_progress smallint not null default 0,
  target_date date not null,
  weight_percent smallint not null default 0,

  checkin_due_at timestamptz,
  update_requested_at timestamptz,
  last_meaningful_update_at timestamptz not null default now(),

  active_version_id uuid,
  pending_version_id uuid,
  agreed_at timestamptz,
  completed_at timestamptz,
  closed_at timestamptz,

  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint goals_title_not_blank check (length(btrim(title)) > 0),
  constraint goals_category_known check (category in ('performance', 'improvement', 'development')),
  constraint goals_reported_progress_step check (
    reported_progress between 0 and 100 and reported_progress % 5 = 0
  ),
  constraint goals_weight_range check (weight_percent between 0 and 100),
  constraint goals_version_positive check (version > 0),
  constraint goals_completion_consistent check (
    (status in ('completed', 'closed') and completed_at is not null)
    or (status not in ('completed', 'closed') and completed_at is null)
  ),
  constraint goals_closed_consistent check (
    (status = 'closed' and closed_at is not null)
    or (status <> 'closed' and closed_at is null)
  )
);

create index goals_owner_status_idx on public.goals (owner_id, status, target_date);
create index goals_manager_status_idx on public.goals (manager_id, status, target_date);
create index goals_attention_idx
  on public.goals (health, checkin_due_at, update_requested_at, target_date)
  where status = 'active';
create trigger goals_touch_updated_at
  before update on public.goals
  for each row execute function focus.touch_updated_at();

create table public.goal_participants (
  goal_id uuid not null references public.goals (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id),
  participant_role text not null,
  added_by uuid not null references public.user_profiles (id),
  added_at timestamptz not null default now(),
  primary key (goal_id, user_id),
  constraint goal_participants_role_known
    check (participant_role in ('employee', 'manager', 'reviewer'))
);
create index goal_participants_user_idx on public.goal_participants (user_id, goal_id);

create table public.goal_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  version_number integer not null,
  status public.goal_version_status not null default 'pending',

  title text not null,
  expected_result text not null,
  success_measure text not null,
  employee_approach text,
  support_agreed text,
  dependencies text,
  baseline text,
  purpose text,
  target_date date not null,
  weight_percent smallint not null default 0,

  proposed_by uuid not null references public.user_profiles (id),
  proposed_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  version integer not null default 1,

  constraint goal_versions_number_positive check (version_number > 0),
  constraint goal_versions_title_not_blank check (length(btrim(title)) > 0),
  constraint goal_versions_result_not_blank check (length(btrim(expected_result)) > 0),
  constraint goal_versions_measure_not_blank check (length(btrim(success_measure)) > 0),
  constraint goal_versions_weight_range check (weight_percent between 0 and 100),
  constraint goal_versions_version_positive check (version > 0),
  constraint goal_versions_unique_number unique (goal_id, version_number)
);
create unique index goal_versions_one_active_idx
  on public.goal_versions (goal_id) where status = 'active';
create unique index goal_versions_one_pending_idx
  on public.goal_versions (goal_id) where status = 'pending';
create index goal_versions_goal_history_idx
  on public.goal_versions (goal_id, version_number desc);

alter table public.goals
  add constraint goals_active_version_fk
    foreign key (active_version_id) references public.goal_versions (id),
  add constraint goals_pending_version_fk
    foreign key (pending_version_id) references public.goal_versions (id);

create table public.goal_milestones (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_version_id uuid not null references public.goal_versions (id) on delete cascade,
  source_milestone_id uuid references public.goal_milestones (id),
  position smallint not null,
  title text not null,
  completion_definition text not null,
  weight_percent smallint not null,
  progress_percent smallint not null default 0,
  completed_by uuid references public.user_profiles (id),
  completed_at timestamptz,
  last_update_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint goal_milestones_position_positive check (position > 0),
  constraint goal_milestones_title_not_blank check (length(btrim(title)) > 0),
  constraint goal_milestones_definition_not_blank
    check (length(btrim(completion_definition)) > 0),
  constraint goal_milestones_weight_range check (weight_percent between 1 and 100),
  constraint goal_milestones_progress_step check (
    progress_percent between 0 and 100 and progress_percent % 5 = 0
  ),
  constraint goal_milestones_completion_consistent check (
    (progress_percent = 100 and completed_at is not null and completed_by is not null)
    or (progress_percent < 100 and completed_at is null and completed_by is null)
  ),
  constraint goal_milestones_unique_position unique (goal_version_id, position)
);
create index goal_milestones_version_idx
  on public.goal_milestones (goal_version_id, position);
create index goal_milestones_source_idx on public.goal_milestones (source_milestone_id)
  where source_milestone_id is not null;

create table public.goal_agreements (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  goal_version_id uuid not null references public.goal_versions (id),
  employee_id uuid not null references public.user_profiles (id),
  manager_id uuid not null references public.user_profiles (id),
  agreed_by uuid not null references public.user_profiles (id),
  agreed_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  constraint goal_agreements_one_per_version unique (goal_version_id)
);
create index goal_agreements_goal_idx on public.goal_agreements (goal_id, agreed_at desc);

create table public.goal_updates (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  goal_version_id uuid not null references public.goal_versions (id),
  author_id uuid not null references public.user_profiles (id),
  kind public.goal_update_kind not null default 'overall',
  previous_reported_progress smallint not null,
  new_reported_progress smallint not null,
  what_changed text not null,
  next_step text,
  support_requested boolean not null default false,
  support_details text,
  created_at timestamptz not null default now(),

  constraint goal_updates_progress_range check (
    previous_reported_progress between 0 and 100
    and new_reported_progress between 0 and 100
    and previous_reported_progress % 5 = 0
    and new_reported_progress % 5 = 0
  ),
  constraint goal_updates_changed_not_blank check (length(btrim(what_changed)) > 0),
  constraint goal_updates_support_detail check (
    support_requested = false or length(btrim(coalesce(support_details, ''))) > 0
  )
);
create index goal_updates_goal_idx on public.goal_updates (goal_id, created_at desc);
create index goal_updates_author_idx on public.goal_updates (author_id, created_at desc);

create table public.goal_milestone_updates (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  milestone_id uuid not null references public.goal_milestones (id),
  author_id uuid not null references public.user_profiles (id),
  previous_progress smallint not null,
  new_progress smallint not null,
  comment text,
  marked_complete boolean not null default false,
  created_at timestamptz not null default now(),

  constraint goal_milestone_updates_progress_range check (
    previous_progress between 0 and 100
    and new_progress between 0 and 100
    and previous_progress % 5 = 0
    and new_progress % 5 = 0
  ),
  constraint goal_milestone_updates_complete_consistent check (
    marked_complete = false or new_progress = 100
  )
);
create index goal_milestone_updates_goal_idx
  on public.goal_milestone_updates (goal_id, created_at desc);
create index goal_milestone_updates_milestone_idx
  on public.goal_milestone_updates (milestone_id, created_at desc);

create table public.goal_attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  goal_update_id uuid references public.goal_updates (id) on delete cascade,
  milestone_update_id uuid references public.goal_milestone_updates (id) on delete cascade,
  storage_bucket text not null default 'task-attachments',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null,
  checksum_sha256 text,
  virus_scan_state text not null default 'not_scanned',
  uploaded_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),

  constraint goal_attachments_origin_exactly_one check (
    (goal_update_id is not null)::integer + (milestone_update_id is not null)::integer = 1
  ),
  constraint goal_attachments_file_name_not_blank check (length(btrim(file_name)) > 0),
  constraint goal_attachments_byte_size_positive check (byte_size > 0),
  constraint goal_attachments_storage_path_unique unique (storage_bucket, storage_path),
  constraint goal_attachments_scan_state_known
    check (virus_scan_state in ('not_scanned', 'pending', 'clean', 'infected'))
);
create index goal_attachments_goal_idx on public.goal_attachments (goal_id, created_at desc);
create index goal_attachments_goal_update_idx on public.goal_attachments (goal_update_id)
  where goal_update_id is not null;
create index goal_attachments_milestone_update_idx
  on public.goal_attachments (milestone_update_id) where milestone_update_id is not null;

create table public.goal_attachment_views (
  id uuid primary key default extensions.gen_random_uuid(),
  attachment_id uuid not null references public.goal_attachments (id) on delete cascade,
  viewer_id uuid not null references public.user_profiles (id),
  viewed_at timestamptz not null default now()
);
create index goal_attachment_views_attachment_idx
  on public.goal_attachment_views (attachment_id, viewed_at desc);
create index goal_attachment_views_viewer_idx
  on public.goal_attachment_views (viewer_id, viewed_at desc);

create table public.goal_work_links (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  milestone_id uuid references public.goal_milestones (id),
  task_id uuid not null references public.tasks (id) on delete cascade,
  linked_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  constraint goal_work_links_unique unique (goal_id, task_id, milestone_id)
);
-- PostgreSQL's ordinary UNIQUE semantics treat NULL values as distinct. Keep
-- the useful three-column constraint for milestone links and explicitly make
-- an unscoped task link unique within its Goal as well.
create unique index goal_work_links_unscoped_unique_idx
  on public.goal_work_links (goal_id, task_id) where milestone_id is null;
create index goal_work_links_goal_idx on public.goal_work_links (goal_id, created_at desc);
create index goal_work_links_task_idx on public.goal_work_links (task_id);

create table public.goal_support_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  goal_update_id uuid not null unique references public.goal_updates (id) on delete cascade,
  requested_by uuid not null references public.user_profiles (id),
  manager_id uuid references public.user_profiles (id),
  details text not null,
  status text not null default 'open',
  acknowledged_by uuid references public.user_profiles (id),
  acknowledged_at timestamptz,
  resolved_by uuid references public.user_profiles (id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),

  constraint goal_support_requests_details_not_blank check (length(btrim(details)) > 0),
  constraint goal_support_requests_status_known
    check (status in ('open', 'acknowledged', 'resolved')),
  constraint goal_support_requests_ack_consistent check (
    (status = 'open' and acknowledged_by is null and acknowledged_at is null)
    or (status in ('acknowledged', 'resolved') and acknowledged_by is not null and acknowledged_at is not null)
  ),
  constraint goal_support_requests_resolution_consistent check (
    (status = 'resolved' and resolved_by is not null and resolved_at is not null
      and length(btrim(coalesce(resolution_note, ''))) > 0)
    or (status <> 'resolved' and resolved_by is null and resolved_at is null and resolution_note is null)
  )
);
create index goal_support_requests_goal_idx
  on public.goal_support_requests (goal_id, status, created_at desc);
create index goal_support_requests_manager_idx
  on public.goal_support_requests (manager_id, status, created_at desc)
  where status <> 'resolved';

-- Generic immutable records gain a Goal subject without invalidating any
-- historical task/user event or notification.
alter table public.audit_events
  add column goal_id uuid references public.goals (id) on delete cascade;
create index audit_events_goal_idx on public.audit_events (goal_id, occurred_at desc)
  where goal_id is not null;

alter table public.notifications
  add column goal_id uuid references public.goals (id) on delete cascade;
create index notifications_goal_idx on public.notifications (goal_id, created_at desc)
  where goal_id is not null;

-- Keep append-only protection complete after adding `goal_id`. Without this
-- replacement the old trigger would not compare the new column.
create or replace function focus.allow_only_identity_severance()
returns trigger
language plpgsql
as $$
begin
  if new.id                   is not distinct from old.id
     and new.event_type       is not distinct from old.event_type
     and new.occurred_at      is not distinct from old.occurred_at
     and new.task_id          is not distinct from old.task_id
     and new.goal_id          is not distinct from old.goal_id
     and new.previous_status  is not distinct from old.previous_status
     and new.new_status       is not distinct from old.new_status
     and new.bucket           is not distinct from old.bucket
     and new.count_before     is not distinct from old.count_before
     and new.count_after      is not distinct from old.count_after
     and new.target_at_event  is not distinct from old.target_at_event
     and new.over_target      is not distinct from old.over_target
     and new.reason_code      is not distinct from old.reason_code
     and new.reason_note      is not distinct from old.reason_note
     and new.reversal_of_event_id is not distinct from old.reversal_of_event_id
     and new.task_version     is not distinct from old.task_version
     and new.detail           is not distinct from old.detail
     and (new.actor_id is not distinct from old.actor_id or new.actor_id is null)
     and (new.subject_user_id is not distinct from old.subject_user_id
          or new.subject_user_id is null)
  then
    return new;
  end if;

  raise exception
    'audit_events is append-only. Record a reversal event instead of modifying history.'
    using errcode = 'insufficient_privilege';
end;
$$;
