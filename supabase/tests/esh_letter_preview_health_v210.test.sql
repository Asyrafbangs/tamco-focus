-- ============================================================================
-- ESH Finding Management v210: what the letter carries, what a preview shows,
-- what the register says, and whether the scheduler ran at all.
--
-- §24, §27, §33.2, §34.1, §34.2. What only the database can establish: a
-- weekly letter that summarises departments from the same rows the page shows,
-- a preview that reads without capturing or sending anything, a register row
-- that knows how far its work has escalated, and a record of scheduled runs
-- that a later run cannot quietly rewrite.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

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
create temporary table v210_ids (name text primary key, id uuid);
grant all on v210_ids to authenticated;
create or replace function pg_temp.v210(p_name text)
returns uuid language sql stable as $$ select id from v210_ids where name = p_name $$;

-- ---------------------------------------------------------------------------
-- Did the scheduled work run? (§27)
-- ---------------------------------------------------------------------------

select has_table('public', 'esh_worker_runs', 'scheduled runs leave a record');
select ok((select relrowsecurity from pg_class where oid = 'public.esh_worker_runs'::regclass),
          'and that record is read under Finding scope');
select ok(has_function_privilege('service_role',
            'public.esh_record_worker_run(text,boolean,jsonb)', 'EXECUTE'),
          'only the scheduled service records a run');
select ok(not has_function_privilege('authenticated',
            'public.esh_record_worker_run(text,boolean,jsonb)', 'EXECUTE'),
          'a browser cannot claim the scheduler ran');

select ok((public.esh_record_worker_run('cron', true,
            jsonb_build_object('workers', jsonb_build_array('followups')))->>'ok')::boolean,
          'the runner says what it did');

select throws_ok($$
  update public.esh_worker_runs set ok = false where worker = 'cron'
$$, '42501', null, 'a later run cannot rewrite an earlier one');
select throws_ok($$
  delete from public.esh_worker_runs where worker = 'cron'
$$, '42501', null, 'nor delete the evidence that it stopped');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((public.esh_operational_health()->>'ok')::boolean, true,
          'ESH may ask whether the machinery is running');
select is((public.esh_operational_health()->>'hours_since_run')::integer, 0,
          'a run recorded just now reads as an hour ago at most');
select is((public.esh_operational_health()->>'last_run_ok')::boolean, true,
          'and says whether that run succeeded');
select ok(public.esh_operational_health() ? 'scan_backlog',
          'the absent scanner is stated rather than left out');
select is(public.esh_operational_health()->>'scan_backlog', null,
          'and it is null, not zero, because there is nothing to be behind on');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000004');
select is(public.esh_operational_health()->>'code', 'not_permitted',
          'somebody outside Finding Management is told nothing about it');

-- ---------------------------------------------------------------------------
-- A captured week, in two departments (§34.2)
-- ---------------------------------------------------------------------------

select pg_temp.reset_role();
update public.esh_staff_access set can_manage_reports = true
 where user_id = 'f0c05000-0000-4000-a000-000000000002';

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into v210_ids
select 'definition', (public.esh_save_report_definition(
  null, 'v210 leadership weekly', 'draft', 'Asia/Kuala_Lumpur', 1, '08:30',
  true, true, '{}'::uuid[], array['lead.v210@example.com'])->>'id')::uuid;
-- Read while ESH is acting: an administrator without Finding scope cannot see
-- the contact directory, so the id has to be carried rather than looked up.
insert into v210_ids
select 'lead_principal', id from public.esh_email_principals
 where canonical_email = 'lead.v210@example.com';

-- What the report would already carry, before this test adds anything.
--
-- The preview counts every open finding in the definition's scope, so a
-- database carrying anything else open -- the end-to-end import spec
-- releases a backlog -- reports a larger number that says nothing about
-- this fixture (AGENTS.md section 10).
create temporary table v210_before as
  select (public.esh_preview_report(pg_temp.v210('definition'))->>'open_count')::integer
           as open_count;
grant all on v210_before to authenticated;

-- One overdue action in Operations, one open finding in Administration, so the
-- summary has something to rank and something to truncate.
with saved as (
  select public.esh_save_finding(null, jsonb_build_object(
    'title', 'v210 overdue in operations', 'description', 'Letter fixture',
    'reported_on', '2026-09-07',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Put it right', 'priority', 'normal',
    'owner_email', 'owner.v210@example.com', 'due_date', '2026-09-11',
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true, 'v210-ops') value
)
insert into v210_ids select 'ops_finding', (value->>'finding_id')::uuid from saved;
insert into v210_ids
select 'ops_action', id from public.esh_finding_actions
 where finding_id = pg_temp.v210('ops_finding');

with saved as (
  select public.esh_save_finding(null, jsonb_build_object(
    'title', 'v210 open in administration', 'description', 'Letter fixture',
    'reported_on', '2026-09-14',
    'accountable_department_id', (select id from public.departments where code = 'ADMIN'),
    'required_outcome', 'Put it right', 'priority', 'normal',
    'owner_email', 'admin.owner.v210@example.com', 'due_date', '2026-12-20',
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true, 'v210-admin') value
)
insert into v210_ids select 'admin_finding', (value->>'finding_id')::uuid from saved;

-- ---------------------------------------------------------------------------
-- What a report would say, before anybody activates it (§34.1)
-- ---------------------------------------------------------------------------

select is((public.esh_preview_report(pg_temp.v210('definition'))->>'ok')::boolean, true,
          'a draft can be read before it is switched on');
select is((public.esh_preview_report(pg_temp.v210('definition'))->>'state'), 'draft',
          'the preview says it is still a draft');
select is((public.esh_preview_report(pg_temp.v210('definition'))->>'sends_nothing')::boolean, true,
          'and says out loud that it sends nothing');
select is((public.esh_preview_report(pg_temp.v210('definition'))->>'open_count')::integer
            - (select open_count from v210_before), 2,
          'it counts the work the report would actually carry');
select is(jsonb_array_length(public.esh_preview_report(pg_temp.v210('definition'))->'recipients'), 1,
          'with the audience named before anybody is written to');
select is(public.esh_preview_report(pg_temp.v210('definition'))
            ->'recipients'->0->>'access_enabled', 'false',
          'including that this contact is not cleared to receive anything yet');
select is(public.esh_preview_report(gen_random_uuid())->>'code', 'not_found',
          'a report from another organisation cannot be previewed');
select is((select count(*) from public.esh_report_runs
            where report_definition_id = pg_temp.v210('definition')), 0::bigint,
          'and reading it captured nothing');
select is((select count(*) from public.esh_report_outbox), 0::bigint,
          'and sent nothing');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_preview_report(pg_temp.v210('definition'))->>'code', 'not_permitted',
          'somebody without report management cannot preview one either');

-- ---------------------------------------------------------------------------
-- The letter itself (§34.2)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access(
  pg_temp.v210('lead_principal'), true, 'Approved fixture access')->>'ok')::boolean,
  'an administrator clears the leadership contact');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok((public.esh_save_report_definition(
  pg_temp.v210('definition'), 'v210 leadership weekly', 'active', 'Asia/Kuala_Lumpur', 1, '08:30',
  true, true, '{}'::uuid[], array['lead.v210@example.com'])->>'ok')::boolean,
  'activation stays a deliberate second act');

select pg_temp.reset_role();
select is((public.esh_generate_weekly_reports('2026-09-21 01:00:00+00')->>'created')::integer, 1,
          'the Monday cycle captures once');
insert into v210_ids
select 'run', id from public.esh_report_runs
 where report_definition_id = pg_temp.v210('definition');

select is(jsonb_array_length(focus.esh_report_letter(pg_temp.v210('run'), 6)->'departments'), 2,
          'the letter summarises every department it captured');
select is((focus.esh_report_letter(pg_temp.v210('run'), 6)->>'department_total')::integer, 2,
          'and says how many there were in total');
select is(focus.esh_report_letter(pg_temp.v210('run'), 6)->'departments'->0->>'department',
          'Operations',
          'worst first: the department with overdue work leads');
select is(jsonb_array_length(focus.esh_report_letter(pg_temp.v210('run'), 1)->'departments'), 1,
          'a short letter carries fewer departments');
select is((focus.esh_report_letter(pg_temp.v210('run'), 1)->>'department_total')::integer, 2,
          'while still saying how many were left out');
select ok(exists(
            select 1
              from jsonb_array_elements(
                     focus.esh_report_letter(pg_temp.v210('run'), 6)->'overdue') entry
             where entry->>'owner' = 'owner.v210@example.com'),
          'and names who the overdue work is waiting on');

-- ---------------------------------------------------------------------------
-- The register says how far something has escalated (§24)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((select escalation_level from public.esh_register_rows
            where action_id = pg_temp.v210('ops_action')), null::smallint,
          'work nobody has escalated says nothing about escalation');

select pg_temp.reset_role();
insert into public.esh_escalation_entitlements
  (organization_id, action_id, level, principal_id, assignment_version)
select action.organization_id, action.id, 2,
       pg_temp.v210('lead_principal'), action.assignment_version
  from public.esh_finding_actions action
 where action.id = pg_temp.v210('ops_action');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((select escalation_level from public.esh_register_rows
            where action_id = pg_temp.v210('ops_action')), 2::smallint,
          'once it has escalated, the register row says how far');

select pg_temp.reset_role();
update public.esh_escalation_entitlements
   set revoked_at = now(), revoked_reason = 'Fixture stand-down'
 where action_id = pg_temp.v210('ops_action');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((select escalation_level from public.esh_register_rows
            where action_id = pg_temp.v210('ops_action')), null::smallint,
          'and a withdrawn escalation stops being claimed');

select * from finish();
rollback;
