-- ============================================================================
-- ESH Finding Management v211: a date the owner asks for is part of what they
-- said, and nothing more.
--
-- §11, §14. What only the database can establish: asking for more time writes
-- the date onto the message and moves no deadline, the ask is returned to both
-- sides on the next read, and granting it stays the ordinary due-date change
-- with its reason, its history and its notice.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;
create or replace function pg_temp.v211(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids
select 'action', (public.esh_save_finding(null, jsonb_build_object(
  'title', 'v211 blocked exit', 'description', 'Found on the v211 walk',
  'reported_on', '2026-09-10',
  'accountable_department_id', (select id from public.departments where code = 'OPS'),
  'location', 'BR2', 'required_outcome', 'Clear the exit', 'priority', 'high',
  'owner_email', 'owner.v211@example.com', 'due_date', '2026-12-10',
  'escalation', '[]'::jsonb,
  'no_further_escalation_reason', 'Fixture needs no route.'
), true)->>'action_id')::uuid;
select pg_temp.reset_role();

insert into ids
select 'owner', id from public.esh_email_principals
 where canonical_email = 'owner.v211@example.com';
insert into ids
select 'finding', finding_id from public.esh_finding_actions where id = pg_temp.v211('action');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access(pg_temp.v211('owner'), true,
            'v211 fixture')->>'ok')::boolean,
          'the contact is enabled for the fixture');
select pg_temp.reset_role();

insert into public.esh_access_grants
  (organization_id, principal_id, purpose, action_id, assignment_version, token_hash,
   issued_reason, expires_at)
select p.organization_id, p.id, 'owner_action', pg_temp.v211('action'), 1,
       focus.esh_secret_hash(pg_temp.secret('action-v211')), 'notification',
       now() + interval '1 day'
  from public.esh_email_principals p where p.id = pg_temp.v211('owner');

select ok((public.esh_guest_exchange(pg_temp.secret('action-v211'), pg_temp.secret('session-v211'),
            null, null, true)->>'ok')::boolean,
          'the owner opens their link');

-- ---------------------------------------------------------------------------
-- Asking for more time (§11)
-- ---------------------------------------------------------------------------

select is((public.esh_guest_send_message(pg_temp.secret('session-v211'), pg_temp.v211('action'),
            'The contractor cannot come until the 14th.', 'v211-ask', '{}'::uuid[],
            '2026-12-20'::date)->>'ok')::boolean, true,
          'the owner asks for more time in their own words');

select is((select proposed_due_date from public.esh_action_messages
            where action_id = pg_temp.v211('action') order by sent_at desc limit 1),
          '2026-12-20'::date,
          'the date they asked for is kept with what they said');
select is((select due_at from public.esh_finding_actions where id = pg_temp.v211('action')),
          focus.esh_due_instant((select organization_id from public.esh_finding_actions
                                  where id = pg_temp.v211('action')), '2026-12-10', null),
          'and the deadline has not moved by a single hour');
select is((select state from public.esh_finding_actions where id = pg_temp.v211('action')),
          'in_progress', 'saying something still starts the work');
select is((select count(*)::integer from public.esh_due_date_changes
            where action_id = pg_temp.v211('action')), 0,
          'asking is not a change, so nothing is recorded as one');

-- The ask comes back on the next read, which is what makes it answerable.
select is(public.esh_guest_action(pg_temp.secret('session-v211'), pg_temp.v211('action'))
            ->'messages'->-1->>'proposed_due_date', '2026-12-20',
          'the owner sees their own ask in the thread');

-- ---------------------------------------------------------------------------
-- Granting it (§14)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_change_due(pg_temp.v211('action'), '2026-12-20', null,
            'Agreed the request.')->>'code', 'not_permitted',
          'somebody outside ESH cannot grant it');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is(public.esh_change_due(pg_temp.v211('action'), '2026-12-20', null, '')->>'code',
          'invalid', 'and ESH cannot grant it without saying why');
select ok((public.esh_change_due(pg_temp.v211('action'), '2026-12-20', null,
            'Agreed the Action Owner''s request to move the deadline to 20 Dec 2026.')
            ->>'ok')::boolean,
          'ESH grants exactly the date that was asked for');
select is((select new_due_at::date from public.esh_due_date_changes
            where action_id = pg_temp.v211('action')), '2026-12-20'::date,
          'the change is on the record, as any other due-date change is');
select ok((select reason like '%20 Dec 2026%' from public.esh_due_date_changes
            where action_id = pg_temp.v211('action')),
          'with a reason that says what was agreed');
select ok(exists(select 1 from public.esh_notification_outbox
                  where action_id = pg_temp.v211('action') and event_type = 'due_changed'),
          'and the owner is told, rather than left to notice');

select * from finish();
rollback;
