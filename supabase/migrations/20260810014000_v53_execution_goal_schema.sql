-- TAMCO Focus v53 — additive schema for one Task engine and employee-level Goal cadence.

-- Generic source link for future specialist modules. Native Focus work keeps
-- all three values null; the external module remains owner of the source row.
alter table public.tasks
  add column source_module text,
  add column source_entity_type text,
  add column source_entity_id uuid;

alter table public.tasks
  add constraint tasks_source_link_all_or_none check (
    (source_module is null and source_entity_type is null and source_entity_id is null)
    or (
      length(btrim(coalesce(source_module, ''))) > 0
      and length(btrim(coalesce(source_entity_type, ''))) > 0
      and source_entity_id is not null
    )
  );

create index tasks_source_link_idx
  on public.tasks (source_module, source_entity_type, source_entity_id)
  where source_entity_id is not null;

comment on column public.tasks.source_module is
  'Optional owning module for an external business object. Null for native TAMCO Focus work.';

-- A terminal parent makes requests and queue topics historical, not deleted or
-- falsely resolved. These markers preserve that distinction.
alter table public.barriers
  alter column task_id drop not null,
  add column goal_id uuid references public.goals (id) on delete cascade,
  add column source_active boolean not null default true,
  add column source_inactive_at timestamptz;

alter table public.barriers
  add constraint barriers_one_source check (
    (task_id is not null)::integer + (goal_id is not null)::integer = 1
  ),
  add constraint barriers_source_activity_consistent check (
    (source_active and source_inactive_at is null)
    or (not source_active and source_inactive_at is not null)
  );

create index barriers_goal_idx on public.barriers (goal_id, status, raised_at desc)
  where goal_id is not null;

alter table public.meeting_queue_items
  add column source_active boolean not null default true,
  add column source_inactive_at timestamptz;

alter table public.meeting_queue_items
  add constraint meeting_queue_source_activity_consistent check (
    (source_active and source_inactive_at is null)
    or (not source_active and source_inactive_at is not null)
  );

-- A proposal is a real optimistic-concurrency object. Existing approved and
-- rejected rows remain valid; new Major Project decisions use the lean states.
alter table public.work_proposals
  add column version integer not null default 1,
  add column last_submitted_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now();

alter table public.work_proposals
  drop constraint work_proposals_decision_consistent,
  add constraint work_proposals_decision_consistent check (
    (status = 'pending' and decided_at is null and decided_by is null)
    or (status <> 'pending' and decided_at is not null and decided_by is not null)
  ),
  add constraint work_proposals_version_positive check (version > 0);

create trigger work_proposals_touch_updated_at
  before update on public.work_proposals
  for each row execute function focus.touch_updated_at();

-- A performance period owns each employee's formal Goal plan. The plan can be
-- built gradually; finalisation is a separate, exactly-100-percent decision.
create table public.performance_periods (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  starts_on date not null,
  ends_on date not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint performance_periods_name_not_blank check (length(btrim(name)) > 0),
  constraint performance_periods_dates_ordered check (starts_on <= ends_on),
  constraint performance_periods_status_known check (status in ('open', 'closed')),
  constraint performance_periods_name_unique unique (name)
);

create trigger performance_periods_touch_updated_at
  before update on public.performance_periods
  for each row execute function focus.touch_updated_at();

create table public.employee_goal_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  employee_id uuid not null references public.user_profiles (id),
  performance_period_id uuid not null references public.performance_periods (id),
  status public.goal_plan_status not null default 'draft',
  finalized_by uuid references public.user_profiles (id),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,

  constraint employee_goal_plans_unique unique (employee_id, performance_period_id),
  constraint employee_goal_plans_finalized_consistent check (
    (status = 'draft' and finalized_by is null and finalized_at is null)
    or (status = 'finalized' and finalized_by is not null and finalized_at is not null)
    or (
      status = 'reallocation_required'
      and ((finalized_by is null and finalized_at is null)
        or (finalized_by is not null and finalized_at is not null))
    )
  ),
  constraint employee_goal_plans_version_positive check (version > 0)
);

create trigger employee_goal_plans_touch_updated_at
  before update on public.employee_goal_plans
  for each row execute function focus.touch_updated_at();

alter table public.goals
  add column performance_period_id uuid references public.performance_periods (id),
  add column governance_mode_at_activation public.goal_governance_mode,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.user_profiles (id),
  add column cancellation_reason text,
  add column final_result_summary text;

alter table public.goals
  add constraint goals_cancellation_consistent check (
    (
      status = 'cancelled'
      and cancelled_at is not null
      and cancelled_by is not null
      and length(btrim(coalesce(cancellation_reason, ''))) > 0
    )
    or (
      status <> 'cancelled'
      and cancelled_at is null
      and cancelled_by is null
      and cancellation_reason is null
    )
  );

alter table public.goal_success_measures
  add column actual_result text,
  add column actual_recorded_by uuid references public.user_profiles (id),
  add column actual_recorded_at timestamptz;

alter table public.goal_success_measures
  add constraint goal_success_measures_actual_consistent check (
    (actual_result is null and actual_recorded_by is null and actual_recorded_at is null)
    or (
      length(btrim(coalesce(actual_result, ''))) > 0
      and actual_recorded_by is not null
      and actual_recorded_at is not null
    )
  );

-- One header says whether the employee's month or quarter is actually done;
-- items retain the exact per-Goal snapshots that made up that session.
create table public.goal_checkin_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  employee_id uuid not null references public.user_profiles (id),
  performance_period_id uuid not null references public.performance_periods (id),
  session_kind public.goal_session_kind not null,
  status public.goal_session_status not null default 'draft',
  period_year smallint not null,
  period_month smallint,
  period_quarter smallint,
  submitted_by uuid references public.user_profiles (id),
  submitted_at timestamptz,
  reviewed_by uuid references public.user_profiles (id),
  reviewed_at timestamptz,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,

  constraint goal_checkin_sessions_period_shape check (
    (session_kind = 'monthly' and period_month between 1 and 12 and period_quarter is null)
    or (session_kind = 'quarterly' and period_month is null and period_quarter between 1 and 4)
  ),
  constraint goal_checkin_sessions_year_range check (period_year between 2000 and 2200),
  constraint goal_checkin_sessions_submission_consistent check (
    (status = 'draft' and submitted_by is null and submitted_at is null)
    or (status in ('submitted', 'completed') and submitted_by is not null and submitted_at is not null)
  ),
  constraint goal_checkin_sessions_review_consistent check (
    (status <> 'completed' and reviewed_by is null and reviewed_at is null)
    or (status = 'completed' and reviewed_by is not null and reviewed_at is not null)
  ),
  constraint goal_checkin_sessions_version_positive check (version > 0)
);

create unique index goal_checkin_sessions_month_unique
  on public.goal_checkin_sessions (employee_id, performance_period_id, period_year, period_month)
  where session_kind = 'monthly';
create unique index goal_checkin_sessions_quarter_unique
  on public.goal_checkin_sessions (employee_id, performance_period_id, period_year, period_quarter)
  where session_kind = 'quarterly';
create index goal_checkin_sessions_employee_idx
  on public.goal_checkin_sessions (employee_id, session_kind, period_year desc, created_at desc);

create trigger goal_checkin_sessions_touch_updated_at
  before update on public.goal_checkin_sessions
  for each row execute function focus.touch_updated_at();

create table public.goal_checkin_session_items (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references public.goal_checkin_sessions (id) on delete cascade,
  goal_id uuid not null references public.goals (id) on delete cascade,
  goal_version_id uuid not null references public.goal_versions (id),
  health text not null,
  update_text text,
  attention_text text,
  support_requested boolean not null default false,
  support_details text,
  legacy_check_in_id uuid references public.goal_check_ins (id) on delete set null,
  source_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint goal_checkin_session_items_unique unique (session_id, goal_id),
  constraint goal_checkin_session_items_health_known check (
    health in ('on_track', 'at_risk', 'off_track', 'no_material_change')
  ),
  constraint goal_checkin_session_items_support_explained check (
    not support_requested or length(btrim(coalesce(support_details, ''))) > 0
  )
);

create index goal_checkin_session_items_goal_idx
  on public.goal_checkin_session_items (goal_id, created_at desc);

alter table public.goal_check_ins
  add column session_id uuid references public.goal_checkin_sessions (id) on delete set null;

-- Create/backfill a period for every existing Goal target year, plus the
-- current year for a clean new database with no Goal fixtures.
insert into public.performance_periods (name, starts_on, ends_on)
select distinct
  extract(year from target_date)::integer || ' Performance Period',
  make_date(extract(year from target_date)::integer, 1, 1),
  make_date(extract(year from target_date)::integer, 12, 31)
from public.goals
on conflict (name) do nothing;

insert into public.performance_periods (name, starts_on, ends_on)
values (
  extract(year from current_date)::integer || ' Performance Period',
  make_date(extract(year from current_date)::integer, 1, 1),
  make_date(extract(year from current_date)::integer, 12, 31)
)
on conflict (name) do nothing;

update public.goals goal
set performance_period_id = period.id
from public.performance_periods period
where goal.performance_period_id is null
  and goal.target_date between period.starts_on and period.ends_on;

alter table public.goals alter column performance_period_id set not null;

insert into public.employee_goal_plans (employee_id, performance_period_id)
select distinct owner_id, performance_period_id from public.goals
on conflict (employee_id, performance_period_id) do nothing;

alter table public.performance_periods enable row level security;
alter table public.employee_goal_plans enable row level security;
alter table public.goal_checkin_sessions enable row level security;
alter table public.goal_checkin_session_items enable row level security;
