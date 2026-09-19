-- ============================================================================
-- ESH Finding Management v197: the rollout gate, staff access and scope.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §31,
-- §43, FM58, FM59, FM101-FM105, FM108. The properties only a real role with
-- real claims can establish: who reads what, who may write, and that the
-- module fails closed.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

create or replace function pg_temp.act_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
end;
$$;

create or replace function pg_temp.reset_role()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.uid(p_who text)
returns uuid
language sql
immutable
as $$
  select case p_who
    when 'admin' then 'f0c05000-0000-4000-a000-000000000001'
    when 'izzul' then 'f0c05000-0000-4000-a000-000000000002'
    when 'amer'  then 'f0c05000-0000-4000-a000-000000000003'
    when 'izzah' then 'f0c05000-0000-4000-a000-000000000004'
    when 'ajmal' then 'f0c05000-0000-4000-a000-000000000005'
    when 'lim'   then 'f0c05000-0000-4000-a000-000000000006'
  end::uuid;
$$;

-- Departments: EHS and Operations from the seed, and a child of EHS.
create or replace function pg_temp.dept(p_code text)
returns uuid
language sql
stable
as $$
  select id from public.departments where code = p_code;
$$;

insert into public.departments (id, code, name, parent_id, status)
values ('f0c19700-0000-4000-a000-0000000000d1', 'EHS-BR2', 'EHS BR2 Warehouse',
        pg_temp.dept('EHS'), 'active');

-- ---------------------------------------------------------------------------
-- 1. The rollout starts Restricted, with one identity in (FM101).
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.esh_rollout_settings),
  1,
  'one rollout row for the organisation');
select is(
  (select mode from public.esh_rollout_settings),
  'restricted',
  'the rollout is Restricted');
select is(
  (select bootstrap_email from public.esh_rollout_settings),
  'izzul.asyraf@tamco.com.my',
  'first setup looks for the identity §43.1 names');
select is(
  (select count(*)::int from public.esh_staff_access where enabled),
  1,
  'exactly one person has Finding access at the start');

-- ---------------------------------------------------------------------------
-- 2. Assigning work (FM03, FM105).
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzul'));

select ok(
  (public.esh_save_finding(null, jsonb_build_object(
    'title', 'v197 guard missing', 'description', 'Guard removed on press 2',
    'reported_on', '2026-09-10', 'accountable_department_id', pg_temp.dept('OPS'),
    'location', 'Workshop', 'required_outcome', 'Refit the guard', 'priority', 'high',
    'owner_email', ' Fadli.Owner@Example.COM ', 'due_date', '2026-09-30',
    'escalation', jsonb_build_array(
      jsonb_build_object('level', 1, 'email', 'supervisor@example.com'),
      jsonb_build_object('level', 1, 'email', 'SUPERVISOR@example.com'))
  ), true)->>'ok')::boolean,
  'a Verifier assigns an Operations finding to an address nobody registered');

select ok(
  (public.esh_save_finding(null, jsonb_build_object(
    'title', 'v197 spill kit empty', 'description', 'Spill kit at BR2 empty',
    'reported_on', '2026-09-10', 'accountable_department_id', 'f0c19700-0000-4000-a000-0000000000d1',
    'required_outcome', 'Restock the kit', 'priority', 'normal',
    'owner_email', 'kit.owner@example.com', 'due_date', '2026-09-30',
    'no_further_escalation_reason', 'Pilot route'
  ), true)->>'ok')::boolean,
  'and a finding in the EHS BR2 sub-department');

select pg_temp.reset_role();

select is(
  (select canonical_email from public.esh_email_principals where display_email = 'Fadli.Owner@Example.COM'),
  'fadli.owner@example.com',
  'the contact keeps the address as typed and matches it case-insensitively');
select is(
  (select access_enabled from public.esh_email_principals where canonical_email = 'fadli.owner@example.com'),
  false,
  'assigning to an address does not enable its access');
select is(
  (select count(*)::int from public.esh_action_escalation_recipients r
     join public.esh_email_principals p on p.id = r.principal_id
    where p.canonical_email = 'supervisor@example.com'),
  1,
  'a repeated address at one level is kept once');
select is(
  (select state from public.esh_notification_outbox o
     join public.esh_email_principals p on p.id = o.recipient_principal_id
    where p.canonical_email = 'fadli.owner@example.com'),
  'held_rollout',
  'the owner email is held, not sent, while access is off');

-- ---------------------------------------------------------------------------
-- 3. Nobody else sees anything (FM103).
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('amer'));
select is((select count(*)::int from public.esh_findings), 0, 'a disabled person reads no findings');
select is((select count(*)::int from public.esh_register_rows), 0, 'nor any register row');
select is((select count(*)::int from public.esh_email_principals), 0, 'nor any contact');
select is(
  public.esh_current_access()->>'enabled',
  'false',
  'and the application is told they have no access');
select is(
  public.esh_save_finding(null, '{"title":"sneaky"}'::jsonb, false)->>'code',
  'not_permitted',
  'a disabled person cannot create a finding');

-- ---------------------------------------------------------------------------
-- 4. Administration is not access (FM59).
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('admin'));
select is((select count(*)::int from public.esh_findings), 0,
  'an administrator reads no findings by being one');
select is(
  public.esh_set_staff_access(pg_temp.uid('izzah'), true, 'viewer', false, '{}', false, false, null)->>'code',
  'scope_required',
  'a new permission names its departments rather than defaulting to everything');
select ok(
  (public.esh_set_staff_access(pg_temp.uid('amer'), true, 'coordinator', false,
     array[pg_temp.dept('EHS')], false, false, 'pilot')->>'ok')::boolean,
  'an administrator enables one person with a role and a scope (FM104)');
select ok(
  (public.esh_set_staff_access(pg_temp.uid('izzah'), true, 'viewer', true, '{}', false, false, null)->>'ok')::boolean,
  'and another as an organisation-wide Viewer');

select pg_temp.act_as(pg_temp.uid('amer'));
select is(
  public.esh_set_staff_access(pg_temp.uid('lim'), true, 'viewer', true, '{}', false, false, null)->>'code',
  'not_permitted',
  'only an administrator changes access');

-- ---------------------------------------------------------------------------
-- 5. Scope and capability (FM58).
-- ---------------------------------------------------------------------------

-- Amer: Coordinator for EHS only, without sub-departments.
select is((select count(*)::int from public.esh_findings where title like 'v197%'), 0,
  'a department scope does not include an Operations finding, nor a sub-department');
select is(
  (public.esh_save_finding(null, jsonb_build_object(
    'title', 'v197 out of scope', 'accountable_department_id', pg_temp.dept('OPS')), false)
   -> 'problems') ? 'department_out_of_scope',
  true,
  'nor can he file one there');

select pg_temp.act_as(pg_temp.uid('admin'));
select ok(
  (public.esh_set_staff_access(pg_temp.uid('amer'), true, 'coordinator', false,
     array[pg_temp.dept('EHS')], true, false, 'include BR2')->>'ok')::boolean,
  'the administrator includes the sub-departments explicitly');
select pg_temp.act_as(pg_temp.uid('amer'));
select is((select count(*)::int from public.esh_findings where title like 'v197%'), 1,
  'and only then does the sub-department''s finding appear');

-- Izzah: organisation-wide Viewer.
select pg_temp.act_as(pg_temp.uid('izzah'));
select is((select count(*)::int from public.esh_findings where title like 'v197%'), 2,
  'an organisation-wide Viewer reads every department');
select is(
  public.esh_save_finding(null, '{"title":"viewer write"}'::jsonb, false)->>'code',
  'not_permitted',
  'but a Viewer changes nothing');

-- ---------------------------------------------------------------------------
-- The database's address check, on the samples tests/unit/esh-findings.test.ts
-- runs through the form's: the two must give the same answers.
-- ---------------------------------------------------------------------------

select is(
  (select array_agg(focus.esh_email_is_valid(sample) order by position)
     from unnest(array[
       'fadli@tamco.example', ' Fadli.Owner@Example.COM ', 'first.last+site@tamco.com.my',
       'a@b.co', 'not an email', 'missing-at.example.com', 'two@@example.com', 'no-domain@',
       'dot@nodot', 'comma,in@example.com', 'space in@example.com', 'trailing@example.com.'
     ]) with ordinality as samples(sample, position)),
  array[true, true, true, true, false, false, false, false, false, false, false, false],
  'the database accepts exactly the addresses the form does');

-- ---------------------------------------------------------------------------
-- 6. Fails closed, and the audit cannot be rewritten (FM108).
-- ---------------------------------------------------------------------------

select pg_temp.reset_role();
select throws_ok(
  $$ update public.esh_audit_events set event_type = 'rewritten' where true $$,
  null,
  null,
  'the Finding audit is append-only');

delete from public.esh_rollout_settings;
select pg_temp.act_as(pg_temp.uid('izzul'));
select is((select count(*)::int from public.esh_findings), 0,
  'without the rollout row, even an enabled Verifier reads nothing');

select pg_temp.reset_role();

select * from finish();

rollback;
