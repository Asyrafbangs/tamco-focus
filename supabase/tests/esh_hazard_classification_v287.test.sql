-- v287 — ESH classifies the hazard, within the scope it covers.
--
-- The classification itself is one column, so what needs establishing is
-- everything around it: who may set it, on which findings, what the database
-- refuses outright, that clearing it is possible and honest, that the register
-- carries it without losing its row-level security, and that the distribution
-- counts what the reader can see and nothing else.
--
-- Every assertion runs as a coordinator scoped to **two** departments. Two is
-- the point and not a detail: at one department `<> any` reads exactly like
-- `<> all`, which is how six Stage 2 procedures shipped refusing the
-- departments they were scoped to behind fifteen passing assertions.

begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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
create or replace function pg_temp.rafiq() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.ehs() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.ops() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.admin_dept() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000003'::uuid $$;

-- ---------------------------------------------------------------------------
-- The list itself
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::integer from public.esh_hazard_categories where active),
  9,
  'nine categories, which is the approved list and not one more');
select is(
  (select code from public.esh_hazard_categories order by sort_order desc limit 1),
  'other',
  '"Something else" sorts last, so it is the answer of last resort on screen');

-- ---------------------------------------------------------------------------
-- Two findings the coordinator covers, one they do not
-- ---------------------------------------------------------------------------

create temporary table v287 (name text primary key, id uuid);
grant all on v287 to authenticated;

select pg_temp.act_as(pg_temp.izzul());
insert into v287 (name, id)
select 'ops',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v287 bench grinder guard removed',
          'description', 'The wheel guard is off and the machine is in use.',
          'reported_on', '2026-11-03', 'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 Workshop', 'required_outcome', 'Refit the guard.',
          'priority', 'high', 'risk_level', 'high',
          'owner_email', 'owner.ops.v287@example.com',
          'due_date', '2026-12-30', 'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
insert into v287 (name, id)
select 'admin',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v287 extension lead across the admin walkway',
          'description', 'Trailing lead, nothing to do with the workshop.',
          'reported_on', '2026-11-03', 'accountable_department_id', pg_temp.admin_dept(),
          'location', 'Admin block', 'required_outcome', 'Route the lead.',
          'priority', 'normal', 'risk_level', 'medium',
          'owner_email', 'owner.admin.v287@example.com',
          'due_date', '2026-12-30', 'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
select pg_temp.reset_role();

create or replace function pg_temp.fid(p_name text)
returns uuid language sql stable as $$ select id from v287 where name = p_name $$;

select pg_temp.act_as(pg_temp.admin());
select ok(
  (public.esh_set_staff_access(pg_temp.lim(), true, 'verifier', false,
    array[pg_temp.ehs(), pg_temp.ops()], false, false,
    'v287 classification fixture')->>'ok')::boolean,
  'a coordinator can be scoped to two departments');
select ok(
  (public.esh_set_staff_access(pg_temp.rafiq(), true, 'viewer', false,
    array[pg_temp.ehs(), pg_temp.ops()], false, false,
    'v287 viewer fixture')->>'ok')::boolean,
  'and a viewer to the same two');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- Setting it
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.lim());

select ok(
  (public.esh_set_finding_hazard(pg_temp.fid('ops'), 'machinery')::jsonb->>'ok')::boolean,
  'a coordinator classifies a finding in a department they cover');
select pg_temp.reset_role();
select is(
  (select hazard_category from public.esh_findings where id = pg_temp.fid('ops')),
  'machinery',
  'and the classification is what they chose');
select isnt(
  (select hazard_set_at from public.esh_findings where id = pg_temp.fid('ops')),
  null,
  'with when it was decided, because a classification is a review act');
select is(
  (select count(*)::integer from public.esh_audit_events
    where finding_id = pg_temp.fid('ops') and event_type = 'hazard_classified'),
  1,
  'and it is in the audit trail, with who');

-- The optional second category, which is the only shape a list would allow.
select pg_temp.act_as(pg_temp.lim());
select ok(
  (public.esh_set_finding_hazard(pg_temp.fid('ops'), 'machinery', 'electrical')
    ::jsonb->>'ok')::boolean,
  'a secondary category is allowed when ESH genuinely needs one');
select pg_temp.reset_role();
select is(
  (select hazard_secondary from public.esh_findings where id = pg_temp.fid('ops')),
  'electrical',
  'and is stored beside the primary rather than replacing it');

-- ---------------------------------------------------------------------------
-- What it refuses
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.lim());
select is(
  public.esh_set_finding_hazard(pg_temp.fid('admin'), 'slips_falls')::jsonb->>'code',
  'not_found',
  'a finding outside the two departments they cover is not theirs to classify');
select is(
  public.esh_set_finding_hazard(pg_temp.fid('ops'), 'not_a_category')::jsonb->>'code',
  'unknown_category',
  'a category that does not exist is refused rather than stored as text');
select is(
  public.esh_set_finding_hazard(pg_temp.fid('ops'), 'machinery', 'machinery')
    ::jsonb->>'code',
  'same_category_twice',
  'the same category twice is a mistake, not a classification');
select is(
  public.esh_set_finding_hazard(pg_temp.fid('ops'), null, 'electrical')::jsonb->>'code',
  'secondary_without_primary',
  'a secondary with no primary is not a classification either');
select pg_temp.reset_role();

-- Nothing the refusals touched: the finding still carries what it did.
select is(
  (select hazard_category || '/' || hazard_secondary from public.esh_findings
    where id = pg_temp.fid('ops')),
  'machinery/electrical',
  'and none of those refusals changed what was already recorded');

select pg_temp.act_as(pg_temp.rafiq());
select is(
  public.esh_set_finding_hazard(pg_temp.fid('ops'), 'fire')::jsonb->>'code',
  'not_permitted',
  'a viewer who can see the finding still cannot classify it');
select pg_temp.reset_role();

-- The table refuses the same shape the procedure does, so nothing that gets
-- past one is caught by the other at the last moment.
select throws_ok(
  $$update public.esh_findings
       set hazard_category = null, hazard_secondary = 'fire'
     where id = (select id from v287 where name = 'ops')$$,
  '23514', null,
  'the table refuses a secondary without a primary directly');

-- ---------------------------------------------------------------------------
-- Clearing it
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.lim());
select ok(
  (public.esh_set_finding_hazard(pg_temp.fid('ops'), null)::jsonb->>'ok')::boolean,
  'a classification ESH no longer stands behind can be removed');
select pg_temp.reset_role();
select is(
  (select coalesce(hazard_category, 'none') || ' ' || coalesce(hazard_set_at::text, 'never')
     from public.esh_findings where id = pg_temp.fid('ops')),
  'none never',
  'and the finding returns to uncategorised, with no stale decision date');

-- ---------------------------------------------------------------------------
-- The register and the distribution
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.lim());
select public.esh_set_finding_hazard(pg_temp.fid('ops'), 'machinery');

select is(
  (select hazard_label from public.esh_register_rows
    where finding_id = pg_temp.fid('ops') limit 1),
  'Machinery and equipment',
  'the register carries the label, so a row can show it without a second read');

select is(
  (select findings::integer from public.esh_hazard_distribution where code = 'machinery'),
  1,
  'the distribution counts it under its own category');
select is(
  (select findings::integer from public.esh_hazard_distribution where code = 'fire'),
  0,
  'and an empty category reads as zero rather than being absent');
select pg_temp.reset_role();

select * from finish();
rollback;
