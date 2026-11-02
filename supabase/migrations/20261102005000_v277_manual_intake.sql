-- v277 — Coordinator-recorded verbal/manual reports remain private intake.
create or replace function public.esh_create_manual_report_intake(
  p_report_text text, p_reported_location text default null, p_department_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid(); org uuid := focus.esh_organization_id();
  body text := nullif(btrim(coalesce(p_report_text, '')), ''); intake_id uuid;
begin
  if actor is null or not focus.esh_can('coordinate') then return jsonb_build_object('ok', false, 'code', 'not_permitted'); end if;
  if body is null or length(body) > 4000 then return jsonb_build_object('ok', false, 'code', 'invalid_report'); end if;
  if p_department_id is not null and (not focus.esh_scope_all() and p_department_id <> any (focus.esh_visible_department_ids())) then return jsonb_build_object('ok', false, 'code', 'department_not_found'); end if;
  if p_department_id is not null and not exists (select 1 from public.departments where id = p_department_id and status = 'active') then return jsonb_build_object('ok', false, 'code', 'department_not_found'); end if;
  insert into public.esh_report_intake (organization_id, source, report_text, reported_location, department_id)
  values (org, 'esh_manual', body, nullif(btrim(coalesce(p_reported_location, '')), ''), p_department_id) returning id into intake_id;
  insert into public.esh_audit_events (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'report_intake_created_manual', jsonb_build_object('intake_id', intake_id));
  return jsonb_build_object('ok', true, 'id', intake_id, 'status', 'new');
end;
$$;
revoke all on function public.esh_create_manual_report_intake(text, text, uuid) from public, anon;
grant execute on function public.esh_create_manual_report_intake(text, text, uuid) to authenticated;
