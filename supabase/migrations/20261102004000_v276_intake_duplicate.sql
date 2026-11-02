-- v276 — A duplicate intake links to an existing in-scope Finding without a
-- second Finding, action, owner assignment or reminder.

alter table public.esh_report_intake
  add column duplicate_of_finding_id uuid references public.esh_findings (id);

create or replace function public.esh_mark_report_intake_duplicate(
  p_intake_id uuid,
  p_finding_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  intake public.esh_report_intake%rowtype;
  target public.esh_findings%rowtype;
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if reason is null then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  select * into intake from public.esh_report_intake
   where id = p_intake_id and organization_id = focus.esh_organization_id() for update;
  if not found or (not focus.esh_scope_all() and (intake.department_id is null
      or intake.department_id <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if intake.status not in ('new', 'triaging') then
    return jsonb_build_object('ok', false, 'code', 'not_available', 'status', intake.status);
  end if;
  select * into target from public.esh_findings
   where id = p_finding_id and organization_id = intake.organization_id;
  if not found or target.status not in ('new', 'open')
     or (not focus.esh_scope_all() and (target.accountable_department_id is null
       or target.accountable_department_id <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'finding_not_found');
  end if;
  update public.esh_report_intake set status = 'duplicate', duplicate_of_finding_id = target.id,
    assigned_triager_id = actor, triaged_at = now(), decision_reason = reason where id = intake.id;
  insert into public.esh_audit_events (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (intake.organization_id, 'staff', actor, 'report_intake_duplicate', target.id,
    jsonb_build_object('intake_id', intake.id, 'reason', reason));
  return jsonb_build_object('ok', true, 'id', intake.id, 'status', 'duplicate', 'finding_id', target.id);
end;
$$;

revoke all on function public.esh_mark_report_intake_duplicate(uuid, uuid, text) from public, anon;
grant execute on function public.esh_mark_report_intake_duplicate(uuid, uuid, text) to authenticated;
