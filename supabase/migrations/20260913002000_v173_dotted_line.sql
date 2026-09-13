-- ---------------------------------------------------------------------------
-- v173 — A dotted line, which grants nothing
--
-- Somebody can work for one leader day to day while reporting formally to
-- another: a production engineer who answers to the EHS Manager on safety,
-- say, and to the Production Manager for everything else. The record could
-- hold only the formal line, so the working one lived in people's heads.
--
-- This adds the second line and the procedure that owns it, and changes are
-- written into the same effective-dated history as formal moves, told apart by
-- `relationship`.
--
-- The rule that matters most is what this does NOT do. A dotted line grants no
-- sight of anybody's work. Visibility stays the per-person model (v66, v68,
-- v80): if the functional manager should see the person's work, an
-- administrator grants it there, deliberately. An organisation chart that
-- quietly became the security model would hand out access every time somebody
-- drew a line.
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column functional_manager_id uuid references public.user_profiles (id);

alter table public.user_profiles
  add constraint user_profiles_not_own_functional_manager
    check (functional_manager_id is null or functional_manager_id <> id);

create index user_profiles_functional_manager_idx
  on public.user_profiles (functional_manager_id)
  where functional_manager_id is not null;

comment on column public.user_profiles.functional_manager_id is
  'The dotted line: who somebody works for alongside their reporting manager. '
  'Grants no visibility; visibility is set per person.';

-- One history for both lines. Existing rows are formal moves.
alter table public.reporting_assignments
  add column relationship text not null default 'primary';

alter table public.reporting_assignments
  add constraint reporting_assignments_relationship_known
    check (relationship in ('primary', 'functional'));

comment on column public.reporting_assignments.relationship is
  'primary is the reporting line; functional is the dotted line.';

-- ---------------------------------------------------------------------------
-- The dotted line's procedure
--
-- The same shape as change_reporting_manager, with one refusal of its own: a
-- dotted line to the person who is already the reporting manager says nothing
-- the solid line does not, and would read on the chart as two relationships
-- where there is one.
-- ---------------------------------------------------------------------------

create or replace function public.change_functional_manager(
  p_user_id uuid,
  p_manager_id uuid default null,
  p_reason text default null,
  p_effective_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  subject record;
  manager record;
  effective date := coalesce(p_effective_date, focus.local_today());
  detail jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can change a reporting line.');
  end if;

  select * into subject from public.user_profiles where id = p_user_id for update;
  if not found then
    return focus.error('not_found', 'That person does not exist.');
  end if;

  if p_manager_id = p_user_id then
    return focus.error('manager_invalid', 'Somebody cannot be their own dotted-line manager.');
  end if;

  if p_manager_id is not null then
    select * into manager from public.user_profiles where id = p_manager_id;
    if not found then
      return focus.error('not_found', 'That manager does not exist.');
    end if;
    if manager.status <> 'active' then
      return focus.error('manager_inactive',
        format('%s is deactivated. Choose somebody who is still here.', manager.full_name));
    end if;
    if p_manager_id = subject.reporting_manager_id then
      return focus.error('manager_is_primary',
        format('%s is already their reporting manager. A dotted line to the same person adds nothing.',
               manager.full_name));
    end if;
  end if;

  if p_manager_id is not distinct from subject.functional_manager_id then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'id', p_user_id);
  end if;

  perform set_config('focus.privileged_write', 'on', true);

  update public.user_profiles
     set functional_manager_id = p_manager_id
   where id = p_user_id;

  insert into public.reporting_assignments (
    subject_id, previous_manager_id, new_manager_id, effective_date, reason, changed_by,
    relationship
  ) values (
    p_user_id, subject.functional_manager_id, p_manager_id, effective,
    nullif(btrim(coalesce(p_reason, '')), ''), actor, 'functional'
  );

  detail := jsonb_build_object(
    'action', 'functional_manager_changed',
    'effective_date', effective,
    'functional_manager_id', jsonb_build_object(
      'from', subject.functional_manager_id, 'to', p_manager_id));

  perform focus.write_audit(
    p_event_type := 'user_updated',
    p_actor_id := actor,
    p_subject_user_id := p_user_id,
    p_detail := detail);

  insert into public.admin_security_log (
    event_type, actor_user_id, subject_user_id, subject_employee_id,
    subject_email, summary, detail
  ) values (
    'user_updated', actor, p_user_id, subject.employee_id, subject.email::text,
    format('Changed the dotted-line manager for %s (%s)', subject.full_name, subject.employee_id),
    detail
  );

  return jsonb_build_object('ok', true, 'code', 'changed', 'id', p_user_id);
end;
$$;

comment on function public.change_functional_manager is
  'Administrator-only. Sets or clears the dotted line, records it, audits it. Grants nothing.';

revoke all on function public.change_functional_manager(uuid, uuid, text, date) from public, anon;
grant execute on function public.change_functional_manager(uuid, uuid, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The formal move learns about the dotted line
--
-- When somebody's dotted-line manager becomes their reporting manager, the
-- dotted line would be left pointing at the same person as the solid one. It
-- goes in the same transaction, and its going is recorded, so the history can
-- still say when the working relationship became the formal one.
--
-- Same signature as v169, so this replaces the function rather than adding an
-- overload; update_user_profile (v172) delegates here and inherits it.
-- ---------------------------------------------------------------------------

create or replace function public.change_reporting_manager(
  p_user_id uuid,
  p_manager_id uuid default null,
  p_reason text default null,
  p_effective_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  subject record;
  manager record;
  effective date := coalesce(p_effective_date, focus.local_today());
  detail jsonb;
begin
  if actor is not null and not focus.is_admin() then
    return focus.error('not_authorised', 'Only an administrator can change a reporting line.');
  end if;

  select * into subject from public.user_profiles where id = p_user_id for update;
  if not found then
    return focus.error('not_found', 'That person does not exist.');
  end if;

  if p_manager_id = p_user_id then
    return focus.error('manager_invalid', 'Somebody cannot report to themselves.');
  end if;

  if p_manager_id is not null then
    select * into manager from public.user_profiles where id = p_manager_id;
    if not found then
      return focus.error('not_found', 'That manager does not exist.');
    end if;
    /*
     * A deactivated manager is refused rather than warned about. The reason an
     * administrator is on this screen at all is usually that somebody left, and
     * handing their reports to the same departed account is the mistake worth
     * making impossible.
     */
    if manager.status <> 'active' then
      return focus.error('manager_inactive',
        format('%s is deactivated. Choose somebody who is still here.', manager.full_name));
    end if;
  end if;

  if p_manager_id is not distinct from subject.reporting_manager_id then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'id', p_user_id);
  end if;

  perform set_config('focus.privileged_write', 'on', true);

  update public.user_profiles
     set reporting_manager_id = p_manager_id
   where id = p_user_id;

  insert into public.reporting_assignments (
    subject_id, previous_manager_id, new_manager_id, effective_date, reason, changed_by,
    relationship
  ) values (
    p_user_id, subject.reporting_manager_id, p_manager_id, effective,
    nullif(btrim(coalesce(p_reason, '')), ''), actor, 'primary'
  );

  if p_manager_id is not null and p_manager_id = subject.functional_manager_id then
    update public.user_profiles
       set functional_manager_id = null
     where id = p_user_id;

    insert into public.reporting_assignments (
      subject_id, previous_manager_id, new_manager_id, effective_date, reason, changed_by,
      relationship
    ) values (
      p_user_id, subject.functional_manager_id, null, effective,
      'Became the reporting manager.', actor, 'functional'
    );
  end if;

  detail := jsonb_build_object(
    'action', 'reporting_manager_changed',
    'effective_date', effective,
    'reporting_manager_id', jsonb_build_object(
      'from', subject.reporting_manager_id, 'to', p_manager_id));

  perform focus.write_audit(
    p_event_type := 'user_updated',
    p_actor_id := actor,
    p_subject_user_id := p_user_id,
    p_detail := detail);

  insert into public.admin_security_log (
    event_type, actor_user_id, subject_user_id, subject_employee_id,
    subject_email, summary, detail
  ) values (
    'user_updated', actor, p_user_id, subject.employee_id, subject.email::text,
    format('Changed the reporting line for %s (%s)', subject.full_name, subject.employee_id),
    detail
  );

  return jsonb_build_object('ok', true, 'code', 'changed', 'id', p_user_id);
exception
  -- The cycle guard on `user_profiles` fires on the update above, for a loop
  -- further up the line than any check here can see. An administrator gets a
  -- sentence rather than a raised exception.
  when check_violation then
    return focus.error('manager_invalid',
      'That would make the reporting line loop back on itself.');
end;
$$;
