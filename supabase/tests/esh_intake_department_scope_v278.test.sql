-- v272–v278 — A department-scoped coordinator triages the private reports in
-- the departments they cover, and only those.
--
-- Every assertion below runs as a coordinator who covers **two** departments.
-- Two is the whole point: with a single department a wrong `<> any` reads
-- exactly like a correct `<> all`, which is how six intake procedures shipped
-- with the wrong one behind fifteen passing assertions. The existing v278 test
-- acts as an organisation-wide Verifier, whose `focus.esh_scope_all()` is true,
-- so it short-circuits every scope branch before reaching them.

begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

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

-- Two findings to link duplicates to, one inside Lim's scope and one outside,
-- written through the ordinary finding procedure by the organisation-wide
-- Verifier the seed enables.
create temporary table v278scope (name text primary key, id uuid);
grant all on v278scope to authenticated;

select pg_temp.act_as(pg_temp.izzul());
insert into v278scope (name, id)
select 'finding_ops',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v278scope press guard', 'description', 'Guard missing on the press.',
          'reported_on', '2026-11-02', 'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 press line 2', 'required_outcome', 'Fit a fixed guard.',
          'priority', 'high', 'risk_level', 'high',
          'owner_email', 'owner.ops.v278scope@example.com',
          'due_date', '2026-12-30', 'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
insert into v278scope (name, id)
select 'finding_admin',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v278scope office trip hazard', 'description', 'Cable across a walkway.',
          'reported_on', '2026-11-02', 'accountable_department_id', pg_temp.admin_dept(),
          'location', 'Admin block', 'required_outcome', 'Route the cable.',
          'priority', 'normal', 'risk_level', 'medium',
          'owner_email', 'owner.admin.v278scope@example.com',
          'due_date', '2026-12-30', 'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
select pg_temp.reset_role();

create or replace function pg_temp.fid(p_name text)
returns uuid language sql stable as $$ select id from v278scope where name = p_name $$;

insert into public.esh_report_intake
  (id, organization_id, source, report_text, reported_location, department_id)
values
  ('f2790000-0000-4000-a000-000000000001', 'e5e50000-0000-4000-8000-000000000001',
   'esh_manual', 'The press guard is still missing.', 'BR2 Workshop', pg_temp.ops()),
  ('f2790000-0000-4000-a000-000000000002', 'e5e50000-0000-4000-8000-000000000001',
   'esh_manual', 'An eyewash station is empty.', 'EHS store', pg_temp.ehs()),
  ('f2790000-0000-4000-a000-000000000003', 'e5e50000-0000-4000-8000-000000000001',
   'esh_manual', 'A filing cabinet door is loose.', 'Admin block', pg_temp.admin_dept()),
  ('f2790000-0000-4000-a000-000000000004', 'e5e50000-0000-4000-8000-000000000001',
   'esh_manual', 'A second office report.', 'Admin block', pg_temp.admin_dept()),
  ('f2790000-0000-4000-a000-000000000005', 'e5e50000-0000-4000-8000-000000000001',
   'esh_manual', 'The same press guard, reported again.', 'BR2 Workshop', pg_temp.ops()),
  ('f2790000-0000-4000-a000-000000000006', 'e5e50000-0000-4000-8000-000000000001',
   'esh_manual', 'A third press report.', 'BR2 Workshop', pg_temp.ops());

-- Lim becomes a coordinator for EHS and Operations through the administrator
-- procedure the screen uses, not by writing the access rows by hand.
select pg_temp.act_as(pg_temp.admin());
select ok(
  (public.esh_set_staff_access(pg_temp.lim(), true, 'verifier', false,
    array[pg_temp.ehs(), pg_temp.ops()], false, false,
    'v278 department-scope fixture')->>'ok')::boolean,
  'a coordinator can be scoped to two departments');
select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.lim());

-- If this ever returns 1, every assertion below stops proving anything: the
-- defect this file exists for is invisible at one department.
select is(
  cardinality(focus.esh_visible_department_ids()),
  2,
  'the scoped coordinator really covers more than one department');

select is(
  public.esh_claim_report_intake('f2790000-0000-4000-a000-000000000001')->>'status',
  'triaging',
  'claims a report in a department they cover');
select is(
  public.esh_claim_report_intake('f2790000-0000-4000-a000-000000000003')->>'code',
  'not_found',
  'cannot claim a report in a department they do not cover');

select is(
  public.esh_decline_report_intake('f2790000-0000-4000-a000-000000000002',
    'The station was refilled before the report was read.')->>'status',
  'declined',
  'declines a report in a department they cover');
select is(
  public.esh_decline_report_intake('f2790000-0000-4000-a000-000000000003',
    'Not mine to decline.')->>'code',
  'not_found',
  'cannot decline a report in a department they do not cover');

select is(
  public.esh_mark_report_intake_duplicate('f2790000-0000-4000-a000-000000000005',
    pg_temp.fid('finding_ops'), 'It describes the same missing guard.')->>'status',
  'duplicate',
  'links a covered report to a covered Finding');
select is(
  public.esh_mark_report_intake_duplicate('f2790000-0000-4000-a000-000000000006',
    pg_temp.fid('finding_admin'), 'Pointing outside my scope.')->>'code',
  'finding_not_found',
  'cannot link a report to a Finding in a department they do not cover');

select is(
  public.esh_create_manual_report_intake('A verbal report about the press line.',
    'BR2 Workshop', pg_temp.ops())->>'status',
  'new',
  'records a verbal report against a department they cover');
select is(
  public.esh_create_manual_report_intake('A verbal report about the office.',
    'Admin block', pg_temp.admin_dept())->>'code',
  'department_not_found',
  'cannot record a verbal report against a department they do not cover');

select ok(
  (public.esh_accept_report_intake(
    'f2790000-0000-4000-a000-000000000001',
    jsonb_build_object(
      'title', 'v278scope guard still missing',
      'reported_on', '2026-11-02',
      'required_outcome', 'Fit the guard before the next shift.',
      'priority', 'high',
      'owner_email', 'owner.accept.v278scope@example.com',
      'due_date', '2026-11-20',
      'no_further_escalation_reason', 'Fixture route is documented.'),
    true,
    'v278scope-accept')->>'ok')::boolean,
  'accepts the report they claimed in a department they cover');
select pg_temp.reset_role();

-- The scope gate, not the claim gate: this report is already triaging and
-- already assigned to Lim, so only the department check can refuse it.
update public.esh_report_intake
   set status = 'triaging', assigned_triager_id = pg_temp.lim(), triaged_at = now()
 where id = 'f2790000-0000-4000-a000-000000000004';
select pg_temp.act_as(pg_temp.lim());
select is(
  public.esh_accept_report_intake(
    'f2790000-0000-4000-a000-000000000004',
    jsonb_build_object(
      'title', 'v278scope out of scope',
      'reported_on', '2026-11-02',
      'required_outcome', 'Never created.',
      'priority', 'normal',
      'no_further_escalation_reason', 'Fixture.'),
    false,
    'v278scope-reject')->>'code',
  'not_found',
  'cannot accept a claimed report in a department they do not cover');
select pg_temp.reset_role();

select * from finish();
rollback;
