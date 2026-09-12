-- ---------------------------------------------------------------------------
-- v169 — A reporting line that can be changed, and remembered
--
-- Moving somebody was possible only through the whole user form, which says
-- nothing about what the move means and leaves no record of when it happened.
-- Six months later "who did Amer report to in March?" had no answer: the
-- profile holds the present tense and nothing else.
--
-- This adds the record and one procedure that owns the change. The procedure
-- is the only writer: it validates, moves the line, writes the history row and
-- audits it in a single transaction, so a move cannot be half-made and cannot
-- happen unrecorded.
--
-- A reporting line is still not permission. Moving somebody changes who manages
-- them; what they may see remains the visibility model (v66, v68, v80).
-- ---------------------------------------------------------------------------

create table public.reporting_assignments (
  id uuid primary key default extensions.gen_random_uuid(),

  subject_id uuid not null references public.user_profiles (id) on delete cascade,

  -- Nullable at both ends: somebody can arrive at the top of the line, or
  -- leave it. ON DELETE SET NULL so a permanently deleted account cannot
  -- cascade away somebody else's history.
  previous_manager_id uuid references public.user_profiles (id) on delete set null,
  new_manager_id uuid references public.user_profiles (id) on delete set null,

  /*
   * When the move takes effect, in the organisation's calendar.
   *
   * Separate from `changed_at`, which is when somebody pressed the button. A
   * transfer agreed on the 1st and entered on the 9th belongs to the 1st, and
   * the question this table exists to answer is about the month, not the
   * keystroke.
   */
  effective_date date not null default focus.local_today(),
  reason text,

  changed_by uuid references public.user_profiles (id) on delete set null,
  changed_at timestamptz not null default now(),

  constraint reporting_assignments_not_self
    check (new_manager_id is null or new_manager_id <> subject_id),
  constraint reporting_assignments_is_a_change
    check (previous_manager_id is distinct from new_manager_id),
  constraint reporting_assignments_reason_not_blank
    check (reason is null or length(btrim(reason)) > 0)
);

create index reporting_assignments_subject_idx
  on public.reporting_assignments (subject_id, effective_date desc, changed_at desc);
create index reporting_assignments_changed_idx
  on public.reporting_assignments (changed_at desc);

comment on table public.reporting_assignments is
  'Every change of reporting line, effective-dated. Append-only: history that '
  'can be edited answers nothing.';

-- History stays append-only for everybody, the same rule as the audit trail.
alter table public.reporting_assignments enable row level security;

create policy reporting_assignments_select on public.reporting_assignments
  for select to authenticated
  using (focus.is_admin());

create trigger reporting_assignments_no_update
  before update on public.reporting_assignments
  for each row execute function focus.reject_audit_mutation();

create trigger reporting_assignments_no_delete
  before delete on public.reporting_assignments
  for each row execute function focus.reject_audit_mutation();

-- Written by the procedure below, never by a caller.
revoke insert, update, delete on public.reporting_assignments from authenticated;
revoke update, delete on public.reporting_assignments from service_role;

-- ---------------------------------------------------------------------------
-- The one way to move somebody
--
-- `p_manager_id` is the new manager, and null means the top of the line. That
-- reads differently from `update_user_profile`, where a null field means "leave
-- it alone" — here the whole point of the call is the manager, so saying
-- nothing is not a possibility worth reserving a value for.
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
    subject_id, previous_manager_id, new_manager_id, effective_date, reason, changed_by
  ) values (
    p_user_id, subject.reporting_manager_id, p_manager_id, effective,
    nullif(btrim(coalesce(p_reason, '')), ''), actor
  );

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

comment on function public.change_reporting_manager is
  'Administrator-only. Moves a reporting line, records it effective-dated, and audits it.';

revoke all on function public.change_reporting_manager(uuid, uuid, text, date) from public, anon;
grant execute on function public.change_reporting_manager(uuid, uuid, text, date) to authenticated;
