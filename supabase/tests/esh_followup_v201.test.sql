-- ============================================================================
-- ESH Finding Management v201: follow-up, reminders and escalation.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §15,
-- §16; FM30-FM39. The scheduler is driven with an explicit "now", so every
-- rule is checked on the day it applies: reminders before and after the due
-- date, escalation level by level with missed levels coalesced, and nothing
-- at all once the work is with ESH.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(52);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
end;
$$;

create or replace function pg_temp.reset_role()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.uid(p_who text)
returns uuid
language sql
immutable
as $$
  select case p_who
    when 'admin' then 'f0c05000-0000-4000-a000-000000000001'
    when 'izzul' then 'f0c05000-0000-4000-a000-000000000002'
    when 'amer'  then 'f0c05000-0000-4000-a000-000000000003'
  end::uuid;
$$;

create or replace function pg_temp.secret(p_seed text)
returns text
language sql
immutable
as $$
  select left(p_seed || repeat('x', 64), 43);
$$;

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;

create or replace function pg_temp.id(p_name text)
returns uuid
language sql
stable
as $$
  select id from ids where name = p_name;
$$;

-- An assigned action due on 10 December, with a three-level escalation route
-- and the owner's access on.
create or replace function pg_temp.assigned(p_key text, p_owner text)
returns void
language plpgsql
as $$
declare
  result jsonb;
  v_principal uuid;
begin
  perform pg_temp.act_as(pg_temp.uid('izzul'));
  result := public.esh_save_finding(null, jsonb_build_object(
    'title', 'v201 ' || p_key, 'description', 'Found on the v201 walk',
    'reported_on', '2026-09-10',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Put it right', 'priority', 'high',
    'owner_email', p_owner, 'due_date', '2026-12-10',
    'escalation', jsonb_build_array(
      jsonb_build_object('level', 1, 'email', 'supervisor.v201@example.com'),
      jsonb_build_object('level', 2, 'email', 'manager.v201@example.com'),
      jsonb_build_object('level', 3, 'email', 'director.v201@example.com'))
  ), true);
  perform pg_temp.reset_role();
  if not coalesce((result->>'ok')::boolean, false) then
    raise exception 'assign failed: %', result;
  end if;
  insert into ids values (p_key, (result->>'action_id')::uuid),
                         (p_key || '_finding', (result->>'finding_id')::uuid);
  select owner_principal_id into v_principal from public.esh_finding_actions
   where id = (result->>'action_id')::uuid;
  insert into ids values (p_key || '_owner', v_principal);
  update public.esh_email_principals set access_enabled = true
   where id in (select id from public.esh_email_principals
                 where canonical_email in (p_owner, 'supervisor.v201@example.com',
                                           'manager.v201@example.com', 'director.v201@example.com'));
  update public.esh_notification_outbox set state = 'provider_accepted', sent_at = now()
   where action_id = (result->>'action_id')::uuid and event_type = 'owner_assignment';
end;
$$;

select pg_temp.assigned('guard', 'guard.v201@example.com');
select pg_temp.assigned('spill', 'spill.v201@example.com');

-- ---------------------------------------------------------------------------
-- 1. The policy (§16)
-- ---------------------------------------------------------------------------

select is(
  (select pre_due_days || '/' || overdue_every_days || '/' || level_days::text || '/'
          || review_reminder_days
     from public.esh_followup_policies),
  '2/2/{1,3,7}/2',
  'the organisation starts on the specification''s example timings');
select is(
  (select policy_version from public.esh_action_assignments
    where action_id = pg_temp.id('guard')),
  1,
  'an assignment keeps the policy version it was made under');

select pg_temp.act_as(pg_temp.uid('amer'));
select is(
  public.esh_set_followup_policy(2, true, 2, array[1, 3, 7], 2)->>'code',
  'not_permitted',
  'only ESH changes the follow-up policy');
select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  public.esh_set_followup_policy(2, true, 2, array[3, 1, 7], 2)->'problems',
  '["levels_out_of_order"]'::jsonb,
  'a later level cannot fire before an earlier one');
select is(
  (public.esh_set_followup_policy(1, true, 2, array[1, 3, 7], 2)->>'version')::int,
  2,
  'saving bumps the version');
select pg_temp.reset_role();
select is(
  (select policy_version from public.esh_action_assignments where action_id = pg_temp.id('guard')),
  1,
  'and work already assigned keeps the version it started under');
select is(
  (select followup_pre_due_days from public.esh_action_assignments
    where action_id = pg_temp.id('guard')),
  2::smallint,
  'the complete old policy is snapshotted, not only its version number');
-- Back to the defaults for the rest of the test.
select pg_temp.act_as(pg_temp.uid('izzul'));
select ok((public.esh_set_followup_policy(2, true, 2, array[1, 3, 7], 2)->>'ok')::boolean,
  'the policy is set back to the example timings');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 2. Owner reminders (§16, FM37)
-- ---------------------------------------------------------------------------

-- esh_run_followups reminds every overdue owner in the organisation, so its
-- returned total is not this test's to assert: on a database carrying any
-- other overdue work -- the end-to-end import spec releases a backlog with
-- due dates in the past -- it is larger, and says nothing about these two
-- owners. Each assertion below counts what its own call raised for them
-- (AGENTS.md section 10).
create temporary table outbox_mark (id uuid primary key);
grant all on outbox_mark to authenticated;
create or replace function pg_temp.mark_outbox() returns void
language sql as $$
  delete from outbox_mark where true;
  insert into outbox_mark select id from public.esh_notification_outbox;
$$;
create or replace function pg_temp.reminded_since_mark() returns integer
language sql stable as $$
  select count(*)::int from public.esh_notification_outbox
   where event_type = 'owner_reminder'
     and recipient_principal_id in (pg_temp.id('guard_owner'), pg_temp.id('spill_owner'))
     and id not in (select id from outbox_mark);
$$;

select pg_temp.mark_outbox();
select public.esh_run_followups('2026-12-08 09:00+08');
select is(
  pg_temp.reminded_since_mark(),
  2,
  'two days before the due date, both owners are reminded');
select pg_temp.mark_outbox();
select public.esh_run_followups('2026-12-08 21:00+08');
select is(
  pg_temp.reminded_since_mark(),
  0,
  'a second run the same day adds nothing (FM37)');
select is(
  (select count(*)::int from public.esh_notification_outbox
    where action_id = pg_temp.id('guard') and event_type = 'owner_reminder'),
  1,
  'so exactly one reminder is waiting to go');
select is(
  (select kind from public.esh_followup_events where action_id = pg_temp.id('guard')),
  'owner_pre_due',
  'recorded as the pre-due reminder');
select pg_temp.mark_outbox();
select public.esh_run_followups('2026-12-09 09:00+08');
select is(
  pg_temp.reminded_since_mark(),
  0,
  'the day between is quiet');
select pg_temp.mark_outbox();
select public.esh_run_followups('2026-12-10 09:00+08');
select is(
  pg_temp.reminded_since_mark(),
  2,
  'on the due day itself they are reminded again');
select pg_temp.mark_outbox();
select public.esh_run_followups('2026-12-11 09:00+08');
select is(
  pg_temp.reminded_since_mark(),
  0,
  'one day late is not a reminder day, on a two-day cycle');
select pg_temp.mark_outbox();
select public.esh_run_followups('2026-12-12 09:00+08');
select is(
  pg_temp.reminded_since_mark(),
  2,
  'two days late is');

-- ---------------------------------------------------------------------------
-- 3. Escalation (§15, §16, FM30-FM32)
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.esh_escalation_entitlements
    where action_id = pg_temp.id('guard') and level = 1),
  1,
  'one day overdue reached Level 1, and only Level 1');
select is(
  (select count(*)::int from public.esh_escalation_entitlements
    where action_id = pg_temp.id('guard') and level > 1),
  0,
  'Level 2 has nothing yet (FM32)');
select is(
  (select state || '/' || link_intents::text from public.esh_notification_outbox o
     join public.esh_email_principals p on p.id = o.recipient_principal_id
    where o.action_id = pg_temp.id('guard') and o.event_type = 'escalation'
      and p.canonical_email = 'supervisor.v201@example.com'),
  'queued/["escalation_action"]',
  'the supervisor gets their own scoped link, not the owner''s');
select is(
  (public.esh_run_followups('2026-12-12 21:00+08')->>'escalations')::int,
  0,
  'the same level is not sent again on a rerun');
select is(
  (public.esh_run_followups('2026-12-13 09:00+08')->>'escalations')::int,
  2,
  'three days overdue activates Level 2 for both open actions');
select is(
  (select count(*)::int from public.esh_escalation_entitlements
    where action_id = pg_temp.id('guard') and level = 2),
  1,
  'three days overdue reaches Level 2');

-- An action that goes unseen for a week escalates once, to the level now due.
update public.esh_finding_actions set due_at = '2026-12-01 09:00+00' where id = pg_temp.id('spill');
delete from public.esh_notification_outbox
 where action_id = pg_temp.id('spill') and event_type in ('escalation', 'owner_reminder');
delete from public.esh_escalation_entitlements where action_id = pg_temp.id('spill');
delete from public.esh_followup_events where action_id = pg_temp.id('spill');
select is(
  (public.esh_run_followups('2026-12-09 09:00+08')->>'escalations')::int,
  1,
  'eight days overdue sends one escalation, not five (FM37)');
select is(
  (select level::int from public.esh_escalation_entitlements where action_id = pg_temp.id('spill')),
  3,
  'and it is the level now due');
select is(
  (select array_agg(stage order by stage) from public.esh_followup_events
    where action_id = pg_temp.id('spill') and kind = 'escalation' and state = 'suppressed'),
  array[1, 2]::smallint[],
  'with the levels it passed recorded as skipped, not sent late');
select is(
  (select count(*)::int from public.esh_notification_outbox
    where action_id = pg_temp.id('spill') and event_type = 'escalation_exhausted'),
  1,
  'and ESH is told the last level has been reached (§16)');

-- ---------------------------------------------------------------------------
-- 4. The escalation recipient's access (§15, FM33, FM34)
-- ---------------------------------------------------------------------------

insert into ids
select 'supervisor', id from public.esh_email_principals
 where canonical_email = 'supervisor.v201@example.com';
insert into public.esh_access_grants
  (organization_id, principal_id, purpose, action_id, assignment_version, token_hash,
   issued_reason, expires_at)
select 'e5e50000-0000-4000-8000-000000000001', pg_temp.id('supervisor'), 'escalation_action',
       pg_temp.id('guard'), a.assignment_version,
       focus.esh_secret_hash(pg_temp.secret('grant-esc')), 'notification', now() + interval '1 day'
  from public.esh_finding_actions a where a.id = pg_temp.id('guard');
select is(
  public.esh_guest_exchange(pg_temp.secret('grant-esc'), pg_temp.secret('session-esc'), null, null, true)->>'destination',
  '/respond/actions/' || pg_temp.id('guard'),
  'the escalation link opens that one action');
select is(
  public.esh_guest_action(pg_temp.secret('session-esc'), pg_temp.id('guard'), null)->>'mode',
  'escalation',
  'and opens it as an escalation recipient');
select is(
  public.esh_guest_action(pg_temp.secret('session-esc'), pg_temp.id('spill'), null)->>'code',
  'not_available',
  'never another action they were not escalated on');
select is(
  public.esh_guest_submit(pg_temp.secret('session-esc'), pg_temp.id('guard'), 'Done by me', '{}', null, 'esc-key-0001')->>'code',
  'not_available',
  'they cannot submit the owner''s work (FM33)');
select is(
  public.esh_guest_start_upload(pg_temp.secret('session-esc'), pg_temp.id('guard'), 'photo.jpg', 2048)->>'code',
  'not_available',
  'nor add evidence');
select is(
  public.esh_guest_my_actions(pg_temp.secret('session-esc'), 'needs', null, 0, 20)->>'code',
  'no_inbox_scope',
  'nor read an owner inbox');
select ok(
  (public.esh_guest_send_message(pg_temp.secret('session-esc'), pg_temp.id('guard'),
     'Chasing this with the shift lead today.', 'esc-key-0002')->>'ok')::boolean,
  'they can reply in the conversation (§15)');
select is(
  (select author_kind from public.esh_action_messages
    where action_id = pg_temp.id('guard') and body like 'Chasing%'),
  'escalation',
  'and their reply is attributed to them as an escalation recipient');
select ok(
  exists (select 1 from public.esh_notification_outbox
           where action_id = pg_temp.id('guard')
             and event_type = 'escalation_reply'
             and recipient_user_id is not null),
  'a meaningful escalation reply tells the responsible ESH staff');
select is(
  (select state from public.esh_finding_actions where id = pg_temp.id('guard')),
  'assigned',
  'a supervisor''s comment does not start the owner''s work');
select is(
  (public.esh_guest_acknowledge(pg_temp.secret('session-esc'), pg_temp.id('guard'))->>'level')::int,
  1,
  'acknowledging records the level');
select is(
  (select count(*)::int from public.esh_escalation_entitlements
    where action_id = pg_temp.id('guard') and acknowledged_at is not null),
  1,
  'once');
select is(
  (select state from public.esh_finding_actions where id = pg_temp.id('guard')),
  'assigned',
  'and acknowledging is not completing the work (§15)');

-- ---------------------------------------------------------------------------
-- 5. Once it is with ESH, the owner is left alone (§16, FM35, FM36)
-- ---------------------------------------------------------------------------

update public.esh_finding_actions set state = 'awaiting_verification' where id = pg_temp.id('guard');
with written as (
  insert into public.esh_action_submissions
    (organization_id, action_id, version, assignment_version, principal_id, owner_email,
     message_id, result_text, submitted_at, client_key)
  select a.organization_id, a.id, 1, a.assignment_version, a.owner_principal_id, p.display_email,
         (select m.id from public.esh_action_messages m where m.action_id = a.id limit 1),
         'Done', '2026-12-12 09:00+08', 'sub-guard-v201'
    from public.esh_finding_actions a
    join public.esh_email_principals p on p.id = a.owner_principal_id
   where a.id = pg_temp.id('guard')
  returning id
)
insert into ids select 'guard_submission', id from written;
update public.esh_finding_actions set current_submission_id = pg_temp.id('guard_submission')
 where id = pg_temp.id('guard');

select is(
  (public.esh_run_followups('2026-12-13 09:00+08')->>'owner_reminders')::int,
  1,
  'only the other action that still belongs to its owner is reminded');
select is(
  (select count(*)::int from public.esh_followup_events
    where action_id = pg_temp.id('guard')
      and kind like 'owner_%'
      and trigger_key = '2026-12-13'),
  0,
  'an action with ESH gets no owner reminder (FM35)');
select is(
  (public.esh_run_followups('2026-12-14 09:00+08')->>'review_reminders')::int,
  0,
  'calendar days do not masquerade as working days (FM36)');
select is(
  (public.esh_run_followups('2026-12-15 09:00+08')->>'review_reminders')::int,
  1,
  'after two maintained working days ESH is reminded to review it (FM36)');
select is(
  (public.esh_run_followups('2026-12-16 09:00+08')->>'review_reminders')::int,
  0,
  'once, not every day');

-- ---------------------------------------------------------------------------
-- 6. The maintained working calendar and provider evidence (§16-§17)
-- ---------------------------------------------------------------------------

select is(
  focus.esh_after_working_days(
    'e5e50000-0000-4000-8000-000000000001', '2026-12-11', 2),
  '2026-12-15'::date,
  'the explicit Monday-Friday pattern skips the weekend');
select pg_temp.act_as(pg_temp.uid('izzul'));
select ok(
  (public.esh_set_working_calendar(
    array[1,2,3,4,5], '2026-12-31',
    '[{"date":"2026-12-14","is_working_day":false,"label":"Maintained closure"}]'::jsonb
  )->>'ok')::boolean,
  'ESH can maintain a labelled calendar exception');
select pg_temp.reset_role();
select is(
  focus.esh_after_working_days(
    'e5e50000-0000-4000-8000-000000000001', '2026-12-11', 2),
  '2026-12-16'::date,
  'a maintained closure changes the working-day deadline');

update public.esh_notification_outbox set provider_message_id = 'provider-v201-1'
 where action_id = pg_temp.id('guard') and event_type = 'owner_assignment';
select is(
  public.esh_record_delivery_event(
    'event-v201-delivered', 'provider-v201-1', 'delivered', now(), null)->>'state',
  'delivered',
  'provider delivery is distinct from provider acceptance (FM38)');
select is(
  (public.esh_record_delivery_event(
    'event-v201-delivered', 'provider-v201-1', 'bounced', now(), 'duplicate')->>'duplicate')::boolean,
  true,
  'a duplicate provider event is idempotent (FM39)');
select is(
  public.esh_record_delivery_event(
    'event-v201-bounced', 'provider-v201-1', 'bounced', now(), 'Mailbox rejected')->>'state',
  'bounced',
  'a later bounce is recorded without rewriting the acceptance fact');
select is(
  (select count(*)::int from public.esh_delivery_events
    where provider_message_id = 'provider-v201-1'),
  2,
  'only distinct provider events are stored');
select is(
  (select state_reason from public.esh_notification_outbox
    where provider_message_id = 'provider-v201-1'),
  'bounced',
  'the outbox exposes the delivery problem to ESH');

select * from finish();

rollback;
