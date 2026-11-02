-- v274 — An intake is claimed by one authorized coordinator before triage.
-- This is intentionally staff-only: there is still no anonymous mutation path.

create or replace function public.esh_claim_report_intake(p_intake_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  intake public.esh_report_intake%rowtype;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  select * into intake
    from public.esh_report_intake
   where id = p_intake_id
     and organization_id = focus.esh_organization_id()
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not focus.esh_scope_all()
     and (intake.department_id is null
          or intake.department_id <> all (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if intake.status <> 'new' then
    return jsonb_build_object('ok', false, 'code', 'not_available', 'status', intake.status);
  end if;

  update public.esh_report_intake
     set status = 'triaging', assigned_triager_id = actor, triaged_at = now()
   where id = intake.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values
    (intake.organization_id, 'staff', actor, 'report_intake_claimed',
     jsonb_build_object('intake_id', intake.id, 'source', intake.source));

  return jsonb_build_object('ok', true, 'id', intake.id, 'status', 'triaging');
end;
$$;

revoke all on function public.esh_claim_report_intake(uuid) from public, anon;
grant execute on function public.esh_claim_report_intake(uuid) to authenticated;
