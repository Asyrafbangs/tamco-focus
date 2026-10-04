-- ============================================================================
-- ESH Finding Management v207: one letter instead of eleven.
--
-- §41; FM97-FM99. What only the database can establish: routine notices are
-- gathered per person per cycle and never sent twice, every member is
-- re-checked at the moment of sending, a digest with nothing left in it is not
-- sent, and a digest's outcome is recorded against each event it carried.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);
end;
$$;
create or replace function pg_temp.reset_role()
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create or replace function pg_temp.secret(p_seed text)
returns text language sql immutable as $$
  select left(p_seed || repeat('x', 64), 43);
$$;
create or replace function pg_temp.assign(p_title text, p_due text)
returns uuid language plpgsql as $$
declare
  result jsonb;
begin
  result := public.esh_save_finding(null, jsonb_build_object(
    'title', p_title, 'description', 'Found on the v207 walk',
    'reported_on', '2026-09-01',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'location', 'BR2', 'required_outcome', 'Put it right', 'priority', 'normal',
    'owner_email', 'owner.v207@example.com', 'due_date', p_due,
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true);
  if not coalesce((result->>'ok')::boolean, false) then
    raise exception 'assign failed: %', result;
  end if;
  return (result->>'action_id')::uuid;
end;
$$;

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;
create or replace function pg_temp.v207_digest()
returns uuid language sql stable as $$ select id from ids where name = 'digest' $$;

select has_table('public', 'esh_digest_members', 'a digest records what it carries');
select ok((select relrowsecurity from pg_class where oid = 'public.esh_digest_members'::regclass),
          'and does so under row security');
select ok(has_function_privilege('service_role', 'public.esh_build_digests(timestamptz)', 'EXECUTE'),
          'only the scheduled service gathers notices');
select ok(not has_function_privilege('authenticated', 'public.esh_build_digests(timestamptz)', 'EXECUTE'),
          'a signed-in browser cannot');

-- Three overdue actions for one owner, and reminders raised for each.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
-- The policy reminds an overdue owner every second day, so all three are
-- given dates that fall due on the same cycle as the run below.
insert into ids values
  ('one', pg_temp.assign('v207 walkway', '2026-09-04')),
  ('two', pg_temp.assign('v207 guard', '2026-09-06')),
  ('three', pg_temp.assign('v207 label', '2026-09-08'));
select pg_temp.reset_role();

insert into ids
select 'owner', id from public.esh_email_principals where canonical_email = 'owner.v207@example.com';

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access((select id from ids where name = 'owner'), true,
            'v207 fixture')->>'ok')::boolean, 'the contact is enabled for the fixture');
select pg_temp.reset_role();

-- The assignment emails are held until ESH releases them; the fixture does not
-- need them, and they must not end up in a digest either.
update public.esh_notification_outbox set state = 'cancelled'
 where event_type = 'owner_assignment'
   and recipient_principal_id = (select id from ids where name = 'owner');

-- What this call raised for this test's owner, rather than what it raised
-- for the whole organisation.
--
-- esh_run_followups reminds every overdue owner there is, so on a database
-- carrying anything else overdue -- the end-to-end import spec releases a
-- backlog with due dates in the past -- the returned total is larger and
-- says nothing about these three actions (AGENTS.md section 10).
create temporary table v207_before_first as
  select id from public.esh_notification_outbox;
select public.esh_run_followups('2026-09-20 01:00:00+00');
select is((select count(*)::integer from public.esh_notification_outbox
            where event_type = 'owner_reminder'
              and recipient_principal_id = (select id from ids where name = 'owner')
              and id not in (select id from v207_before_first)), 3,
          'each overdue action raises its own reminder');
select is((select count(*)::integer from public.esh_notification_outbox
            where event_type = 'owner_reminder' and state = 'queued'), 3,
          'queued separately, as the events they are');

select is((public.esh_build_digests(now())->>'digests')::text, '1',
          'one letter for one person');
insert into ids
select 'digest', id from public.esh_notification_outbox where event_type = 'owner_digest';

select is((select count(*)::integer from public.esh_digest_members
            where digest_id = pg_temp.v207_digest()), 3,
          'carrying all three');
select is((select count(*)::integer from public.esh_notification_outbox
            where event_type = 'owner_reminder' and state = 'digested'), 3,
          'and each reminder is marked as carried, not queued');
select is((select count(*)::integer from public.esh_notification_outbox
            where event_type = 'owner_reminder' and state = 'queued'), 0,
          'so nothing is sent on its own as well');

select is((public.esh_build_digests(now())->>'digests')::text, '0',
          'a second run of the same morning gathers nothing again');

-- One of them is answered before the post goes.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok((public.esh_change_due((select id from ids where name = 'three'), '2026-12-01',
            null, 'Agreed with the contractor')->>'ok')::boolean,
          'ESH moves one action''s date after the reminder was raised');
select pg_temp.reset_role();

select ok((public.esh_dispatch_claim(pg_temp.v207_digest(),
            jsonb_build_object('owner_inbox', pg_temp.secret('inbox-v207')))->>'ok')::boolean,
          'the worker claims the digest');
select is((select count(*)::integer from public.esh_digest_members
            where digest_id = pg_temp.v207_digest() and state = 'removed'), 1,
          'the action whose schedule moved is dropped from the letter');
select is((select removed_reason from public.esh_digest_members
            where digest_id = pg_temp.v207_digest() and state = 'removed'), 'schedule_changed',
          'and says why');
select is((select state from public.esh_notification_outbox
            where id = (select member_id from public.esh_digest_members
                         where digest_id = pg_temp.v207_digest() and state = 'removed')),
          'suppressed',
          'its own event is closed off rather than left waiting');
select is((select count(*)::integer from public.esh_access_grants
            where outbox_id = pg_temp.v207_digest() and purpose = 'owner_inbox'), 1,
          'the owner gets one link to their own list, not one per action');

select ok((public.esh_dispatch_complete(pg_temp.v207_digest(), true, null, false, 'msg-v207')
            ->>'ok')::boolean, 'the provider accepts it');
select is((select count(*)::integer from public.esh_digest_members
            where digest_id = pg_temp.v207_digest() and state = 'sent'), 2,
          'both carried actions are recorded as sent');
select is((select count(*)::integer from public.esh_notification_outbox
            where event_type = 'owner_reminder' and state = 'provider_accepted'), 2,
          'against their own events, so the register can say what went');

-- A digest with nothing left in it is not sent at all.
create temporary table v207_before_second as
  select id from public.esh_notification_outbox;
select public.esh_run_followups('2026-09-22 01:00:00+00');
select is((select count(*)::integer from public.esh_notification_outbox
            where event_type = 'owner_reminder'
              and recipient_principal_id = (select id from ids where name = 'owner')
              and id not in (select id from v207_before_second)), 2,
          'the next overdue cycle raises reminders again');
select is((public.esh_build_digests(now() + interval '2 days')->>'digests')::text, '1',
          'and they gather into a second letter');
insert into ids
select 'second', id from public.esh_notification_outbox
 where event_type = 'owner_digest' and id <> pg_temp.v207_digest();

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
do $$
declare
  action_id uuid;
begin
  for action_id in select id from ids where name in ('one', 'two') loop
    perform public.esh_reassign_action(action_id, 'somebody.else.v207@example.com',
                                       'Handed over for the fixture');
  end loop;
end $$;
select pg_temp.reset_role();

select is(public.esh_dispatch_claim((select id from ids where name = 'second'),
            jsonb_build_object('owner_inbox', pg_temp.secret('inbox-two-v207')))->>'code',
          'suppressed',
          'a letter whose every line has moved on is not sent');
select is((select state from public.esh_notification_outbox
            where id = (select id from ids where name = 'second')), 'suppressed',
          'and is closed off as such');

select * from finish();
rollback;
