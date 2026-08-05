-- ============================================================================
-- TAMCO Focus — visibility rules, focus targets, and governed settings
--
-- Implements MASTER_PRODUCT_SPEC.md sections 7.1, 22.3, 22.4, 22.5 and
-- PRODUCTION_LOGIC.md section 2.1.
--
-- The approved security model (section 22.5) is:
--   default deny -> own work always visible -> inherited direct reports where
--   configured -> explicit additional visibility granted by an administrator.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Visibility policy — one row per viewer, administrator controlled.
--
-- Absence of a row means `specific_only` with no grants, i.e. the viewer sees
-- only their own work. Default deny is therefore the behaviour when an
-- administrator has configured nothing at all.
-- ---------------------------------------------------------------------------

create table public.visibility_policies (
  viewer_id uuid primary key references public.user_profiles (id),
  mode public.visibility_mode not null default 'specific_only',
  updated_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger visibility_policies_touch_updated_at
  before update on public.visibility_policies
  for each row execute function focus.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Explicit additional visibility grants.
--
-- The approved worked example (section 22.5 / Appendix A9): Amer may view Izzah
-- and Ajmal because they are his interns. A grant conveys VIEW only — never
-- edit, activation, reassignment, or completion acceptance (section 3.4).
-- ---------------------------------------------------------------------------

create table public.visibility_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  viewer_id uuid not null references public.user_profiles (id),
  subject_id uuid not null references public.user_profiles (id),
  granted_by uuid not null references public.user_profiles (id),
  reason text,
  created_at timestamptz not null default now(),

  constraint visibility_grants_not_self check (viewer_id <> subject_id),
  constraint visibility_grants_unique unique (viewer_id, subject_id)
);

create index visibility_grants_viewer_idx on public.visibility_grants (viewer_id);
create index visibility_grants_subject_idx on public.visibility_grants (subject_id);

-- ---------------------------------------------------------------------------
-- Focus targets (MASTER_PRODUCT_SPEC.md section 7.1).
--
-- Defaults are Major Project 1, Operational Actions 5, Self-Development 1, and
-- they are RECOMMENDATIONS. Nothing in this schema — and nothing in the
-- activation procedure — blocks activation for exceeding a target.
--
-- Resolution order is user -> department -> system, taking the most recent row
-- whose `effective_from` has passed.
-- ---------------------------------------------------------------------------

create table public.focus_targets (
  id uuid primary key default extensions.gen_random_uuid(),
  scope_type public.focus_target_scope not null,
  scope_id uuid,
  bucket public.focus_bucket not null,
  recommended_target smallint not null,
  effective_from timestamptz not null default now(),
  changed_by uuid references public.user_profiles (id),
  change_reason text,
  created_at timestamptz not null default now(),

  constraint focus_targets_target_range
    check (recommended_target between 0 and 99),
  -- A system-scoped target has no scope_id; department and user scopes must
  -- name the thing they apply to.
  constraint focus_targets_scope_id_consistent
    check (
      (scope_type = 'system' and scope_id is null)
      or (scope_type <> 'system' and scope_id is not null)
    )
);

create unique index focus_targets_system_unique
  on public.focus_targets (bucket, effective_from)
  where scope_type = 'system';
create unique index focus_targets_scoped_unique
  on public.focus_targets (scope_type, scope_id, bucket, effective_from)
  where scope_type <> 'system';
create index focus_targets_lookup_idx
  on public.focus_targets (scope_type, scope_id, bucket, effective_from desc);

-- Approved organisation defaults.
insert into public.focus_targets (scope_type, scope_id, bucket, recommended_target, change_reason)
values
  ('system', null, 'major', 1, 'Approved default (MASTER_PRODUCT_SPEC.md section 7.1)'),
  ('system', null, 'operational', 5, 'Approved default (MASTER_PRODUCT_SPEC.md section 7.1)'),
  ('system', null, 'self_development', 1, 'Approved default (MASTER_PRODUCT_SPEC.md section 7.1)');

-- ---------------------------------------------------------------------------
-- Organisation settings.
--
-- A narrow key/value table holding only decisions the product actually exposes
-- (section 22.1: settings must contain meaningful operational decisions only).
-- Values are typed on read by the domain layer against a Zod schema, and every
-- write produces a `settings_changed` audit event.
-- ---------------------------------------------------------------------------

create table public.org_settings (
  key text primary key,
  value jsonb not null,
  description text not null,
  -- Whether a manager may change this, or only an administrator.
  manager_editable boolean not null default false,
  updated_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),

  constraint org_settings_key_format check (key ~ '^[a-z][a-z0-9_.]{2,63}$')
);

create trigger org_settings_touch_updated_at
  before update on public.org_settings
  for each row execute function focus.touch_updated_at();

insert into public.org_settings (key, value, description, manager_editable) values
  ('focus.self_selection_allowed', 'true'::jsonb,
   'Team members may activate their own Available Work.', true),
  ('focus.reason_required_when_replacing', 'true'::jsonb,
   'Ask for a reason when activation would exceed the focus target.', true),
  ('focus.urgency_requires_review_by', 'true'::jsonb,
   'High and Critical urgency require a review-by date.', true),
  ('focus.stale_update_threshold_days', '7'::jsonb,
   'Active work with no meaningful update for this many days is flagged stale.', true),

  -- section 20.6 — the default outcome of Request Changes must be explicit in
  -- Settings and must not be invented by the implementation. `return_to_available`
  -- is the configured local default and is fully reversible here.
  ('review.request_changes_outcome', '"return_to_available"'::jsonb,
   'Where a task goes when a reviewer requests changes: reopen_active or return_to_available.', false),
  ('review.required_for_work_classes',
   '["major_project","operational_action","self_development"]'::jsonb,
   'Work classes whose completion requires an independent review decision.', false),
  ('review.required_when_mandatory', 'true'::jsonb,
   'Safety, legal, incident, and audit actions always require review.', false),
  ('review.target_days', '3'::jsonb,
   'Completion review is overdue after this many days.', false),
  ('review.dual_verification_work_classes', '[]'::jsonb,
   'Work classes requiring a second independent verifier.', false),

  ('routine.template_authors', '["manager","administrator"]'::jsonb,
   'Roles permitted to create and maintain routine templates.', false),
  ('routine.occurrence_lead_days', '14'::jsonb,
   'How far ahead routine occurrences are generated and shown.', true),
  ('routine.ordinary_auto_archive', 'true'::jsonb,
   'Ordinary routine occurrences archive without review when no exception exists.', true),

  ('alerts.barrier_escalation_hours', '24'::jsonb,
   'An unanswered barrier escalates after this many hours.', true),
  ('alerts.over_target_review_days', '7'::jsonb,
   'An unresolved over-target condition is raised for discussion after this long.', true),

  ('day.upcoming_window_days', '7'::jsonb,
   'How far ahead the My Day "Coming Up" section looks.', true),
  ('day.today_list_max_items', '5'::jsonb,
   'Upper bound on the My Day Today list (section 9.6 asks for three to five).', true),

  ('attachments.max_bytes', '10485760'::jsonb,
   'Local attachment size ceiling. Final production limit is a Product Owner decision.', false),
  ('attachments.virus_scan_enabled', 'false'::jsonb,
   'No virus scanning is performed locally and no scan result is fabricated.', false),

  ('retention.completed_task_years', '7'::jsonb,
   'Local placeholder retention period. Final legal retention is administrator controlled and unresolved.', false);

-- ---------------------------------------------------------------------------
-- Per-user alert preferences (section 22.2 "My Alerts").
-- ---------------------------------------------------------------------------

create table public.user_alert_preferences (
  user_id uuid primary key references public.user_profiles (id),
  barrier_involving_me boolean not null default true,
  assignment_changes boolean not null default true,
  collaboration_handoff boolean not null default true,
  due_today_and_deadlines boolean not null default true,
  routine_upcoming boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger user_alert_preferences_touch_updated_at
  before update on public.user_alert_preferences
  for each row execute function focus.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Temporary delegation (section 22.4).
-- ---------------------------------------------------------------------------

create table public.delegations (
  id uuid primary key default extensions.gen_random_uuid(),
  delegator_id uuid not null references public.user_profiles (id),
  delegate_id uuid not null references public.user_profiles (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  created_by uuid not null references public.user_profiles (id),
  created_at timestamptz not null default now(),

  constraint delegations_not_self check (delegator_id <> delegate_id),
  constraint delegations_window_ordered check (ends_at > starts_at),
  constraint delegations_reason_not_blank check (length(btrim(reason)) > 0)
);

create index delegations_active_idx
  on public.delegations (delegate_id, starts_at, ends_at);
