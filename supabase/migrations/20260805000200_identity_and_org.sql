-- ============================================================================
-- TAMCO Focus — organisation, identity, and account lifecycle
--
-- Implements MASTER_PRODUCT_SPEC.md section 31B.1 / 31B.2 and
-- PRODUCTION_LOGIC.md section 13.
--
-- Referential integrity is the enforcement mechanism for controlled deletion:
-- every table that retains history points at `user_profiles` with the default
-- NO ACTION behaviour, so Postgres itself refuses to delete an account that
-- still owns work, evidence, decisions, or audit events. Application code adds
-- a clear message; it is not the thing that makes deletion safe.
-- ============================================================================

-- Shared trigger: keeps `updated_at` honest without trusting the client.
create or replace function focus.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------

create table public.departments (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint departments_code_format check (code ~ '^[A-Z0-9_-]{2,32}$'),
  constraint departments_name_not_blank check (length(btrim(name)) > 0),
  constraint departments_code_unique unique (code)
);

create trigger departments_touch_updated_at
  before update on public.departments
  for each row execute function focus.touch_updated_at();

-- ---------------------------------------------------------------------------
-- User profiles
--
-- `id` mirrors `auth.users.id`. The profile is the application identity; the
-- auth row is the credential. Both are created inside one administrator
-- transaction (PRODUCTION_LOGIC.md 13.2) — a profile without an auth identity,
-- or the reverse, is not an acceptable end state.
-- ---------------------------------------------------------------------------

create table public.user_profiles (
  id uuid primary key references auth.users (id) on delete restrict,

  employee_id text not null,
  email extensions.citext not null,
  full_name text not null,

  department_id uuid references public.departments (id),
  role public.app_role not null default 'team_member',
  reporting_manager_id uuid references public.user_profiles (id),

  status public.account_status not null default 'active',

  -- section 31B.1 — weekly summary preferences live on the identity record.
  personal_summary_mode public.personal_summary_mode not null default 'standard',
  team_summary_mode public.team_summary_mode not null default 'off',

  -- section 22.2 — personal workspace preferences.
  default_landing_page text not null default 'today',
  theme_preference text not null default 'system',
  text_size text not null default 'default',
  reduced_motion boolean not null default false,
  first_day_of_week smallint not null default 1,
  quiet_hours_start smallint,
  quiet_hours_end smallint,
  timezone text not null default 'Asia/Kuala_Lumpur',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,

  constraint user_profiles_employee_id_format
    check (employee_id ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  constraint user_profiles_email_format
    check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint user_profiles_full_name_not_blank
    check (length(btrim(full_name)) > 0),
  constraint user_profiles_not_own_manager
    check (reporting_manager_id is null or reporting_manager_id <> id),
  constraint user_profiles_landing_page_known
    check (default_landing_page in ('today', 'work', 'plan', 'team', 'more')),
  constraint user_profiles_theme_known
    check (theme_preference in ('system', 'light', 'dark')),
  constraint user_profiles_text_size_known
    check (text_size in ('default', 'large', 'larger')),
  constraint user_profiles_first_day_range
    check (first_day_of_week between 0 and 6),
  constraint user_profiles_quiet_hours_range
    check (
      (quiet_hours_start is null or quiet_hours_start between 0 and 23)
      and (quiet_hours_end is null or quiet_hours_end between 0 and 23)
    ),
  -- A deactivated account must record when access was revoked; an active
  -- account must not carry a stale deactivation timestamp.
  constraint user_profiles_deactivated_at_consistent
    check (
      (status = 'deactivated' and deactivated_at is not null)
      or (status = 'active' and deactivated_at is null)
    ),
  -- section 31B.4 — only a manager or administrator may hold team summaries.
  constraint user_profiles_team_summary_requires_authority
    check (team_summary_mode = 'off' or role in ('manager', 'administrator'))
);

-- section 31B.1 — uniqueness is enforced by the database, not only validated
-- in the form. `citext` makes the email comparison case-insensitive.
create unique index user_profiles_employee_id_key
  on public.user_profiles (upper(employee_id));
create unique index user_profiles_email_key
  on public.user_profiles (email);

create index user_profiles_reporting_manager_idx
  on public.user_profiles (reporting_manager_id)
  where reporting_manager_id is not null;
create index user_profiles_department_idx on public.user_profiles (department_id);
create index user_profiles_status_idx on public.user_profiles (status);

create trigger user_profiles_touch_updated_at
  before update on public.user_profiles
  for each row execute function focus.touch_updated_at();

-- Guard against a reporting cycle (A reports to B reports to A). A cycle would
-- make manager-scope visibility recursion non-terminating.
create or replace function focus.assert_no_reporting_cycle()
returns trigger
language plpgsql
as $$
declare
  cursor_id uuid := new.reporting_manager_id;
  hops integer := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Reporting line would create a cycle for user %', new.id
        using errcode = 'check_violation';
    end if;

    hops := hops + 1;
    if hops > 64 then
      raise exception 'Reporting line exceeds the supported depth of 64'
        using errcode = 'check_violation';
    end if;

    select reporting_manager_id into cursor_id
      from public.user_profiles
     where id = cursor_id;
  end loop;

  return new;
end;
$$;

create trigger user_profiles_no_reporting_cycle
  before insert or update of reporting_manager_id on public.user_profiles
  for each row when (new.reporting_manager_id is not null)
  execute function focus.assert_no_reporting_cycle();
