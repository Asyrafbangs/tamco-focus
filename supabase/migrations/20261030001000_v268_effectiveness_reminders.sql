-- ============================================================================
-- v268 — somebody is told when an effectiveness check falls due
--
-- v267 could record a check, a verdict and the linked finding a failure
-- raises. Nothing told anybody the day had come, so a check booked in January
-- for April depended on somebody opening that finding in April — which is
-- exactly the dependence on human memory the rest of this module exists to
-- remove. A check nobody is reminded of is a note, not a control.
--
-- Its own procedure rather than a branch inside `esh_run_followups`. The
-- follow-up engine walks actions and owes its reminders to an owner on a
-- deadline; this walks checks and owes its reminder to ESH. Folding the second
-- into the first would mean copying three hundred lines forward to add a loop
-- that shares nothing with them.
--
-- Addressed to ESH, not to the named checker. `checker` is free text — often a
-- line supervisor who owns no action and has no contact record — so there is
-- nobody to write to and no entitlement to write with. ESH is told, and ESH
-- asks them. Giving a free-text name an email link would be inventing an
-- identity, which is the one thing section 8 forbids.
-- ============================================================================

alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_event_type_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_event_type_check
  check (event_type in ('owner_assignment', 'esh_reply', 'access_link',
                        'submission_received', 'submission_withdrawn',
                        'changes_requested', 'due_changed', 'finding_closed',
                        'finding_reopened', 'reassigned_away',
                        'owner_reminder', 'escalation', 'review_reminder',
                        'escalation_exhausted', 'owner_reply',
                        'escalation_reply', 'import_assignment',
                        'owner_digest', 'escalation_digest',
                        'effectiveness_due'));

/*
 * Queue a notice for every scheduled check that has reached its day.
 *
 * Idempotent on the check and the recipient, so a worker that runs twice in a
 * day sends once, and a check left undone is not re-queued every morning —
 * it stays visible as an outstanding check on the finding instead. Nagging
 * daily about a check nobody has done is how people learn to filter the
 * sender.
 */
create or replace function public.esh_run_effectiveness_due()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  c record;
  v_user uuid;
  v_queued integer := 0;
  v_checks integer := 0;
begin
  for c in
    select k.id, k.organization_id, k.finding_id, k.action_id, k.due_on,
           a.reviewer_user_id
      from public.esh_effectiveness_checks k
      join public.esh_finding_actions a on a.id = k.action_id
     where k.state = 'scheduled'
       and k.due_on <= current_date
     order by k.due_on
     limit 500
  loop
    v_checks := v_checks + 1;
    for v_user in
      select candidate from (
        select c.reviewer_user_id as candidate, 0 as rank
         where c.reviewer_user_id is not null
           and focus.esh_user_can_coordinate(c.reviewer_user_id, c.finding_id)
        union all
        select x.user_id, 1
          from public.esh_staff_access x
         where c.reviewer_user_id is null
           and x.organization_id = c.organization_id
           and x.enabled
           and x.preset = 'verifier'
           and focus.esh_user_can_coordinate(x.user_id, c.finding_id)
      ) people
      order by rank
      limit 20
    loop
      insert into public.esh_notification_outbox
        (organization_id, event_type, recipient_user_id, finding_id, action_id,
         state, link_intents, idempotency_key, next_attempt_at)
      values
        (c.organization_id, 'effectiveness_due', v_user, c.finding_id, c.action_id,
         'queued', '[]'::jsonb,
         'effectiveness_due:' || c.id || ':' || v_user, now())
      on conflict (idempotency_key) do nothing;
      if found then
        v_queued := v_queued + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'checks_due', v_checks, 'queued', v_queued);
end;
$$;

revoke all on function public.esh_run_effectiveness_due() from public, anon, authenticated;
grant execute on function public.esh_run_effectiveness_due() to service_role;
