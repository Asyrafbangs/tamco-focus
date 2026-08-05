-- ============================================================================
-- TAMCO Focus — administrator user directory and account lifecycle
--
-- Implements MASTER_PRODUCT_SPEC.md section 31B.1 / 31B.2 and
-- PRODUCTION_LOGIC.md section 13.
--
-- Division of responsibility with the application:
--   * The server action creates the local Supabase Auth identity through the
--     supported admin path, because only that path can hash a password
--     correctly and issue a usable credential.
--   * `provision_user_profile` then creates the application profile, defaults,
--     and audit event in ONE transaction.
--   * If this procedure raises, the server action deletes the auth identity it
--     just created. Neither a profile without a credential nor a credential
--     without a profile is an acceptable end state (section 13.2).
-- ============================================================================

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
  p_actor_id uuid default null
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
    reporting_manager_id, status, personal_summary_mode, team_summary_mode
  ) values (
    p_user_id, normalised_employee_id, normalised_email, btrim(p_full_name),
    p_department_id, p_role, p_reporting_manager_id, 'active',
    p_personal_summary_mode, effective_team_mode
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
    jsonb_build_object('role', p_role);

  -- Section 13.2, step 8 — return a sanitised profile.
  return jsonb_build_object(
    'ok', true,
    'code', 'user_created',
    'user', jsonb_build_object(
      'id', p_user_id,
      'employee_id', normalised_employee_id,
      'email', normalised_email,
      'full_name', btrim(p_full_name),
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
-- Deactivation (section 31B.2, PRODUCTION_LOGIC.md 13.3)
--
-- The normal removal path. Access is revoked; every historical reference is
-- preserved. Open primary-owned work is reported back so an administrator can
-- reassign it rather than silently orphan it.
-- ---------------------------------------------------------------------------

create or replace function public.deactivate_user(
  p_user_id uuid,
  p_allow_open_work boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target record;
  open_work jsonb;
  open_count integer;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can deactivate users.');
  end if;

  select * into target from public.user_profiles where id = p_user_id for update;
  if not found then return focus.error('not_found', 'That user does not exist.'); end if;

  if target.status = 'deactivated' then
    return jsonb_build_object('ok', true, 'code', 'already_deactivated');
  end if;

  if p_user_id = actor then
    return focus.error('invalid_target', 'You cannot deactivate your own account.');
  end if;

  -- Section 13.3 — identify open owned work before revoking access.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'title', t.title, 'status', t.status)), '[]'::jsonb),
         count(*)
    into open_work, open_count
    from public.tasks t
   where t.primary_owner_id = p_user_id
     and t.status in ('backlog', 'active', 'paused');

  if open_count > 0 and not p_allow_open_work then
    return focus.error(
      'open_work_requires_reassignment',
      format('%s open item(s) still name this person as the primary owner. Reassign them, or confirm the controlled exception.', open_count),
      jsonb_build_object('open_work', open_work));
  end if;

  perform set_config('focus.privileged_write', 'on', true);

  update public.user_profiles
     set status = 'deactivated', deactivated_at = now()
   where id = p_user_id;

  perform focus.write_audit(
    p_event_type := 'user_deactivated',
    p_actor_id := actor,
    p_subject_user_id := p_user_id,
    p_detail := jsonb_build_object(
      'open_work_count', open_count, 'controlled_exception', p_allow_open_work)
  );

  insert into public.admin_security_log (
    event_type, actor_user_id, subject_user_id, subject_employee_id,
    subject_email, summary, detail
  ) values (
    'user_deactivated', actor, p_user_id, target.employee_id, target.email::text,
    format('Deactivated %s (%s)', target.full_name, target.employee_id),
    jsonb_build_object('open_work_count', open_count)
  );

  return jsonb_build_object('ok', true, 'code', 'deactivated',
                            'open_work_count', open_count);
end;
$$;

create or replace function public.reactivate_user(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target record;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can reactivate users.');
  end if;

  select * into target from public.user_profiles where id = p_user_id for update;
  if not found then return focus.error('not_found', 'That user does not exist.'); end if;

  if target.status = 'active' then
    return jsonb_build_object('ok', true, 'code', 'already_active');
  end if;

  perform set_config('focus.privileged_write', 'on', true);

  update public.user_profiles
     set status = 'active', deactivated_at = null
   where id = p_user_id;

  perform focus.write_audit(
    p_event_type := 'user_reactivated',
    p_actor_id := actor,
    p_subject_user_id := p_user_id);

  insert into public.admin_security_log (
    event_type, actor_user_id, subject_user_id, subject_employee_id,
    subject_email, summary
  ) values (
    'user_reactivated', actor, p_user_id, target.employee_id, target.email::text,
    format('Reactivated %s (%s)', target.full_name, target.employee_id)
  );

  return jsonb_build_object('ok', true, 'code', 'reactivated');
end;
$$;

-- ---------------------------------------------------------------------------
-- Retained history check (section 31B.2, PRODUCTION_LOGIC.md 13.4)
--
-- Permanent deletion is permitted ONLY where no retained history exists. This
-- function reports what is retained, and the foreign keys enforce the rule
-- independently: even if this check were bypassed, Postgres would refuse the
-- delete.
-- ---------------------------------------------------------------------------

create or replace function public.user_retained_history(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'owned_tasks',      (select count(*) from public.tasks where primary_owner_id = p_user_id),
    'created_tasks',    (select count(*) from public.tasks where created_by = p_user_id),
    'collaborations',   (select count(*) from public.task_collaborators where user_id = p_user_id),
    'checklist_items',  (select count(*) from public.task_checklist_items
                          where assigned_to = p_user_id or completed_by = p_user_id),
    'updates',          (select count(*) from public.task_updates where author_id = p_user_id),
    'attachments',      (select count(*) from public.attachments where uploaded_by = p_user_id),
    'attachment_views', (select count(*) from public.attachment_views where viewer_id = p_user_id),
    'barriers',         (select count(*) from public.barriers
                          where raised_by = p_user_id or resolved_by = p_user_id),
    'reviews',          (select count(*) from public.completion_reviews
                          where submitted_by = p_user_id
                             or reviewer_id = p_user_id
                             or second_reviewer_id = p_user_id),
    'notifications',    (select count(*) from public.notifications
                          where recipient_id = p_user_id or actor_id = p_user_id),
    'audit_events',     (select count(*) from public.audit_events
                          where actor_id = p_user_id or subject_user_id = p_user_id),
    'email_deliveries', (select count(*) from public.email_deliveries where recipient_id = p_user_id),
    'direct_reports',   (select count(*) from public.user_profiles
                          where reporting_manager_id = p_user_id)
  );
$$;

-- Permanent deletion. Requires the employee ID as confirmation (section 31B.2)
-- and writes the administrative security event BEFORE the row disappears,
-- because `admin_security_log` deliberately holds no foreign key to the user it
-- describes and must outlive it.
create or replace function public.delete_user_permanently(
  p_user_id uuid,
  p_employee_id_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target record;
  history jsonb;
  retained_total bigint := 0;
  entry record;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can delete a user.');
  end if;

  select * into target from public.user_profiles where id = p_user_id for update;
  if not found then return focus.error('not_found', 'That user does not exist.'); end if;

  if p_user_id = actor then
    return focus.error('invalid_target', 'You cannot delete your own account.');
  end if;

  if upper(btrim(coalesce(p_employee_id_confirmation, ''))) <> upper(target.employee_id) then
    return focus.error('confirmation_mismatch',
      'Type the employee ID exactly to confirm permanent deletion.');
  end if;

  history := public.user_retained_history(p_user_id);

  for entry in select key, value from jsonb_each(history) loop
    retained_total := retained_total + (entry.value)::bigint;
  end loop;

  if retained_total > 0 then
    return focus.error(
      'retained_history_exists',
      'This account has retained history and cannot be permanently deleted. Deactivate it instead.',
      history);
  end if;

  -- Written first, on purpose: it must survive the row it describes.
  insert into public.admin_security_log (
    event_type, actor_user_id, actor_employee_id, actor_email,
    subject_user_id, subject_employee_id, subject_email, summary, detail
  )
  select
    'user_deleted', actor,
    (select employee_id from public.user_profiles where id = actor),
    (select email::text from public.user_profiles where id = actor),
    p_user_id, target.employee_id, target.email::text,
    format('Permanently deleted %s (%s)', target.full_name, target.employee_id),
    jsonb_build_object('retained_history', history);

  perform set_config('focus.privileged_write', 'on', true);

  delete from public.user_alert_preferences where user_id = p_user_id;
  delete from public.visibility_grants where viewer_id = p_user_id or subject_id = p_user_id;
  delete from public.visibility_policies where viewer_id = p_user_id;
  delete from public.user_profiles where id = p_user_id;

  -- The auth identity is removed by the calling server action through the
  -- admin API, which is the supported path for credential deletion.
  return jsonb_build_object('ok', true, 'code', 'deleted',
                            'employee_id', target.employee_id);
exception
  when foreign_key_violation then
    -- The database refused the delete. This is the authoritative guarantee
    -- described in section 31B.2, independent of the check above.
    return focus.error('retained_history_exists',
      'This account is still referenced by retained records and cannot be deleted. Deactivate it instead.',
      public.user_retained_history(p_user_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrator profile maintenance
-- ---------------------------------------------------------------------------

create or replace function public.update_user_profile(
  p_user_id uuid,
  p_full_name text default null,
  p_email text default null,
  p_department_id uuid default null,
  p_role public.app_role default null,
  p_reporting_manager_id uuid default null,
  p_personal_summary_mode public.personal_summary_mode default null,
  p_team_summary_mode public.team_summary_mode default null
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
  changes jsonb := '{}'::jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can change user records.');
  end if;

  select * into target from public.user_profiles where id = p_user_id for update;
  if not found then return focus.error('not_found', 'That user does not exist.'); end if;

  next_role := coalesce(p_role, target.role);

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

  perform set_config('focus.privileged_write', 'on', true);

  update public.user_profiles
     set full_name = coalesce(btrim(p_full_name), full_name),
         email = coalesce(lower(btrim(p_email))::extensions.citext, email),
         department_id = coalesce(p_department_id, department_id),
         role = next_role,
         reporting_manager_id = p_reporting_manager_id,
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
-- Visibility administration (section 22.5, Appendix A9)
--
-- Replaces a viewer's complete grant set in one transaction so the effective
-- access preview the administrator approved is exactly what is saved.
-- ---------------------------------------------------------------------------

create or replace function public.set_user_visibility(
  p_viewer_id uuid,
  p_mode public.visibility_mode,
  p_subject_ids uuid[] default array[]::uuid[],
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  previous jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can change visibility rules.');
  end if;

  if not exists (select 1 from public.user_profiles where id = p_viewer_id) then
    return focus.error('not_found', 'That user does not exist.');
  end if;

  if p_viewer_id = any (p_subject_ids) then
    return focus.error('validation_failed',
      'A person always sees their own work; they do not need a grant for it.');
  end if;

  select coalesce(jsonb_agg(subject_id), '[]'::jsonb) into previous
    from public.visibility_grants where viewer_id = p_viewer_id;

  insert into public.visibility_policies (viewer_id, mode, updated_by)
  values (p_viewer_id, p_mode, coalesce(actor, p_viewer_id))
  on conflict (viewer_id) do update
    set mode = excluded.mode, updated_by = excluded.updated_by;

  delete from public.visibility_grants where viewer_id = p_viewer_id;

  if p_mode <> 'none' and array_length(p_subject_ids, 1) is not null then
    insert into public.visibility_grants (viewer_id, subject_id, granted_by, reason)
    select p_viewer_id, s.subject_id, coalesce(actor, p_viewer_id), p_reason
      from unnest(p_subject_ids) as s(subject_id)
     where s.subject_id <> p_viewer_id
    on conflict (viewer_id, subject_id) do nothing;
  end if;

  -- Section 22.5 — all changes create an immutable administrator audit event.
  perform focus.write_audit(
    p_event_type := 'visibility_changed',
    p_actor_id := actor,
    p_subject_user_id := p_viewer_id,
    p_detail := jsonb_build_object(
      'mode', p_mode,
      'previous_subject_ids', previous,
      'subject_ids', coalesce(to_jsonb(p_subject_ids), '[]'::jsonb),
      'reason', p_reason));

  insert into public.admin_security_log (
    event_type, actor_user_id, subject_user_id, summary, detail
  ) values (
    'visibility_changed', actor, p_viewer_id,
    format('Changed visibility rules for %s',
           (select full_name from public.user_profiles where id = p_viewer_id)),
    jsonb_build_object('mode', p_mode, 'subject_ids', coalesce(to_jsonb(p_subject_ids), '[]'::jsonb))
  );

  return jsonb_build_object('ok', true, 'code', 'visibility_updated');
end;
$$;

-- Effective-access preview (section 22.5 — "searchable people chips and
-- effective-access preview"). Returns who a viewer would be able to see, and
-- why, WITHOUT granting the caller sight of anything.
create or replace function public.preview_effective_visibility(p_viewer_id uuid)
returns table (
  user_id uuid,
  full_name text,
  employee_id text,
  source text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with viewer as (
    select
      p.id,
      p.role,
      coalesce(
        (select vp.mode from public.visibility_policies vp where vp.viewer_id = p.id),
        'specific_only'::public.visibility_mode
      ) as mode
    from public.user_profiles p
    where p.id = p_viewer_id
      -- Only an administrator may run the preview at all.
      and (auth.uid() is null or focus.is_admin())
  ),
  resolved as (
    select viewer.id as user_id, 'own work' as source from viewer

    union all

    select p.id, 'administrator scope'
      from public.user_profiles p, viewer
     where viewer.role = 'administrator'

    union all

    select t.user_id, 'direct report'
      from viewer
      join lateral focus.reporting_tree(viewer.id) t on true
     where viewer.mode = 'direct_reports_plus'
       and t.user_id <> viewer.id

    union all

    select g.subject_id, 'explicit grant'
      from public.visibility_grants g, viewer
     where g.viewer_id = viewer.id and viewer.mode <> 'none'
  )
  select
    r.user_id,
    p.full_name,
    p.employee_id,
    min(r.source) as source
  from resolved r
  join public.user_profiles p on p.id = r.user_id
  group by r.user_id, p.full_name, p.employee_id
  order by p.full_name;
$$;

-- ---------------------------------------------------------------------------
-- API surface.
--
-- Only these procedures are callable over PostgREST. Everything in the `focus`
-- schema stays unreachable from the browser.
-- ---------------------------------------------------------------------------

revoke all on all functions in schema public from public, anon;

grant execute on function
  public.activate_task(uuid, integer, public.activation_reason, text, text),
  public.move_task_to_available(uuid, integer, text),
  public.pause_task(uuid, integer, text, timestamptz, text),
  public.resume_task(uuid, integer, public.activation_reason, text, text),
  public.complete_task(uuid, integer, text, text),
  public.cancel_task(uuid, integer, text, text),
  public.reassign_task(uuid, integer, uuid, text),
  public.undo_event(uuid, text),
  public.complete_checklist_item(uuid, text, text),
  public.reopen_checklist_item(uuid, text),
  public.raise_barrier(uuid, text, text, public.barrier_impact, boolean, text),
  public.resolve_barrier(uuid, text),
  public.record_attachment_view(uuid),
  public.decide_completion_review(uuid, public.review_decision, text, text),
  public.record_routine_finding(uuid, public.finding_severity, text, uuid),
  public.generate_routine_occurrences(date),
  public.user_retained_history(uuid),
  public.deactivate_user(uuid, boolean),
  public.reactivate_user(uuid),
  public.delete_user_permanently(uuid, text),
  public.update_user_profile(uuid, text, text, uuid, public.app_role, uuid,
                             public.personal_summary_mode, public.team_summary_mode),
  public.set_user_visibility(uuid, public.visibility_mode, uuid[], text),
  public.preview_effective_visibility(uuid)
to authenticated;

-- Provisioning runs only from the server, never from a browser session.
grant execute on function
  public.provision_user_profile(uuid, text, text, text, uuid, public.app_role, uuid,
                                public.personal_summary_mode, public.team_summary_mode, uuid)
to service_role;
