-- ============================================================================
-- ESH Finding Management v289: somewhere for a sticker to point.
--
-- v272 created the table, v288 built the submission path, and neither gave
-- anybody a way to create a location. This is the test that would have caught
-- that: it creates one, reads it back, resolves it the way the public page
-- does, and retires it.
--
-- What only the database can establish: who may create one and where, that
-- the code is generated rather than taken from the label, that retiring stops
-- the code resolving while keeping the row, and that a coordinator cannot
-- reach a location outside the departments they cover.
-- ============================================================================

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

-- Lim coordinates EHS and Operations; Rafiq sees the same two as a viewer.
-- Two departments, because at one a wrong `<> any` reads like a correct
-- `<> all`.
select pg_temp.act_as(pg_temp.admin());
select ok(
  (public.esh_set_staff_access(pg_temp.lim(), true, 'verifier', false,
    array[pg_temp.ehs(), pg_temp.ops()], false, false,
    'v289 location fixture')->>'ok')::boolean,
  'a coordinator is scoped to two departments');
select ok(
  (public.esh_set_staff_access(pg_temp.rafiq(), true, 'viewer', false,
    array[pg_temp.ehs(), pg_temp.ops()], false, false,
    'v289 viewer fixture')->>'ok')::boolean,
  'and a viewer to the same two');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- Creating one
-- ---------------------------------------------------------------------------

create temporary table v289 (name text primary key, value text);
grant all on v289 to authenticated;

select pg_temp.act_as(pg_temp.lim());

insert into v289 (name, value)
select 'code',
       public.esh_add_qr_location('BR2 Press line 2', pg_temp.ops())->>'code';
select matches(
  (select value from v289 where name = 'code'),
  '^[A-Za-z0-9_-]{16}$',
  'a location is created and its code is sixteen generated characters');

/*
 * The code must not be derivable from the label. Somebody who has walked
 * through the building knows the area's name; if the code came from it, they
 * could post to that sticker without ever seeing it.
 */
select ok(
  (select value !~* 'press|line|br2' from v289 where name = 'code'),
  'and nothing in the code comes from the label');

select is(
  (select display_label || ' ' || active::text from public.esh_qr_locations
    where public_code = (select value from v289 where name = 'code')),
  'BR2 Press line 2 true',
  'the label is stored and the location is active');
select is(
  (select d.code from public.esh_qr_locations l
     join public.departments d on d.id = l.department_id
    where l.public_code = (select value from v289 where name = 'code')),
  'OPS',
  'in the department it was given');

select is(
  public.esh_add_qr_location('BR1 Admin corridor', pg_temp.admin_dept())->>'code',
  'department_not_yours',
  'a department the coordinator does not cover is refused');
select is(
  public.esh_add_qr_location('  ', pg_temp.ops())->>'code',
  'label_required',
  'and a sticker with nothing written on it is refused');
/*
 * A department that does not exist comes back as `department_not_yours`, not
 * `department_not_found`: the scope check runs first, so the procedure never
 * tells a coordinator whether a department they cannot see is real. That is
 * the better order, and this asserts it rather than the other way round.
 */
select is(
  public.esh_add_qr_location('Nowhere', '00000000-0000-4000-8000-000000000000')->>'code',
  'department_not_yours',
  'a department that does not exist is refused without saying which it is');

-- A location with no department is allowed: it lands in the organisation-wide
-- queue, which is where an unrouted report belongs.
select ok(
  (public.esh_add_qr_location('BR1 Main gate', null)->>'ok')::boolean,
  'a location with no department is allowed');
select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.rafiq());
select is(
  public.esh_add_qr_location('BR2 Press line 3', pg_temp.ops())->>'code',
  'not_permitted',
  'a viewer who can see the area cannot put a sticker in it');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- What the public page sees
-- ---------------------------------------------------------------------------

select is(
  public.esh_qr_location_for((select value from v289 where name = 'code'))->>'code',
  'not_enabled',
  'the code resolves to nothing while public reporting is closed');

select pg_temp.act_as(pg_temp.admin());
select public.esh_set_qr_intake(true, 'v289 fixture: opening to resolve a code.');
select pg_temp.reset_role();

select is(
  public.esh_qr_location_for((select value from v289 where name = 'code'))->>'label',
  'BR2 Press line 2',
  'and to its label once reporting is open');

-- ---------------------------------------------------------------------------
-- Retiring one
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.lim());
select ok(
  (public.esh_retire_qr_location(
     (select id from public.esh_qr_locations
       where public_code = (select value from v289 where name = 'code')))->>'ok')::boolean,
  'a coordinator retires a sticker that is no longer on the wall');
select pg_temp.reset_role();

select is(
  public.esh_qr_location_for((select value from v289 where name = 'code'))->>'code',
  'unknown_location',
  'the retired code stops resolving');

-- The row stays, so a report already submitted against it still names where
-- it came from, and the code can never be issued again.
select is(
  (select active::text || ' ' || (retired_at is not null)::text
     from public.esh_qr_locations
    where public_code = (select value from v289 where name = 'code')),
  'false true',
  'and the row is kept, retired rather than deleted');

select pg_temp.act_as(pg_temp.rafiq());
select is(
  public.esh_retire_qr_location(
    (select id from public.esh_qr_locations
      where public_code = (select value from v289 where name = 'code')))->>'code',
  'not_permitted',
  'a viewer cannot retire one either');
select pg_temp.reset_role();

select is(
  (select count(*)::integer from public.esh_audit_events
    where event_type in ('qr_location_added', 'qr_location_retired')),
  3,
  'every creation and retirement is in the audit trail');

select ok(
  not has_function_privilege('anon', 'public.esh_add_qr_location(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.esh_retire_qr_location(uuid)', 'execute'),
  'and none of it is reachable by somebody who is not signed in');

select * from finish();
rollback;
