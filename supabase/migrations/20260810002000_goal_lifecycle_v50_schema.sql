-- TAMCO Focus v50 - additive Goal lifecycle records.

create table public.goal_success_measures (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_version_id uuid not null references public.goal_versions (id) on delete cascade,
  source_measure_id uuid references public.goal_success_measures (id),
  position smallint not null,
  label text not null,
  measure_type public.goal_measure_type not null,
  target_numeric numeric(14, 2),
  current_numeric numeric(14, 2),
  unit text,
  period text,
  target_text text,
  current_state public.goal_measure_state,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint goal_success_measures_position_positive check (position > 0),
  constraint goal_success_measures_label_not_blank check (length(btrim(label)) > 0),
  constraint goal_success_measures_unit_not_blank check (
    unit is null or length(btrim(unit)) > 0
  ),
  constraint goal_success_measures_period_not_blank check (
    period is null or length(btrim(period)) > 0
  ),
  constraint goal_success_measures_shape check (
    (
      measure_type in ('number', 'percentage')
      and target_numeric is not null
      and target_numeric > 0
      and target_text is null
      and current_state is null
    )
    or (
      measure_type = 'qualitative'
      and target_numeric is null
      and current_numeric is null
      and length(btrim(coalesce(target_text, ''))) > 0
      and current_state is not null
    )
  ),
  constraint goal_success_measures_percentage_range check (
    measure_type <> 'percentage'
    or (
      target_numeric <= 100
      and (current_numeric is null or current_numeric between 0 and 100)
    )
  ),
  constraint goal_success_measures_unique_position unique (goal_version_id, position)
);

create index goal_success_measures_version_idx
  on public.goal_success_measures (goal_version_id, position);
create index goal_success_measures_source_idx
  on public.goal_success_measures (source_measure_id)
  where source_measure_id is not null;
create trigger goal_success_measures_touch_updated_at
  before update on public.goal_success_measures
  for each row execute function focus.touch_updated_at();

create table public.goal_check_ins (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  goal_version_id uuid not null references public.goal_versions (id),
  checkin_type public.goal_checkin_type not null,
  status public.goal_checkin_status not null default 'draft',
  period_start date not null,
  period_end date not null,
  period_year smallint not null,
  period_month smallint,
  period_quarter smallint,

  progress_status public.goal_health,
  no_material_change boolean not null default false,
  employee_summary text,
  manager_discussion text,
  agreed_actions text,
  support_requested boolean not null default false,
  support_details text,
  goal_update_id uuid references public.goal_updates (id),

  result_statement text,
  source_snapshot jsonb not null default '{}'::jsonb,
  submitted_by uuid references public.user_profiles (id),
  submitted_at timestamptz,
  manager_completed_by uuid references public.user_profiles (id),
  manager_completed_at timestamptz,
  finalized_by uuid references public.user_profiles (id),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,

  constraint goal_check_ins_period_order check (period_start <= period_end),
  constraint goal_check_ins_year_range check (period_year between 2000 and 2200),
  constraint goal_check_ins_period_shape check (
    (checkin_type = 'monthly' and period_month between 1 and 12 and period_quarter is null)
    or (checkin_type = 'quarterly' and period_month is null and period_quarter between 1 and 4)
    or (checkin_type = 'year_end' and period_month is null and period_quarter is null)
  ),
  constraint goal_check_ins_health_known check (
    progress_status is null
    or progress_status in ('on_track', 'at_risk', 'off_track')
  ),
  constraint goal_check_ins_support_detail check (
    support_requested = false
    or length(btrim(coalesce(support_details, ''))) > 0
  ),
  constraint goal_check_ins_submission_consistent check (
    (submitted_at is null and submitted_by is null)
    or (submitted_at is not null and submitted_by is not null)
  ),
  constraint goal_check_ins_manager_consistent check (
    (manager_completed_at is null and manager_completed_by is null)
    or (manager_completed_at is not null and manager_completed_by is not null)
  ),
  constraint goal_check_ins_final_consistent check (
    (finalized_at is null and finalized_by is null)
    or (finalized_at is not null and finalized_by is not null)
  ),
  constraint goal_check_ins_version_positive check (version > 0)
);

create unique index goal_check_ins_monthly_period_idx
  on public.goal_check_ins (goal_id, period_year, period_month)
  where checkin_type = 'monthly';
create unique index goal_check_ins_quarterly_period_idx
  on public.goal_check_ins (goal_id, period_year, period_quarter)
  where checkin_type = 'quarterly';
create unique index goal_check_ins_year_end_period_idx
  on public.goal_check_ins (goal_id, period_year)
  where checkin_type = 'year_end';
create index goal_check_ins_goal_history_idx
  on public.goal_check_ins (goal_id, period_end desc, created_at desc);
create index goal_check_ins_manager_action_idx
  on public.goal_check_ins (goal_id, status, period_end)
  where checkin_type = 'quarterly' and status = 'submitted';
create trigger goal_check_ins_touch_updated_at
  before update on public.goal_check_ins
  for each row execute function focus.touch_updated_at();

create table public.goal_success_measure_updates (
  id uuid primary key default extensions.gen_random_uuid(),
  goal_id uuid not null references public.goals (id) on delete cascade,
  measure_id uuid not null references public.goal_success_measures (id),
  check_in_id uuid references public.goal_check_ins (id) on delete cascade,
  author_id uuid not null references public.user_profiles (id),
  previous_numeric numeric(14, 2),
  new_numeric numeric(14, 2),
  previous_state public.goal_measure_state,
  new_state public.goal_measure_state,
  note text,
  created_at timestamptz not null default now(),

  constraint goal_success_measure_updates_value_changed check (
    previous_numeric is distinct from new_numeric
    or previous_state is distinct from new_state
  ),
  constraint goal_success_measure_updates_value_shape check (
    (previous_state is null and new_state is null)
    or (previous_numeric is null and new_numeric is null)
  )
);

create index goal_success_measure_updates_goal_idx
  on public.goal_success_measure_updates (goal_id, created_at desc);
create index goal_success_measure_updates_measure_idx
  on public.goal_success_measure_updates (measure_id, created_at desc);
create index goal_success_measure_updates_checkin_idx
  on public.goal_success_measure_updates (check_in_id)
  where check_in_id is not null;

create or replace function focus.goal_month_end(p_date date)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select (date_trunc('month', p_date::timestamp) + interval '1 month - 1 day')::date;
$$;

create or replace function focus.goal_quarter_end(p_date date)
returns date
language sql
immutable
set search_path = public, pg_temp
as $$
  select (date_trunc('quarter', p_date::timestamp) + interval '3 months - 1 day')::date;
$$;

create or replace function focus.goal_measure_progress(
  p_measure_type public.goal_measure_type,
  p_target_numeric numeric,
  p_current_numeric numeric,
  p_current_state public.goal_measure_state
)
returns smallint
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_measure_type = 'percentage' then
      round(least(100, greatest(0, coalesce(p_current_numeric, 0))))::smallint
    when p_measure_type = 'number' then
      round(
        least(100, greatest(0, coalesce(p_current_numeric, 0) / nullif(p_target_numeric, 0) * 100))
      )::smallint
    when p_current_state = 'exceeded' then 100::smallint
    when p_current_state = 'achieved' then 100::smallint
    when p_current_state = 'progressing' then 50::smallint
    else 0::smallint
  end;
$$;

create or replace function focus.goal_version_measure_progress(p_goal_version_id uuid)
returns smallint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    round(avg(focus.goal_measure_progress(
      m.measure_type,
      m.target_numeric,
      m.current_numeric,
      m.current_state
    ))),
    0
  )::smallint
  from public.goal_success_measures m
  where m.goal_version_id = p_goal_version_id;
$$;

-- Every existing Goal version receives one qualitative measure so the new
-- lifecycle can operate without rewriting or losing its approved wording.
insert into public.goal_success_measures (
  goal_version_id,
  position,
  label,
  measure_type,
  target_text,
  current_state
)
select
  v.id,
  1,
  v.success_measure,
  'qualitative',
  v.success_measure,
  'not_started'
from public.goal_versions v
where not exists (
  select 1
  from public.goal_success_measures m
  where m.goal_version_id = v.id
);

comment on table public.goal_success_measures is
  'Version-owned structured outcomes. Measures are results, never task or milestone substitutes.';
comment on table public.goal_check_ins is
  'One period-keyed Goal lifecycle record for monthly, quarterly, and year-end conversations.';
