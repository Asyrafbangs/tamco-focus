/*
 * v313 — the two decisions that could still be taken off somebody.
 *
 * v310 settled that a take over is a deliberate act: `esh_claim_report_intake`
 * refuses a report another coordinator is holding unless the caller asked for
 * it, and `esh_accept_report_intake` has always refused anybody who is not the
 * holder. Auditing that invariant end to end found two procedures that never
 * joined it.
 *
 * `esh_decline_report_intake` and `esh_mark_report_intake_duplicate` both
 * accept `status in ('new', 'triaging')` and ask nothing about who holds it.
 * So the second coordinator could not take a held report over by assigning it —
 * and could still end it. One press on "Decline" and a colleague's report is
 * closed with somebody else's reason, `assigned_triager_id` overwritten with
 * the person who pressed it, and the audit naming only them. The triage screen
 * reaches both: since v310 it says "X is holding this report. Assigning it is
 * theirs to do while they have it." directly above a working Decline form and
 * a "Link duplicate without action" button.
 *
 * These two are more destructive than the take over v310 guarded. Assigning a
 * report produces a Finding somebody can see and reopen; declining it closes
 * the report, and linking it as a duplicate retires it against a Finding of
 * the caller's choosing. Neither leaves the holder anything to find.
 *
 * Why they were written this way is worth recording: before v307 the claim
 * refused `triaging` outright, so a report left held by somebody who never
 * came back could only be cleared by another coordinator declining it. The
 * back door was the rescue. v310 gave the rescue a front door with a named
 * button and an audited handover, so the back door is now only a hazard.
 *
 * The rule is the one v310 and `esh_accept_report_intake` already use, and it
 * costs no new parameter and no new control: a report nobody holds ('new') is
 * declinable and duplicable exactly as before, the holder may decide their own
 * report, and a report held by somebody else is refused `held_by_other`. To
 * decide a colleague's report you take it over first, which is a deliberate
 * press and is recorded with the person it was taken from.
 *
 * `create or replace` keeps the signature and therefore the grants; nothing is
 * dropped, so no overload can appear.
 */

create or replace function public.esh_decline_report_intake(p_intake_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- v313 - the decision belongs to whoever is holding it. Take it over first.
  if intake.status = 'triaging'
     and intake.assigned_triager_id is not null
     and intake.assigned_triager_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'held_by_other',
                              'held_by', intake.assigned_triager_id);
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
$function$;

create or replace function public.esh_mark_report_intake_duplicate(p_intake_id uuid, p_finding_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
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

  -- v313 - as above: retiring a report is the holder's decision to make.
  if intake.status = 'triaging'
     and intake.assigned_triager_id is not null
     and intake.assigned_triager_id is distinct from actor then
    return jsonb_build_object('ok', false, 'code', 'held_by_other',
                              'held_by', intake.assigned_triager_id);
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
$function$;
