-- v278 — A claimed private report becomes a Finding through the established
-- saving procedure, never through a second assignment implementation.

alter table public.esh_report_intake
  add column accepted_finding_id uuid references public.esh_findings (id);

create unique index esh_report_intake_accepted_finding_unique
  on public.esh_report_intake (accepted_finding_id)
  where accepted_finding_id is not null;

create or replace function public.esh_accept_report_intake(
  p_intake_id uuid,
  p_payload jsonb,
  p_assign boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  intake public.esh_report_intake%rowtype;
  prior jsonb;
  saved jsonb;
  payload jsonb;
  result jsonb;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  if p_idempotency_key is not null then
    prior := focus.replay_operation(actor, p_idempotency_key);
    if prior is not null then return prior; end if;
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
  if intake.status <> 'triaging' or intake.assigned_triager_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'not_claimed');
  end if;

  -- Preserve the private report's provenance, while handing all normal
  -- validation, assignment, notification and audit rules to esh_save_finding.
  payload := p_payload || jsonb_build_object(
    'source', 'observation',
    'source_reference', 'private-intake:' || intake.id::text,
    'description', coalesce(nullif(btrim(p_payload->>'description'), ''), intake.report_text),
    'location', coalesce(nullif(btrim(p_payload->>'location'), ''), intake.reported_location),
    'accountable_department_id', coalesce(
      nullif(p_payload->>'accountable_department_id', ''),
      intake.department_id::text
    )
  );
  saved := public.esh_save_finding(null, payload, p_assign, null);
  if not coalesce((saved->>'ok')::boolean, false) then return saved; end if;

  update public.esh_report_intake
     set status = 'accepted',
         accepted_finding_id = (saved->>'finding_id')::uuid,
         assigned_triager_id = actor,
         triaged_at = now()
   where id = intake.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
  values
    (intake.organization_id, 'staff', actor, 'report_intake_accepted',
     (saved->>'finding_id')::uuid, (saved->>'action_id')::uuid,
     jsonb_build_object('intake_id', intake.id, 'assigned', p_assign));

  result := saved || jsonb_build_object('intake_id', intake.id, 'intake_status', 'accepted');
  return focus.remember_operation(actor, p_idempotency_key, 'esh_accept_report_intake', result);
end;
$$;

revoke all on function public.esh_accept_report_intake(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.esh_accept_report_intake(uuid, jsonb, boolean, text) to authenticated;
