-- ---------------------------------------------------------------------------
-- v172 — Every move is recorded, whichever screen made it
--
-- v169 promised that a move cannot happen unrecorded, and kept the promise on
-- the Organisation screen only. The Directory's user form still had its own
-- Reporting manager field, saved by update_user_profile, which was written
-- before the history table existed and set the manager directly. Move somebody
-- there and the effective-dated record never heard of it, and the rules v169
-- enforces — no deactivated manager, a loop answered with a sentence — did not
-- apply.
--
-- It was worse than unrecorded. A null manager meant "clear it", so any caller
-- updating something else — a job title, a name — and saying nothing about the
-- manager moved that person to the top of the organisation. The Directory form
-- always submits the field, so the screen was safe; the procedure was not.
--
-- So two changes. update_user_profile now hands a changed manager to
-- change_reporting_manager, so one procedure owns every move whichever screen
-- asks for it, with one set of rules and one history. And a null manager now
-- means "leave it alone", the default the department procedures already use,
-- with clearing asked for explicitly. That is a new parameter, so the function
-- is dropped and recreated rather than replaced, and its grant reissued.
-- ---------------------------------------------------------------------------

drop function if exists public.update_user_profile(
  uuid, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode, text);

create or replace function public.update_user_profile(
  p_user_id uuid,
  p_full_name text default null,
  p_email text default null,
  p_department_id uuid default null,
  p_role public.app_role default null,
  p_reporting_manager_id uuid default null,
  p_personal_summary_mode public.personal_summary_mode default null,
  p_team_summary_mode public.team_summary_mode default null,
  p_job_title text default null,
  p_clear_reporting_manager boolean default false
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
  next_manager uuid;
  changes jsonb := '{}'::jsonb;
  moved jsonb;
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
  -- Null leaves the manager alone; only the explicit flag clears it.
  next_manager := case
    when p_clear_reporting_manager then null
    else coalesce(p_reporting_manager_id, target.reporting_manager_id)
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

  if next_job_title is distinct from target.job_title then
    changes := changes || jsonb_build_object('job_title',
      jsonb_build_object('from', target.job_title, 'to', next_job_title));
  end if;

  /*
   * The manager, handed to the procedure that owns moves.
   *
   * It validates, writes the history row and audits the move itself, so the
   * move is not repeated in `changes`. If it refuses, this save stops before
   * anything else is written: a form that applied the name and quietly dropped
   * the manager would be a half-save reported as a success.
   */
  if next_manager is distinct from target.reporting_manager_id then
    moved := public.change_reporting_manager(p_user_id, next_manager, null, null);
    if not coalesce((moved ->> 'ok')::boolean, false) then
      return moved;
    end if;
  end if;

  perform set_config('focus.privileged_write', 'on', true);

  update public.user_profiles
     set full_name = coalesce(btrim(p_full_name), full_name),
         email = coalesce(lower(btrim(p_email))::extensions.citext, email),
         department_id = coalesce(p_department_id, department_id),
         role = next_role,
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
  -- The whole body is one block, so an email that loses a race here also rolls
  -- back a move the delegated call has already made.
  when unique_violation then
    return focus.error('duplicate_identity', 'That email address is already in use.');
end;
$$;

comment on function public.update_user_profile is
  'Administrator-only. A null field is left alone; a manager change is delegated to '
  'change_reporting_manager, so every move is validated and recorded the same way.';

revoke all on function public.update_user_profile(
  uuid, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode, text, boolean) from public, anon;
grant execute on function public.update_user_profile(
  uuid, text, text, uuid, public.app_role, uuid,
  public.personal_summary_mode, public.team_summary_mode, text, boolean) to authenticated;
