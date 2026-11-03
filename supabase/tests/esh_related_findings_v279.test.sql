-- v279 — a coordinator relates two findings they cover, the pair is stored
-- once whichever end it came from, and a link is only readable when both of
-- its ends are.
--
-- Every assertion runs as a coordinator scoped to **two** departments. Two is
-- the whole point, and not a detail of this fixture: at one department a wrong
-- `<> any` reads exactly like a correct `<> all`, which is how six Stage 2
-- procedures shipped with the wrong operator behind fifteen passing
-- assertions. The link itself is cross-department here — Operations to EHS —
-- so the scope check is exercised rather than stepped over.

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
create or replace function pg_temp.rafiq() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000008'::uuid $$;
create or replace function pg_temp.ehs() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.ops() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.admin_dept() returns uuid language sql immutable as
  $$ select 'f0c05100-0000-4000-a000-000000000003'::uuid $$;
create or replace function pg_temp.org() returns uuid language sql immutable as
  $$ select 'e5e50000-0000-4000-8000-000000000001'::uuid $$;

-- Three findings written through the ordinary finding procedure by the
-- organisation-wide Verifier the seed enables: two in the departments the
-- scoped coordinator covers, one outside them.
create temporary table v279links (name text primary key, id uuid);
grant all on v279links to authenticated;

select pg_temp.act_as(pg_temp.izzul());
insert into v279links (name, id)
select 'ops',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v279 press guard missing on line 2', 'description', 'Fixed guard removed.',
          'reported_on', '2026-11-03', 'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 press line 2', 'required_outcome', 'Refit the fixed guard.',
          'priority', 'high', 'risk_level', 'high',
          'owner_email', 'owner.ops.v279@example.com',
          'due_date', '2026-12-30', 'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
insert into v279links (name, id)
select 'ehs',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v279 guard interlock bypassed on the sister press',
          'description', 'Same guard design, different machine.',
          'reported_on', '2026-11-03', 'accountable_department_id', pg_temp.ehs(),
          'location', 'EHS store', 'required_outcome', 'Audit every press of this design.',
          'priority', 'high', 'risk_level', 'high',
          'owner_email', 'owner.ehs.v279@example.com',
          'due_date', '2026-12-30', 'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
insert into v279links (name, id)
select 'admin',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v279 cable across the admin block walkway',
          'description', 'Nothing to do with presses.',
          'reported_on', '2026-11-03', 'accountable_department_id', pg_temp.admin_dept(),
          'location', 'Admin block', 'required_outcome', 'Route the cable.',
          'priority', 'normal', 'risk_level', 'medium',
          'owner_email', 'owner.admin.v279@example.com',
          'due_date', '2026-12-30', 'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
select pg_temp.reset_role();

create or replace function pg_temp.fid(p_name text)
returns uuid language sql stable as $$ select id from v279links where name = p_name $$;

-- Lim coordinates EHS and Operations; Rafiq can see exactly the same two
-- departments but only as a viewer. Both are granted through the
-- administrator procedure the screen uses, not by writing access rows by hand.
select pg_temp.act_as(pg_temp.admin());
select ok(
  (public.esh_set_staff_access(pg_temp.lim(), true, 'verifier', false,
    array[pg_temp.ehs(), pg_temp.ops()], false, false,
    'v279 related-findings fixture')->>'ok')::boolean,
  'a coordinator can be scoped to two departments');
select ok(
  (public.esh_set_staff_access(pg_temp.rafiq(), true, 'viewer', false,
    array[pg_temp.ehs(), pg_temp.ops()], false, false,
    'v279 viewer fixture')->>'ok')::boolean,
  'a viewer can be scoped to the same two departments');
select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.lim());

-- If this ever returns 1, nothing below proves anything: the operator defect
-- these scope checks guard against is invisible at one department.
select is(
  cardinality(focus.esh_visible_department_ids()),
  2,
  'the scoped coordinator really covers more than one department');

select is(
  (public.esh_link_related_findings(pg_temp.fid('ops'), pg_temp.fid('ehs'),
    'Same guard design on the sister press.')->>'ok')::boolean,
  true,
  'relates two findings in different departments they cover');

-- Counted directly rather than read back through the procedure that wrote it.
select pg_temp.reset_role();
select is(
  (select count(*)::int from public.esh_finding_links
    where finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'))
       or related_finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'))),
  1,
  'the pair is stored as exactly one row');
select is(
  (select finding_id < related_finding_id from public.esh_finding_links
    where finding_id = least(pg_temp.fid('ops'), pg_temp.fid('ehs'))),
  true,
  'the row is stored in identifier order, not in the order it was asked for');

-- The same pair from the other end. Symmetric means one row, not two.
select pg_temp.act_as(pg_temp.lim());
select ok(
  (public.esh_link_related_findings(pg_temp.fid('ehs'), pg_temp.fid('ops'),
    'Both presses are the same model.')->>'ok')::boolean,
  'the same pair can be related from the other end');
select pg_temp.reset_role();
select is(
  (select count(*)::int from public.esh_finding_links
    where finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'))
       or related_finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'))),
  1,
  'relating it from the other end does not store a second row');
select is(
  (select note from public.esh_finding_links
    where finding_id = least(pg_temp.fid('ops'), pg_temp.fid('ehs'))),
  'Both presses are the same model.',
  'the second attempt replaces the reason rather than failing');

select pg_temp.act_as(pg_temp.lim());
select is(
  public.esh_link_related_findings(pg_temp.fid('ops'), pg_temp.fid('admin'),
    'Not mine to relate.')->>'code',
  'related_not_found',
  'cannot relate a finding in a department they do not cover');
select is(
  public.esh_link_related_findings(pg_temp.fid('ops'), pg_temp.fid('ops'),
    'Itself.')->>'code',
  'same_finding',
  'cannot relate a finding to itself');

-- Seeing both findings is not permission to connect them.
select pg_temp.act_as(pg_temp.rafiq());
select is(
  public.esh_link_related_findings(pg_temp.fid('ops'), pg_temp.fid('ehs'),
    'A viewer tries.')->>'code',
  'not_permitted',
  'a viewer who can see both findings still cannot relate them');

-- A link whose far end is out of scope: written past the procedure, so the
-- policy is what is under test rather than the procedure's refusal.
select pg_temp.reset_role();
insert into public.esh_finding_links
  (organization_id, finding_id, related_finding_id, note, created_by)
values (pg_temp.org(),
        least(pg_temp.fid('ops'), pg_temp.fid('admin')),
        greatest(pg_temp.fid('ops'), pg_temp.fid('admin')),
        'Planted across a scope boundary.', pg_temp.izzul());

select pg_temp.act_as(pg_temp.lim());
select is(
  (select count(*)::int from public.esh_finding_links
    where finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'), pg_temp.fid('admin'))
       or related_finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'), pg_temp.fid('admin'))),
  1,
  'a link is unreadable unless both of its ends are, so only the covered pair is visible');

-- The ordering constraint, not the procedure that respects it. Run as the
-- owner because `authenticated` holds no insert grant at all, which would
-- raise 42501 instead and prove nothing about the constraint.
select pg_temp.reset_role();
select throws_ok(
  format('insert into public.esh_finding_links
            (organization_id, finding_id, related_finding_id, created_by)
          values (%L, %L, %L, %L)',
    pg_temp.org(),
    greatest(pg_temp.fid('ops'), pg_temp.fid('ehs')),
    least(pg_temp.fid('ops'), pg_temp.fid('ehs')),
    pg_temp.izzul()),
  '23514',
  null,
  'the ordering constraint refuses a pair stored the wrong way round');

select pg_temp.act_as(pg_temp.lim());
-- The planted cross-scope row is reachable by identifier but not theirs to
-- remove. Without this, nothing exercises the unlink scope check at all.
select is(
  public.esh_unlink_related_findings(pg_temp.fid('ops'), pg_temp.fid('admin'))->>'code',
  'not_found',
  'cannot remove a link whose far end is in a department they do not cover');
select pg_temp.reset_role();
select is(
  (select count(*)::int from public.esh_finding_links
    where finding_id = least(pg_temp.fid('ops'), pg_temp.fid('admin'))
      and related_finding_id = greatest(pg_temp.fid('ops'), pg_temp.fid('admin'))),
  1,
  'the refused removal left the row where it was');

select pg_temp.act_as(pg_temp.lim());
select ok(
  (public.esh_unlink_related_findings(pg_temp.fid('ehs'), pg_temp.fid('ops'))->>'ok')::boolean,
  'the link can be removed from either end');
select pg_temp.reset_role();
select is(
  (select count(*)::int from public.esh_finding_links
    where finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'))
      and related_finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'))),
  0,
  'removing it deletes the row rather than leaving it unreadable');

select is(
  (select count(*)::int from public.esh_audit_events
    where event_type = 'finding_related_linked'
      and finding_id in (pg_temp.fid('ops'), pg_temp.fid('ehs'))),
  2,
  'both relating decisions are on the audit trail');

select * from finish();
rollback;
