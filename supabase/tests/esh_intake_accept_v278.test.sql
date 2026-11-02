-- v278 — Private intake becomes a Finding only after its coordinator claims it,
-- through the established finding/assignment transaction.

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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

-- The seeded bootstrap user is a viewer. This test gives the real account the
-- existing verifier capability; it never bypasses the procedure's checks.
update public.esh_staff_access
   set preset = 'verifier'
 where user_id = 'f0c05000-0000-4000-a000-000000000002';

insert into public.esh_report_intake
  (id, organization_id, source, report_text, reported_location, department_id)
values
  ('f2780000-0000-4000-a000-000000000001', 'e5e50000-0000-4000-8000-000000000001',
   'esh_manual', 'A guard is missing from press 2.', 'BR2 Workshop',
   (select id from public.departments where code = 'OPS')),
  ('f2780000-0000-4000-a000-000000000002', 'e5e50000-0000-4000-8000-000000000001',
   'esh_manual', 'A second report has not been claimed.', null,
   (select id from public.departments where code = 'OPS'));

select ok(
  not has_function_privilege(
    'anon',
    'public.esh_accept_report_intake(uuid, jsonb, boolean, text)',
    'EXECUTE'
  ),
  'anonymous callers cannot accept private intake'
);

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

select is(
  public.esh_claim_report_intake('f2780000-0000-4000-a000-000000000001')->>'status',
  'triaging',
  'a coordinator claims the report before acceptance'
);

select is(
  public.esh_accept_report_intake(
    'f2780000-0000-4000-a000-000000000002',
    jsonb_build_object('title', 'v278 unclaimed guard'),
    false,
    'v278-unclaimed'
  )->>'code',
  'not_claimed',
  'an unclaimed report cannot create a draft Finding'
);

create temporary table v278_result (result jsonb);
grant all on v278_result to authenticated;
insert into v278_result
select public.esh_accept_report_intake(
  'f2780000-0000-4000-a000-000000000001',
  jsonb_build_object(
    'title', 'v278 guard missing from press 2',
    'reported_on', '2026-11-02',
    'required_outcome', 'Restore the guard before use.',
    'priority', 'high',
    'owner_email', 'owner.v278@example.com',
    'due_date', '2026-11-10',
    'no_further_escalation_reason', 'Fixture route is documented.'
  ),
  true,
  'v278-accept'
);

select ok((select (result->>'ok')::boolean from v278_result),
  'acceptance creates the reviewed Finding');
select is((select result->>'status' from v278_result), 'open',
  'the ordinary finding procedure applies the requested assignment');
select is(
  public.esh_accept_report_intake(
    'f2780000-0000-4000-a000-000000000001',
    jsonb_build_object('title', 'ignored retry'),
    true,
    'v278-accept'
  )->>'finding_id',
  (select result->>'finding_id' from v278_result),
  'a retry replays the accepted Finding instead of creating another'
);

select pg_temp.reset_role();

select is(
  (select status from public.esh_report_intake where id = 'f2780000-0000-4000-a000-000000000001'),
  'accepted',
  'the intake reaches its accepted terminal state'
);
select is(
  (select accepted_finding_id::text from public.esh_report_intake
    where id = 'f2780000-0000-4000-a000-000000000001'),
  (select result->>'finding_id' from v278_result),
  'the intake stores its one accepted Finding link'
);
select is(
  (select source_reference from public.esh_findings
    where id = (select (result->>'finding_id')::uuid from v278_result)),
  'private-intake:f2780000-0000-4000-a000-000000000001',
  'the created Finding retains private-intake provenance'
);
select is(
  (select state from public.esh_finding_actions
    where id = (select (result->>'action_id')::uuid from v278_result)),
  'assigned',
  'acceptance uses the existing owner-assignment state machine'
);
select is(
  (select count(*)::int from public.esh_findings
    where source_reference = 'private-intake:f2780000-0000-4000-a000-000000000001'),
  1,
  'the report produces exactly one Finding despite the retry'
);

select * from finish();
rollback;
