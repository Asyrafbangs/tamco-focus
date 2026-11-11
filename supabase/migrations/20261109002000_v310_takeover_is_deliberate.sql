/*
 * v310 — a take over is a deliberate act, never a side effect.
 *
 * v307 relaxed this claim so a report stuck with a colleague who never comes
 * back could be rescued: it began accepting 'triaging' as well as 'new'. The
 * rescue was right and the relaxation was too wide, because this procedure has
 * a caller that nobody presses.
 *
 * `saveFinding` claims on your behalf. Accepting a report calls
 * `esh_accept_report_intake`, which refuses anybody who is not holding it with
 * `not_claimed`; on that answer the action claims the report and tries again,
 * so a coordinator who never pressed "Keep for triage" can still assign a
 * report from the queue in one press. With v307 in place that convenience
 * became a silent take over: press "Assign & next" on a report a colleague is
 * holding and it is claimed out from under them, accepted, and a Finding
 * exists behind their back. `esh-triage-workspace-v293` says what the rule is
 * — "a report another coordinator is holding is said so, not taken", and
 * "nothing was created behind their back" — and that is the rule a shared
 * triage queue needs: the hold exists so that two coordinators do not both
 * work one report and so that the decision has one owner.
 *
 * So the take over now has to ask. `p_take_over` defaults to false, which is
 * what every existing caller passes and what the automatic claim keeps
 * passing; a report held by somebody else is refused `held_by_other` and the
 * assign path reports `not_claimed` exactly as it did before v307. Pressed
 * deliberately, with `p_take_over`, the rescue v307 was for still works and is
 * still recorded with the person it was taken from.
 *
 * The one-argument signature is dropped rather than left beside this one: two
 * overloads differing only by a defaulted argument make every one-argument
 * call ambiguous, and PostgREST answers an ambiguous call with null.
 */

drop function if exists public.esh_claim_report_intake(uuid);

create or replace function public.esh_claim_report_intake(
  p_intake_id uuid,
  p_take_over boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  actor uuid := auth.uid();
  intake public.esh_report_intake%rowtype;
  previous uuid;
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
  -- v307 - 'triaging' as well, which is the take over. A report that has been
  -- declined, or already become a Finding, is still not claimable.
  if intake.status not in ('new', 'triaging') then
    return jsonb_build_object('ok', false, 'code', 'not_available', 'status', intake.status);
  end if;

  previous := intake.assigned_triager_id;

  /*
   * v310 - somebody else is holding it, and nobody asked to take it over.
   * Refusing here is what keeps the automatic claim in `saveFinding` from
   * quietly becoming one. Claiming a report you already hold is not a take
   * over and stays allowed, which is what makes this safe to call twice.
   */
  if intake.status = 'triaging'
     and previous is not null
     and previous is distinct from actor
     and not coalesce(p_take_over, false) then
    return jsonb_build_object('ok', false, 'code', 'held_by_other', 'held_by', previous);
  end if;

  update public.esh_report_intake
     set status = 'triaging', assigned_triager_id = actor, triaged_at = now()
   where id = intake.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values
    (intake.organization_id, 'staff', actor, 'report_intake_claimed',
     jsonb_build_object(
       'intake_id', intake.id,
       'source', intake.source,
       -- Null unless somebody else held it: the handover, kept.
       'taken_over_from', case when previous is distinct from actor then previous end));

  return jsonb_build_object(
    'ok', true,
    'id', intake.id,
    'status', 'triaging',
    'taken_over', previous is not null and previous is distinct from actor);
end;
$function$;

revoke all on function public.esh_claim_report_intake(uuid, boolean) from public, anon;
grant execute on function public.esh_claim_report_intake(uuid, boolean) to authenticated;
