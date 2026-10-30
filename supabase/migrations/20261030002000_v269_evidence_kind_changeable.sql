-- ============================================================================
-- v269 — the kind of proof can be corrected after assignment
--
-- v266 let ESH say what would be accepted, but only on the assignment form. So
-- the one case that matters most had no route: the owner sends a photograph,
-- ESH realises a photograph cannot show that an interlock functions, and there
-- is no way to change the ask except in prose in the conversation — which is
-- exactly the unenforceable sentence v266 existed to replace.
--
-- Its own procedure rather than a field on `esh_edit_finding`, because that one
-- edits the finding (title, description, location, department) and this edits
-- the action. Audited with both values, because changing what will be accepted
-- after somebody has already sent something is a decision the owner is entitled
-- to see the history of.
-- ============================================================================

create or replace function public.esh_set_evidence_kind(p_action_id uuid, p_kind text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  a public.esh_finding_actions;
  fnd public.esh_findings;
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if v_kind is not null and v_kind not in
     ('photograph', 'inspection', 'functional_test', 'measurement', 'procedure', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into a from public.esh_finding_actions
   where id = p_action_id and organization_id = org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into fnd from public.esh_findings where id = a.finding_id;
  if not (focus.esh_scope_all()
          or fnd.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if fnd.status not in ('new', 'open') then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  if a.evidence_kind is not distinct from v_kind then
    return jsonb_build_object('ok', false, 'code', 'unchanged');
  end if;

  update public.esh_finding_actions set
    evidence_kind = v_kind,
    updated_at = now(),
    row_version = row_version + 1
   where id = a.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'evidence_kind_changed', a.finding_id,
          jsonb_build_object('action_id', a.id, 'from', a.evidence_kind, 'to', v_kind));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.esh_set_evidence_kind(uuid, text) to authenticated;
