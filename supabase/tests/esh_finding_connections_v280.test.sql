-- v280 — the reviewed connections view reports links somebody decided, from
-- both ends, and only when both ends are visible to the reader.
--
-- Run as a coordinator scoped to two departments. Two matters here for the
-- same reason it mattered in v279 and in Stage 2: a scope rule tested through
-- an organisation-wide actor is not tested at all, because every scope branch
-- in this codebase short-circuits on `focus.esh_scope_all()`.
--
-- `security_invoker` is asserted directly rather than inferred from the rows,
-- because it is the view's entire access control and a `drop view` loses it
-- silently.

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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

create or replace function pg_temp.admin() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.izzul() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.lim() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000006'::uuid $$;
create or replace function pg_temp.ehs() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.ops() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.admin_dept() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.org() returns uuid language sql immutable as
  $$ select 'e5e50000-0000-4000-8000-000000000001'::uuid $$;

-- security_invoker first: without it nothing below means what it appears to.
select ok(
  (select array_to_string(c.reloptions, ',') like '%security_invoker=true%'
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'esh_finding_connections'),
  'the connections view runs under the reader policies, not the owner');

create temporary table v280conn (name text primary key, finding_id uuid, action_id uuid);
grant all on v280conn to authenticated;

select pg_temp.act_as(pg_temp.izzul());
insert into v280conn (name, finding_id, action_id)
select 'press',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v280 fixed guard removed from press line 2',
          'description', 'Guard off again.', 'reported_on', '2026-11-03',
          'accountable_department_id', pg_temp.ops(), 'location', 'BR2 press line 2',
          'required_outcome', 'Refit the guard.', 'priority', 'high', 'risk_level', 'high',
          'owner_email', 'owner.press.v280@example.com', 'due_date', '2026-12-20',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid,
       null;
insert into v280conn (name, finding_id, action_id)
select 'sister',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v280 interlock bypassed on the sister press',
          'description', 'Same design.', 'reported_on', '2026-11-03',
          'accountable_department_id', pg_temp.ehs(), 'location', 'EHS store',
          'required_outcome', 'Audit the design.', 'priority', 'high', 'risk_level', 'high',
          'owner_email', 'owner.sister.v280@example.com', 'due_date', '2026-12-20',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid,
       null;
insert into v280conn (name, finding_id, action_id)
select 'office',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v280 cable across the admin block walkway',
          'description', 'Unrelated.', 'reported_on', '2026-11-03',
          'accountable_department_id', pg_temp.admin_dept(), 'location', 'Admin block',
          'required_outcome', 'Route the cable.', 'priority', 'normal', 'risk_level', 'medium',
          'owner_email', 'owner.office.v280@example.com', 'due_date', '2026-12-20',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid,
       null;
insert into v280conn (name, finding_id, action_id)
select 'outside',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v280 the press guard, reported from the office',
          'description', 'Reported by somebody in Administration.',
          'reported_on', '2026-11-03',
          'accountable_department_id', pg_temp.admin_dept(), 'location', 'Admin block',
          'required_outcome', 'Refit the guard.', 'priority', 'high', 'risk_level', 'high',
          'owner_email', 'owner.outside.v280@example.com', 'due_date', '2026-12-20',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid,
       null;
insert into v280conn (name, finding_id, action_id)
select 'office_kept',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v280 the office cable, recorded first',
          'description', 'In a department the coordinator does not cover.',
          'reported_on', '2026-11-03',
          'accountable_department_id', pg_temp.admin_dept(), 'location', 'Admin block',
          'required_outcome', 'Route the cable.', 'priority', 'normal', 'risk_level', 'medium',
          'owner_email', 'owner.officekept.v280@example.com', 'due_date', '2026-12-20',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid,
       null;
insert into v280conn (name, finding_id, action_id)
select 'inside_dup',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v280 the same cable, recorded by Operations',
          'description', 'Visible to the coordinator; its original is not.',
          'reported_on', '2026-11-03',
          'accountable_department_id', pg_temp.ops(), 'location', 'Admin block',
          'required_outcome', 'Route the cable.', 'priority', 'normal', 'risk_level', 'medium',
          'owner_email', 'owner.insidedup.v280@example.com', 'due_date', '2026-12-20',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid,
       null;
insert into v280conn (name, finding_id, action_id)
select 'store',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v280 eyewash station empty in the EHS store',
          'description', 'Separate issue, same walk.', 'reported_on', '2026-11-03',
          'accountable_department_id', pg_temp.ehs(), 'location', 'EHS store',
          'required_outcome', 'Refill and log it.', 'priority', 'normal', 'risk_level', 'medium',
          'owner_email', 'owner.store.v280@example.com', 'due_date', '2026-12-20',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid,
       null;
select pg_temp.reset_role();

create or replace function pg_temp.fid(p_name text)
returns uuid language sql stable as $$ select finding_id from v280conn where name = p_name $$;

update v280conn c
   set action_id = a.id
  from public.esh_finding_actions a
 where a.finding_id = c.finding_id;

-- A duplicate inside scope, and a duplicate reaching outside it. Both are
-- written with the ordinary outcome procedure.
select pg_temp.act_as(pg_temp.izzul());
select ok(
  (public.esh_resolve_finding(pg_temp.fid('sister'), 'duplicate',
    'Recorded twice from one walk.', pg_temp.fid('press'))->>'ok')::boolean,
  'a duplicate inside the covered departments is recorded');
select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.izzul());
select ok(
  (public.esh_resolve_finding(pg_temp.fid('outside'), 'duplicate',
    'The same guard, reported from Administration.', pg_temp.fid('press'))->>'ok')::boolean,
  'a duplicate reaching outside the covered departments is recorded');
select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.izzul());
select ok(
  (public.esh_resolve_finding(pg_temp.fid('inside_dup'), 'duplicate',
    'Already recorded by Administration.', pg_temp.fid('office_kept'))->>'ok')::boolean,
  'a finding they cover can duplicate one they do not');
select pg_temp.reset_role();

-- An effectiveness failure on the covered press, raising the office finding as
-- its follow-up. Written directly: the view is what is under test, and the row
-- satisfies every constraint the table enforces on a decided failure.
insert into public.esh_effectiveness_checks
  (organization_id, finding_id, action_id, due_on, pass_criteria, state,
   scheduled_by, decided_by, decided_at, decision_note, follow_up_finding_id)
select pg_temp.org(), pg_temp.fid('press'),
       (select action_id from v280conn where name = 'press'),
       '2027-02-01', 'The guard is on the machine and interlocked.', 'failed',
       pg_temp.izzul(), pg_temp.izzul(), now(), 'Guard was off again in February.',
       pg_temp.fid('office');

-- And a related link between two covered findings that are not already a
-- duplicate pair: one pair carrying two relations makes a `select kind`
-- subquery return two rows and proves nothing about either.
insert into public.esh_finding_links
  (organization_id, finding_id, related_finding_id, note, created_by)
values (pg_temp.org(),
        least(pg_temp.fid('press'), pg_temp.fid('store')),
        greatest(pg_temp.fid('press'), pg_temp.fid('store')),
        'Both found on the same walk.', pg_temp.izzul());

-- Lim coordinates EHS and Operations, and not Administration.
select pg_temp.act_as(pg_temp.admin());
select ok(
  (public.esh_set_staff_access(pg_temp.lim(), true, 'verifier', false,
    array[pg_temp.ehs(), pg_temp.ops()], false, false,
    'v280 connections fixture')->>'ok')::boolean,
  'a coordinator can be scoped to two departments');
select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.lim());

select is(
  cardinality(focus.esh_visible_department_ids()),
  2,
  'the scoped coordinator really covers more than one department');

-- The duplicate, from both ends.
select is(
  (select kind from public.esh_finding_connections
    where finding_id = pg_temp.fid('sister') and other_finding_id = pg_temp.fid('press')),
  'duplicate_of',
  'the duplicate says what it repeats');
select is(
  (select kind from public.esh_finding_connections
    where finding_id = pg_temp.fid('press') and other_finding_id = pg_temp.fid('sister')),
  'reported_again_as',
  'and the finding that was kept says what came back, which it never stored');

-- The related link, from both ends of one stored row.
select is(
  (select count(*)::int from public.esh_finding_connections
    where kind = 'related'
      and finding_id in (pg_temp.fid('press'), pg_temp.fid('store'))),
  2,
  'one related row is readable from either end');

-- The effectiveness failure. Its follow-up is the office finding, which Lim
-- cannot see, so neither direction of that pair is visible to them.
select is(
  (select count(*)::int from public.esh_finding_connections
    where kind in ('recurred_as', 'raised_from')),
  0,
  'a recurrence whose far end is outside their scope is absent from both ends');

select is(
  (select count(*)::int from public.esh_finding_connections
    where other_finding_id = pg_temp.fid('outside')),
  0,
  'a duplicate whose far end is outside their scope is absent from both ends');

-- The row survives its own source's policy, because the duplicate itself is
-- in a covered department. Only the both-ends check keeps it out.
select is(
  (select count(*)::int from public.esh_finding_connections
    where finding_id = pg_temp.fid('inside_dup')
       or other_finding_id = pg_temp.fid('office_kept')),
  0,
  'a finding they cover does not name the uncovered finding it duplicates');

select is(
  (select note from public.esh_finding_connections
    where kind = 'related' and finding_id = pg_temp.fid('press')),
  'Both found on the same walk.',
  'the reason travels with the connection');
select ok(
  (select occurred_at is not null from public.esh_finding_connections
    where kind = 'related' and finding_id = pg_temp.fid('press')),
  'and so does when it was decided');

-- Everything Lim can see about the covered press: the duplicate that came
-- back, and the related sister. Not the recurrence, which reaches outside.
select is(
  (select count(*)::int from public.esh_finding_connections
    where finding_id = pg_temp.fid('press')),
  2,
  'the covered finding shows exactly its two visible connections');

select pg_temp.reset_role();

-- The organisation-wide Verifier sees the recurrence the scoped coordinator
-- cannot, which is what makes the previous absence a scope result rather than
-- a missing row.
select pg_temp.act_as(pg_temp.izzul());
select is(
  (select kind from public.esh_finding_connections
    where finding_id = pg_temp.fid('press') and other_finding_id = pg_temp.fid('office')),
  'recurred_as',
  'the recurrence is there for a reader who covers both departments');
select is(
  (select kind from public.esh_finding_connections
    where finding_id = pg_temp.fid('office') and other_finding_id = pg_temp.fid('press')),
  'raised_from',
  'and the finding it raised says which correction did not hold');

select is(
  (select kind from public.esh_finding_connections
    where finding_id = pg_temp.fid('press') and other_finding_id = pg_temp.fid('outside')),
  'reported_again_as',
  'the outside duplicate is there for a reader who covers both departments');

select is(
  (select kind from public.esh_finding_connections
    where finding_id = pg_temp.fid('inside_dup')
      and other_finding_id = pg_temp.fid('office_kept')),
  'duplicate_of',
  'and that pair is there for a reader who covers both departments');

select * from finish();
rollback;
