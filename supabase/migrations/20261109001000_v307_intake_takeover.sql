-- v307: a claimed report can be taken over, so one person's absence cannot
-- bury a hazard report.
--
-- THE DEAD END
--
-- Triage is a two-step lock. `esh_claim_report_intake` moves a report from
-- 'new' to 'triaging' and records `assigned_triager_id`, and
-- `esh_accept_report_intake` - the only path that turns a report into a
-- Finding - refuses anybody else:
--
--     if intake.status <> 'triaging'
--        or intake.assigned_triager_id is distinct from actor then
--       return ... 'not_claimed';
--
-- The claim itself refused anything that was not 'new', so a second
-- coordinator could not take the report either. Between them, a report claimed
-- by somebody who then goes on leave, changes role or simply forgets can never
-- become a Finding. The only act still open to a colleague is
-- `esh_decline_report_intake`, which accepts 'new' or 'triaging' and checks no
-- triager - so the one thing anybody else can do with a stuck hazard report is
-- throw it away.
--
-- That is the wrong way round. Declining a report is a judgement that it is
-- not a finding; it should never be the easier path because the person who
-- claimed it is unavailable.
--
-- THE CHANGE
--
-- The claim now accepts 'triaging' as well as 'new', which makes it a take
-- over. Nothing else moves:
--
--   * `esh_can('coordinate')` and the department scope are unchanged, so who
--     may triage is exactly who could before;
--   * the lock still does its job. Claiming is still how a coordinator says
--     they have this one, and the row still names a single triager - it can
--     now name a different one;
--   * accept, decline and duplicate are untouched. A report still has to be
--     claimed by whoever accepts it, which is the rule that stops two people
--     converting the same report twice.
--
-- The audit records the handover rather than losing it: a take over writes the
-- person it was taken from, so "who was triaging this" stays answerable.

create or replace function public.esh_claim_report_intake(p_intake_id uuid)
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
