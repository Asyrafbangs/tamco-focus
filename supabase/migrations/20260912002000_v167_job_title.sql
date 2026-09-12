-- ---------------------------------------------------------------------------
-- v167 — A person has a job title
--
-- The identity record held what somebody may do (`role`) and where they sit
-- (`department_id`, `reporting_manager_id`), but not what they are called: EHS
-- Manager, Senior Executive, EHS Executive. An organisation chart without it
-- shows a list of names, and the application role — three values, chosen for
-- permissions — was standing in for a job title it was never meant to express.
--
-- The title is descriptive and nothing reads it for authority. Permission stays
-- `role`, sight stays the visibility model, and management powers still follow
-- the reporting line.
--
-- Both identity procedures are dropped and recreated rather than replaced: a
-- new parameter makes a second overload, and PostgREST would then have two
-- candidates for the same call.
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column job_title text;

alter table public.user_profiles
  add constraint user_profiles_job_title_not_blank
    check (job_title is null or length(btrim(job_title)) > 0);

comment on column public.user_profiles.job_title is
  'What the person is called at work. Descriptive only: authority is `role`, '
  'sight is the visibility model, management follows the reporting line.';

-- ---------------------------------------------------------------------------
-- Provisioning
-- ---------------------------------------------------------------------------

drop function if exists public.provision_user_profile(
  uuid, text, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode, uuid);

create or replace function public.provision_user_profile(
  p_user_id uuid,
  p_employee_id text,
  p_email text,
  p_full_name text,
  p_department_id uuid,
  p_role public.app_role,
  p_reporting_manager_id uuid default null,
  p_personal_summary_mode public.personal_summary_mode default 'standard',
  p_team_summary_mode public.team_summary_mode default 'off',
  p_actor_id uuid default null,
  p_job_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := coalesce(auth.uid(), p_actor_id);
  normalised_employee_id text;
  normalised_email text;
  normalised_job_title text;
  effective_team_mode public.team_summary_mode;
begin
  -- Callable by an administrator, or by the seed/worker path running as the
  -- service role (where auth.uid() is null and the actor is passed in).
  if auth.uid() is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can create users.');
  end if;

  -- Section 13.2, step 2 — normalise before validating uniqueness.
  normalised_employee_id := upper(btrim(p_employee_id));
  normalised_email := lower(btrim(p_email));
  -- Blank is absent, not a title: the constraint rejects an empty string and a
  -- form that offers the field always submits it.
  normalised_job_title := nullif(btrim(coalesce(p_job_title, '')), '');

  if length(normalised_employee_id) = 0 or length(normalised_email) = 0
     or length(btrim(p_full_name)) = 0 then
    return focus.error('validation_failed',
      'Full name, employee ID, and email address are all required.');
  end if;

  -- Uniqueness is checked here for a clear message and enforced by the unique
  -- indexes regardless, which is what makes a concurrent duplicate impossible.
  if exists (
    select 1 from public.user_profiles where upper(employee_id) = normalised_employee_id
  ) then
    return focus.error('employee_id_taken',
      format('Employee ID %s is already in use.', normalised_employee_id));
  end if;

  if exists (select 1 from public.user_profiles where email = normalised_email) then
    return focus.error('email_taken',
      format('Email address %s is already in use.', normalised_email));
  end if;

  -- Only a manager or administrator may hold a team summary preference.
  effective_team_mode := case
    when p_role in ('manager', 'administrator') then p_team_summary_mode
    else 'off'::public.team_summary_mode
  end;

  -- Lets the self-update guard trigger know this is a privileged provisioning
  -- write rather than a user editing their own profile.
  perform set_config('focus.privileged_write', 'on', true);

  insert into public.user_profiles (
    id, employee_id, email, full_name, department_id, role,
    reporting_manager_id, status, personal_summary_mode, team_summary_mode,
    job_title
  ) values (
    p_user_id, normalised_employee_id, normalised_email, btrim(p_full_name),
    p_department_id, p_role, p_reporting_manager_id, 'active',
    p_personal_summary_mode, effective_team_mode, normalised_job_title
  );

  -- Section 13.2, steps 5 and 6 — default preferences and visibility records.
  insert into public.user_alert_preferences (user_id) values (p_user_id);

  insert into public.visibility_policies (viewer_id, mode, updated_by)
  values (
    p_user_id,
    case when p_role in ('manager', 'administrator')
         then 'direct_reports_plus'::public.visibility_mode
         else 'specific_only'::public.visibility_mode end,
    coalesce(actor, p_user_id)
  );

  perform focus.write_audit(
    p_event_type := 'user_created',
    p_actor_id := actor,
    p_subject_user_id := p_user_id,
    p_detail := jsonb_build_object(
      'employee_id', normalised_employee_id,
      'email', normalised_email,
      'role', p_role,
      'job_title', normalised_job_title,
      'reporting_manager_id', p_reporting_manager_id)
  );

  insert into public.admin_security_log (
    event_type, actor_user_id, actor_employee_id, actor_email,
    subject_user_id, subject_employee_id, subject_email, summary, detail
  )
  select
    'user_created', actor,
    (select employee_id from public.user_profiles where id = actor),
    (select email::text from public.user_profiles where id = actor),
    p_user_id, normalised_employee_id, normalised_email,
    format('Created user %s (%s)', btrim(p_full_name), normalised_employee_id),
    jsonb_build_object('role', p_role, 'job_title', normalised_job_title);

  -- Section 13.2, step 8 — return a sanitised profile.
  return jsonb_build_object(
    'ok', true,
    'code', 'user_created',
    'user', jsonb_build_object(
      'id', p_user_id,
      'employee_id', normalised_employee_id,
      'email', normalised_email,
      'full_name', btrim(p_full_name),
      'job_title', normalised_job_title,
      'role', p_role,
      'status', 'active')
  );
exception
  when unique_violation then
    return focus.error('duplicate_identity',
      'That employee ID or email address is already in use.');
end;
$$;

-- ---------------------------------------------------------------------------
-- Maintenance
--
-- A null title means "leave it alone" and an empty one means "clear it", which
-- is what a form that always submits the field needs: the administrator who
-- empties the box means to empty it.
-- ---------------------------------------------------------------------------

drop function if exists public.update_user_profile(
  uuid, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode);

create or replace function public.update_user_profile(
  p_user_id uuid,
  p_full_name text default null,
  p_email text default null,
  p_department_id uuid default null,
  p_role public.app_role default null,
  p_reporting_manager_id uuid default null,
  p_personal_summary_mode public.personal_summary_mode default null,
  p_team_summary_mode public.team_summary_mode default null,
  p_job_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target record;
  next_role public.app_role;
  next_job_title text;
  changes jsonb := '{}'::jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can change user records.');
  end if;

  select * into target from public.user_profiles where id = p_user_id for update;
  if not found then return focus.error('not_found', 'That user does not exist.'); end if;

  next_role := coalesce(p_role, target.role);
  next_job_title := case
    when p_job_title is null then target.job_title
    when length(btrim(p_job_title)) = 0 then null
    else btrim(p_job_title)
  end;

  if p_email is not null and lower(btrim(p_email)) <> target.email::text then
    if exists (
      select 1 from public.user_profiles
       where email = lower(btrim(p_email)) and id <> p_user_id
    ) then
      return focus.error('email_taken', 'That email address is already in use.');
    end if;
    changes := changes || jsonb_build_object('email',
      jsonb_build_object('from', target.email::text, 'to', lower(btrim(p_email))));
  end if;

  if p_role is not null and p_role <> target.role then
    changes := changes || jsonb_build_object('role',
      jsonb_build_object('from', target.role, 'to', p_role));
  end if;

  if p_reporting_manager_id is distinct from target.reporting_manager_id then
    changes := changes || jsonb_build_object('reporting_manager_id',
      jsonb_build_object('from', target.reporting_manager_id, 'to', p_reporting_manager_id));
  end if;

  if next_job_title is distinct from target.job_title then
    changes := changes || jsonb_build_object('job_title',
      jsonb_build_object('from', target.job_title, 'to', next_job_title));
  end if;

  perform set_config('focus.privileged_write', 'on', true);

  update public.user_profiles
     set full_name = coalesce(btrim(p_full_name), full_name),
         email = coalesce(lower(btrim(p_email))::extensions.citext, email),
         department_id = coalesce(p_department_id, department_id),
         role = next_role,
         reporting_manager_id = p_reporting_manager_id,
         job_title = next_job_title,
         personal_summary_mode = coalesce(p_personal_summary_mode, personal_summary_mode),
         -- Demotion out of a management role must also drop the team summary,
         -- which the table constraint would otherwise reject.
         team_summary_mode = case
           when next_role in ('manager', 'administrator')
             then coalesce(p_team_summary_mode, team_summary_mode)
           else 'off'::public.team_summary_mode
         end
   where id = p_user_id;

  perform focus.write_audit(
    p_event_type := 'user_updated',
    p_actor_id := actor,
    p_subject_user_id := p_user_id,
    p_detail := changes);

  if changes <> '{}'::jsonb then
    insert into public.admin_security_log (
      event_type, actor_user_id, subject_user_id, subject_employee_id,
      subject_email, summary, detail
    ) values (
      'user_updated', actor, p_user_id, target.employee_id, target.email::text,
      format('Updated %s (%s)', target.full_name, target.employee_id), changes
    );
  end if;

  return jsonb_build_object('ok', true, 'code', 'updated');
exception
  when unique_violation then
    return focus.error('duplicate_identity', 'That email address is already in use.');
end;
$$;

-- ---------------------------------------------------------------------------
-- API surface. The grants died with the old signatures.
-- ---------------------------------------------------------------------------

revoke all on function public.provision_user_profile(
  uuid, text, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode, uuid, text) from public, anon;
revoke all on function public.update_user_profile(
  uuid, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode, text) from public, anon;

-- Provisioning runs only from the server, never from a browser session.
grant execute on function public.provision_user_profile(
  uuid, text, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode, uuid, text) to service_role;

grant execute on function public.update_user_profile(
  uuid, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode, text) to authenticated;
