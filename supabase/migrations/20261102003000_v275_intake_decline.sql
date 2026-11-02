-- v275 — A coordinator may decline an invalid private intake with a reason.
-- Declining never creates a Finding, action, owner, or notification.

create or replace function public.esh_decline_report_intake(
  p_intake_id uuid,
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
  reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  select * into intake
    from public.esh_report_intake
   where id = p_intake_id
     and organization_id = focus.esh_organization_id()
   for update;
  if not found
     or (not focus.esh_scope_all()
         and (intake.department_id is null
              or intake.department_id <> all (focus.esh_visible_department_ids()))) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if intake.status not in ('new', 'triaging') then
    return jsonb_build_object('ok', false, 'code', 'not_available', 'status', intake.status);
  end if;

  update public.esh_report_intake
     set status = 'declined', assigned_triager_id = actor, triaged_at = now(), decision_reason = reason
   where id = intake.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values
    (intake.organization_id, 'staff', actor, 'report_intake_declined',
     jsonb_build_object('intake_id', intake.id, 'reason', reason));

  return jsonb_build_object('ok', true, 'id', intake.id, 'status', 'declined');
end;
$$;

revoke all on function public.esh_decline_report_intake(uuid, text) from public, anon;
grant execute on function public.esh_decline_report_intake(uuid, text) to authenticated;
