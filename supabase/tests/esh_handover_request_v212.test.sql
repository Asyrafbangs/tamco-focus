-- ============================================================================
-- ESH Finding Management v212: "this is not mine" is a request, not a handover.
--
-- §11, §14. What only the database can establish: naming somebody writes their
-- address onto the message and gives them nothing — no principal, no grant, no
-- assignment — the name comes back on the next read so ESH can act on it, and
-- the handover itself remains the ordinary reassignment.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
create or replace function pg_temp.v212(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

select has_column('public', 'esh_action_messages', 'proposed_owner_email',
                  'a message can name who should hold the work');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids
select 'action', (public.esh_save_finding(null, jsonb_build_object(
  'title', 'v212 oil under the press', 'description', 'Found on the v212 walk',
  'reported_on', '2026-09-10',
  'accountable_department_id', (select id from public.departments where code = 'OPS'),
  'location', 'BR2', 'required_outcome', 'Stop the leak', 'priority', 'normal',
  'owner_email', 'owner.v212@example.com', 'due_date', '2026-12-10',
  'escalation', '[]'::jsonb,
  'no_further_escalation_reason', 'Fixture needs no route.'
), true)->>'action_id')::uuid;
select pg_temp.reset_role();

insert into ids
select 'owner', id from public.esh_email_principals
 where canonical_email = 'owner.v212@example.com';

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access(pg_temp.v212('owner'), true,
            'v212 fixture')->>'ok')::boolean, 'the contact is enabled for the fixture');
select pg_temp.reset_role();

insert into public.esh_access_grants
  (organization_id, principal_id, purpose, action_id, assignment_version, token_hash,
   issued_reason, expires_at)
select p.organization_id, p.id, 'owner_action', pg_temp.v212('action'), 1,
       focus.esh_secret_hash(pg_temp.secret('action-v212')), 'notification',
       now() + interval '1 day'
  from public.esh_email_principals p where p.id = pg_temp.v212('owner');
select ok((public.esh_guest_exchange(pg_temp.secret('action-v212'), pg_temp.secret('session-v212'),
            null, null, true)->>'ok')::boolean, 'the owner opens their link');

-- ---------------------------------------------------------------------------
-- Naming somebody (§11)
-- ---------------------------------------------------------------------------

select is((public.esh_guest_send_message(pg_temp.secret('session-v212'), pg_temp.v212('action'),
            'The press is maintenance, not production.', 'v212-hand', '{}'::uuid[],
            null, null, 'NEXT.Owner@Example.com ')->>'ok')::boolean, true,
          'the owner says whose work this really is');

select is((select proposed_owner_email from public.esh_action_messages
            where action_id = pg_temp.v212('action') order by sent_at desc limit 1),
          'next.owner@example.com',
          'the address is kept with the message, in its canonical form');
select is((select count(*)::integer from public.esh_email_principals
            where canonical_email = 'next.owner@example.com'), 0,
          'naming somebody does not make them a contact');
select is((select count(*)::integer from public.esh_access_grants g
            join public.esh_email_principals p on p.id = g.principal_id
           where p.canonical_email = 'next.owner@example.com'), 0,
          'and gives them no way in');
select is((select assignment_version from public.esh_finding_actions
            where id = pg_temp.v212('action')), 1,
          'the work is still the owner''s, on the same assignment');
select is(public.esh_guest_action(pg_temp.secret('session-v212'), pg_temp.v212('action'))
            ->'messages'->-1->>'proposed_owner_email', 'next.owner@example.com',
          'and the request comes back on the next read, which makes it answerable');

-- An address that is not one is simply not a request.
select is((public.esh_guest_send_message(pg_temp.secret('session-v212'), pg_temp.v212('action'),
            'Give it to whoever.', 'v212-junk', '{}'::uuid[], null, null, 'not an address')
            ->>'ok')::boolean, true,
          'a message with a malformed address is still a message');
select is((select proposed_owner_email from public.esh_action_messages
            where action_id = pg_temp.v212('action') and client_key = 'v212-junk'),
          null::text,
          'but nothing is recorded as a request for somebody who cannot exist');

-- ---------------------------------------------------------------------------
-- Granting it (§14)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_reassign_action(pg_temp.v212('action'), 'next.owner@example.com',
            'Taking it off them.')->>'code', 'not_permitted',
          'somebody outside ESH cannot hand the work over');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok((public.esh_reassign_action(pg_temp.v212('action'), 'next.owner@example.com',
            'The Action Owner said this belongs to next.owner@example.com.')->>'ok')::boolean,
          'ESH hands it to exactly the person who was named');

select * from finish();
rollback;
