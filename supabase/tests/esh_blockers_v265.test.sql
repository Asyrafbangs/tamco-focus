-- ============================================================================
-- ESH Finding Management v265: "waiting for purchasing" as a fact, not prose.
--
-- The assertion that earns its place is the negative one: reporting a blocker
-- moves nothing. Not the state, not the due date, not the reminder schedule.
-- A self-service pause is how a tracker quietly stops tracking, and the owner
-- saying they are stuck must not become the owner being let off.
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
create or replace function pg_temp.v265(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids
select 'action', (public.esh_save_finding(null, jsonb_build_object(
  'title', 'v265 guard awaiting parts', 'description', 'The guard needs a part on order.',
  'reported_on', '2026-10-10',
  'accountable_department_id', (select id from public.departments where code = 'OPS'),
  'location', 'BR2', 'required_outcome', 'Refit the guard.', 'priority', 'high',
  'risk_level', 'high',
  'owner_email', 'owner.v265@example.com', 'due_date', '2026-12-10',
  'escalation', '[]'::jsonb,
  'no_further_escalation_reason', 'Fixture needs no route.'
), true)->>'action_id')::uuid;
select pg_temp.reset_role();

insert into ids
select 'owner', id from public.esh_email_principals
 where canonical_email = 'owner.v265@example.com';

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access(pg_temp.v265('owner'), true,
            'v265 fixture')->>'ok')::boolean, 'the contact is enabled for the fixture');
select pg_temp.reset_role();

insert into public.esh_access_grants
  (organization_id, principal_id, purpose, action_id, assignment_version, token_hash,
   issued_reason, expires_at)
select p.organization_id, p.id, 'owner_action', pg_temp.v265('action'), 1,
       focus.esh_secret_hash(pg_temp.secret('action-v265')), 'notification',
       now() + interval '1 day'
  from public.esh_email_principals p where p.id = pg_temp.v265('owner');
select ok((public.esh_guest_exchange(pg_temp.secret('action-v265'), pg_temp.secret('session-v265'),
            null, null, true)->>'ok')::boolean, 'the owner opens their link');

-- What the work looked like before the owner said anything.
create temporary table v265_before as
  select state, due_at from public.esh_finding_actions where id = pg_temp.v265('action');
grant all on v265_before to authenticated;

-- ---------------------------------------------------------------------------
-- Reporting it
-- ---------------------------------------------------------------------------

select is(
  public.esh_guest_report_blocker(pg_temp.secret('session-v265'), pg_temp.v265('action'),
    'invented_category', 'Anything.')->>'code',
  'invalid',
  'the categories are a list, so escalation can act on them');

select is(
  public.esh_guest_report_blocker(pg_temp.secret('session-v265'), pg_temp.v265('action'),
    'materials', 'x')->>'code',
  'help_required',
  'and a blocker that does not say what help is needed is not a blocker');

select ok(
  (public.esh_guest_report_blocker(pg_temp.secret('session-v265'), pg_temp.v265('action'),
     'materials', 'The guard interlock is on back order; purchasing has the quote.',
     'Faizal in Purchasing', current_date + 7)->>'ok')::boolean,
  'the owner says what is stopping them, and who can unstick it');

select is(
  (select category || ' / ' || coalesce(responsible, '-')
     from public.esh_action_blockers
    where action_id = pg_temp.v265('action') and cleared_at is null),
  'materials / Faizal in Purchasing',
  'which is on the record as facts rather than as a sentence in a thread');

-- The whole point.
select is(
  (select state || ' ' || due_at from public.esh_finding_actions
    where id = pg_temp.v265('action')),
  (select state || ' ' || due_at from v265_before),
  'and the work is in exactly the state it was: no pause, no new deadline');

-- ---------------------------------------------------------------------------
-- One open blocker at a time
-- ---------------------------------------------------------------------------

select ok(
  (public.esh_guest_report_blocker(pg_temp.secret('session-v265'), pg_temp.v265('action'),
     'shutdown', 'It now needs a line stop, which is the Tuesday window.')->>'ok')::boolean,
  'a later report replaces the earlier one');

select is(
  (select count(*)::int from public.esh_action_blockers
    where action_id = pg_temp.v265('action') and cleared_at is null),
  1,
  'because two answers to "what is stopping you" is no answer');

select is(
  (select count(*)::int from public.esh_action_blockers
    where action_id = pg_temp.v265('action')),
  2,
  'and the one it replaced is kept, not overwritten');

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(
  public.esh_clear_blocker(
    (select id from public.esh_action_blockers
      where action_id = pg_temp.v265('action') and cleared_at is null),
    'Sorted.')->>'code',
  'not_permitted',
  'somebody without Finding access cannot close an owner''s blocker');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok(
  (public.esh_clear_blocker(
     (select id from public.esh_action_blockers
       where action_id = pg_temp.v265('action') and cleared_at is null),
     'Line stop booked for Tuesday.')->>'ok')::boolean,
  'ESH clears it when the help has been given');

select ok(
  exists(select 1 from public.esh_audit_events
          where event_type = 'blocker_reported'
            and detail->>'action_id' = pg_temp.v265('action')::text
            and actor_kind = 'principal'),
  'and the owner raising it is on the audit trail as the owner, not as staff');

select * from finish();
rollback;
