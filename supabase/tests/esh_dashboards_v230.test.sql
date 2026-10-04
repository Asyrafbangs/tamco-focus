-- ============================================================================
-- ESH Finding Management v230: the two dashboards.
--
-- §33, §43. What only the database can establish: the public dashboard is
-- readable by an anonymous caller and returns nothing that identifies anybody,
-- a restricted finding is not counted in it at all, "on time" is measured
-- against the date first promised rather than the date it was moved to, and
-- opening the public page opens nothing else.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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
create or replace function pg_temp.ops()
returns uuid language sql stable as $$
  select id from public.departments where code = 'OPS'
$$;

create temporary table v230 (name text primary key, id uuid);
grant all on v230 to authenticated;

-- A known baseline: this database carries whatever earlier use left behind.
--
-- Removing this test's own leftovers is not enough. The dashboards count
-- every finding in scope, so anything else the database is carrying -- the
-- end-to-end import spec releases about a hundred -- lands in these totals
-- too. What is recorded below is therefore what the dashboards held before
-- this test created anything, and each assertion states its own
-- contribution (AGENTS.md section 10).
delete from public.esh_findings where title like 'v230 %';

create temporary table v230_before (
  k text primary key, esh_open integer, esh_under_30 integer, public_open integer);
grant all on v230_before to authenticated, anon;
insert into v230_before values ('x', null, null, null);

-- Each figure is read by the role that reads it in the assertions: both
-- functions are RLS-aware, and a baseline taken as postgres would not be
-- the same number.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
update v230_before
   set esh_open = (public.esh_dashboard()->>'open_findings')::integer,
       esh_under_30 = (public.esh_dashboard()->'open_by_age'->>'under_30')::integer
 where k = 'x';
select pg_temp.reset_role();

set local role anon;
update v230_before
   set public_open = (public.esh_public_dashboard()->>'open_findings')::integer
 where k = 'x';
reset role;

-- One ordinary open finding, and one the register marks restricted.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into v230 (name, id)
select 'open',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v230 blocked walkway', 'description', 'Pallets across it.',
          'reported_on', '2026-09-21', 'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 Warehouse', 'required_outcome', 'Clear it.',
          'priority', 'high', 'risk_level', 'high',
          'owner_email', 'dash.owner.v230@example.com', 'due_date', '2026-12-30',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
insert into v230 (name, id)
select 'secret',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v230 restricted matter', 'description', 'Not for everybody.',
          'reported_on', '2026-09-21', 'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 Office', 'required_outcome', 'Handle quietly.',
          'priority', 'high', 'risk_level', 'critical', 'is_restricted', true,
          'owner_email', 'dash.secret.v230@example.com', 'due_date', '2026-12-30',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;

-- ---------------------------------------------------------------------------
-- The ESH dashboard (§33)
-- ---------------------------------------------------------------------------

select ok((public.esh_dashboard()->>'ok')::boolean, 'ESH can read the dashboard');
select is((public.esh_dashboard()->>'open_findings')::integer
            - (select esh_open from v230_before), 2,
          'and it counts both findings, restricted included, in ESH scope');
select is(public.esh_dashboard()->'open_by_risk'->>'critical', '1',
          'the risk mix is broken out');
select is((public.esh_dashboard()->'open_by_age'->>'under_30')::integer
            - (select esh_under_30 from v230_before), 2,
          'and open work is aged from when it was recorded');
select ok(jsonb_array_length(public.esh_dashboard()->'monthly') = 6,
          'six months of opened-against-closed by default');
select ok((public.esh_dashboard()->'by_department') @> '[]'::jsonb,
          'departments are named for ESH');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_dashboard()->>'code', 'not_permitted',
          'somebody without Finding access gets nothing');

-- ---------------------------------------------------------------------------
-- The public dashboard: readable by anyone, identifying nobody
-- ---------------------------------------------------------------------------

select pg_temp.reset_role();
set local role anon;

select ok((public.esh_public_dashboard()->>'ok')::boolean,
          'an anonymous caller can read the public dashboard');
select is((public.esh_public_dashboard()->>'open_findings')::integer
            - (select public_open from v230_before), 1,
          'and a restricted finding is not counted in it');
select is(public.esh_public_dashboard()->'open_by_risk'->>'critical', null,
          'so the restricted one does not even show up as a risk level');

-- The whole safety case: no key anywhere in it can name anybody or anything.
select is((select count(*)::integer
             from jsonb_object_keys(public.esh_public_dashboard()) k
            where k in ('by_department', 'departments', 'findings', 'rows',
                        'titles', 'owners', 'locations', 'references')), 0,
          'it carries no per-finding or per-department key at all');
select is((select count(*)::integer
             from jsonb_each_text(public.esh_public_dashboard()) e
            where e.value ~* '(walkway|warehouse|example\.com|F-[0-9]|restricted matter)'), 0,
          'and no value in it contains a title, a place or an address');

-- Reading the dashboard does not open the module.
select throws_ok('select count(*) from public.esh_dashboard(6)',
                 null, null, 'anon cannot read the scoped dashboard');
-- Stronger than "returns nothing": the table refuses anon outright.
select throws_ok('select count(*) from public.esh_findings',
                 '42501', null, 'and anon cannot read the findings table at all');

reset role;
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- "On time" means the date first promised (§14)
-- ---------------------------------------------------------------------------

/*
 * A finding closed after its baseline, having had its deadline moved out past
 * the closing date, is late. Counting it as on time would let a register look
 * healthy precisely because it kept slipping.
 */
update public.esh_finding_actions
   set baseline_due_at = now() - interval '10 days', due_at = now() + interval '10 days'
 where finding_id = (select id from v230 where name = 'open');
update public.esh_findings
   set status = 'closed', closed_at = now()
 where id = (select id from v230 where name = 'open');

select is(focus.esh_closure_facts(
            (select organization_id from public.esh_rollout_settings limit 1), 6)->>'late', '1',
          'a finding closed after the date first promised is late');
select is(focus.esh_closure_facts(
            (select organization_id from public.esh_rollout_settings limit 1), 6)->>'on_time', '0',
          'even though its due date had been moved past the day it closed');

select * from finish();
rollback;
