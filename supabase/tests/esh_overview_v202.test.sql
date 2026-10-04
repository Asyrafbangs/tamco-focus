-- ESH Finding Management v202: overview/register/export definitions.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

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
create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;
create or replace function pg_temp.id(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

-- What the overview already held before this test created anything.
--
-- esh_overview aggregates every finding in scope, so these totals are not
-- this test's to own: a database that has run the end-to-end import spec
-- carries its released backlog as well, and each total below moved by two
-- for reasons that have nothing to do with the overview. Each assertion now
-- states what its own fixtures contributed (AGENTS.md section 10).
--
-- Taken under the role the assertions use, because the function is
-- RLS-aware and a baseline read as postgres would not be the same number.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
create temporary table before_test as
select 'wide'::text as window_key,
       coalesce((select sum(open_findings) from public.esh_overview(
         null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')), 0)::numeric as open_findings,
       coalesce((select sum(overdue_actions) from public.esh_overview(
         null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')), 0)::numeric as overdue_actions
union all select 'ops',
       coalesce((select open_findings from public.esh_overview(
         (select id from public.departments where code = 'OPS'), '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')), 0)::numeric, 0::numeric
union all select 'old_closure',
       coalesce((select sum(open_findings) from public.esh_overview(
         null, '2020-01-01T00:00:00Z', '2020-01-31T23:59:59Z', '2026-09-20T01:00:00Z')), 0)::numeric, 0::numeric
union all select 'after_reopen',
       coalesce((select sum(open_findings) from public.esh_overview(
         null, '2026-08-22T00:00:00Z', null, '2026-09-20T03:00:00Z')), 0)::numeric, 0::numeric
union all select 'after_reclose',
       coalesce((select sum(open_findings) from public.esh_overview(
         null, '2026-09-20T03:30:00Z', null, '2026-09-20T05:00:00Z')), 0)::numeric, 0::numeric;
select pg_temp.reset_role();
grant all on before_test to authenticated;
create or replace function pg_temp.was_open(p_key text)
returns numeric language sql stable as $$
  select open_findings from before_test where window_key = p_key $$;
create or replace function pg_temp.was_overdue(p_key text)
returns numeric language sql stable as $$
  select overdue_actions from before_test where window_key = p_key $$;

-- One finding with two overdue actions: it is one open finding, two overdue actions.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
with saved as (
  select public.esh_save_finding(null, jsonb_build_object(
    'title', 'v202 multi action', 'description', '=unsafe spreadsheet text',
    'reported_on', '2026-09-10',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Correct both conditions', 'priority', 'high',
    'owner_email', 'owner.v202@example.com', 'due_date', '2026-09-18',
    'escalation', jsonb_build_array(jsonb_build_object(
      'level', 1, 'email', 'supervisor.v202@example.com'))
  ), true, 'v202-multi') value
)
insert into ids
select 'multi_finding', (value->>'finding_id')::uuid from saved
union all
select 'multi_action', (value->>'action_id')::uuid from saved;

select pg_temp.reset_role();

with basis as (
  select f.organization_id, f.accountable_department_id, f.created_by,
         a.owner_principal_id
    from public.esh_findings f
    join public.esh_finding_actions a on a.id = pg_temp.id('multi_action')
   where f.id = pg_temp.id('multi_finding')
), finding as (
  insert into public.esh_findings (
    organization_id, reference, title, description, source, reported_on,
    accountable_department_id, status, created_by
  )
  select organization_id, 'REVIEW-V202', 'v202 review',
         'Owner submitted but ESH has not closed it', 'esh_inspection', '2026-09-10',
         accountable_department_id, 'open', created_by
    from basis
  returning id, organization_id, created_by
), action as (
  insert into public.esh_finding_actions (
    organization_id, finding_id, sequence, title, required_outcome,
    evidence_rule, evidence_exception_reason, priority, state, owner_principal_id,
    assignment_version, baseline_due_at, due_at, created_by, assigned_at
  )
  select f.organization_id, f.id, 1, 'Show the correction', 'Show the correction',
         'no_file_exception', 'Fixture has no file', 'normal', 'assigned',
         b.owner_principal_id, 1, '2026-09-12T09:00:00Z', '2026-09-12T09:00:00Z',
         f.created_by, '2026-09-10T00:00:00Z'
    from finding f cross join basis b
  returning id, finding_id
)
insert into ids
select 'review_finding', finding_id from action
union all select 'review_action', id from action;

with basis as (
  select f.organization_id, f.accountable_department_id, f.created_by,
         a.owner_principal_id
    from public.esh_findings f
    join public.esh_finding_actions a on a.id = pg_temp.id('multi_action')
   where f.id = pg_temp.id('multi_finding')
), finding as (
  insert into public.esh_findings (
    organization_id, reference, title, description, source, reported_on,
    accountable_department_id, status, created_by
  )
  select organization_id, 'CLOSED-V202', 'v202 closed', 'A closed correction',
         'esh_inspection', '2026-09-01', accountable_department_id, 'open', created_by
    from basis
  returning id, organization_id, created_by
), action as (
  insert into public.esh_finding_actions (
    organization_id, finding_id, sequence, title, required_outcome,
    evidence_rule, evidence_exception_reason, priority, state, owner_principal_id,
    assignment_version, baseline_due_at, due_at, created_by, assigned_at
  )
  select f.organization_id, f.id, 1, 'Close it', 'Close it',
         'no_file_exception', 'Fixture has no file', 'normal', 'assigned',
         b.owner_principal_id, 1, '2026-09-05T09:00:00Z', '2026-09-05T09:00:00Z',
         f.created_by, '2026-09-01T00:00:00Z'
    from finding f cross join basis b
  returning id, finding_id
)
insert into ids
select 'closed_finding', finding_id from action
union all select 'closed_action', id from action;

insert into public.esh_action_assignments (
  organization_id, action_id, principal_id, version, started_at, assigned_by,
  policy_version, followup_pre_due_days, followup_remind_on_due,
  followup_overdue_every_days, followup_level_days, followup_review_reminder_days
)
select source.organization_id, pg_temp.id('review_action'), source.principal_id, 1,
       '2026-09-10T00:00:00Z', source.assigned_by, source.policy_version,
       source.followup_pre_due_days, source.followup_remind_on_due,
       source.followup_overdue_every_days, source.followup_level_days,
       source.followup_review_reminder_days
  from public.esh_action_assignments source
 where source.action_id = pg_temp.id('multi_action') and source.ended_at is null;

with inserted as (
insert into public.esh_finding_actions (
  organization_id, finding_id, sequence, title, required_outcome,
  evidence_rule, evidence_exception_reason, priority, state, owner_principal_id,
  assignment_version, baseline_due_at, due_at, created_by, assigned_at
)
select organization_id, finding_id, 2, 'Second overdue action', 'Correct the second condition',
       'no_file_exception', 'Fixture has no file', 'normal', 'assigned', owner_principal_id,
       1, '2026-09-18T09:00:00Z', '2026-09-18T09:00:00Z', created_by,
       '2026-09-10T00:00:00Z'
  from public.esh_finding_actions where id = pg_temp.id('multi_action')
returning id
)
insert into ids select 'second_action', id from inserted;

insert into public.esh_findings (
  organization_id, reference, title, description, source, reported_on,
  accountable_department_id, status, created_by
)
values (
  'e5e50000-0000-4000-8000-000000000001', 'LEGACY-V202', 'Unassigned import',
  'Needs reconciliation', 'import', '2026-09-01', null, 'new',
  'f0c05000-0000-4000-a000-000000000002'
);

with action as (
  select a.*, p.display_email
    from public.esh_finding_actions a
    join public.esh_email_principals p on p.id = a.owner_principal_id
   where a.id = pg_temp.id('review_action')
), message as (
  insert into public.esh_action_messages (
    organization_id, action_id, author_kind, author_principal_id,
    author_email, body, client_key, sent_at
  )
  select organization_id, id, 'owner', owner_principal_id, display_email,
         'The correction is complete.', 'v202-review-message', '2026-09-15T01:00:00Z'
    from action
  returning id, organization_id, action_id
), submission as (
  insert into public.esh_action_submissions (
    organization_id, action_id, version, assignment_version, principal_id,
    owner_email, message_id, result_text, state, submitted_at, client_key
  )
  select m.organization_id, m.action_id, 1, a.assignment_version, a.owner_principal_id,
         a.display_email, m.id, 'The corrected condition', 'pending',
         '2026-09-15T01:00:00Z', 'v202-review-submit'
    from message m join action a on a.id = m.action_id
  returning id, action_id
)
update public.esh_finding_actions a
   set state = 'awaiting_verification', current_submission_id = s.id,
       due_at = '2026-09-12T09:00:00Z'
  from submission s where a.id = s.action_id;

update public.esh_finding_actions
   set state = 'accepted', accepted_at = '2026-09-19T02:00:00Z'
 where id = pg_temp.id('closed_action');
update public.esh_findings
   set status = 'closed', closed_at = '2026-09-19T02:00:00Z'
 where id = pg_temp.id('closed_finding');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

select lives_ok(
  $$select * from public.esh_overview(null, '2026-08-22T00:00:00Z', null,
                                      '2026-09-20T01:00:00Z')$$,
  'the authorized overview is callable');
select is((select sum(open_findings) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z'))
    - pg_temp.was_open('wide'), 3::numeric,
  'open counts findings, including an unassigned import');
select is((select sum(overdue_actions) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z'))
    - pg_temp.was_overdue('wide'), 2::numeric,
  'both overdue actions are counted');
select is((select sum(awaiting_review_actions) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')), 1::numeric,
  'a current pending submission is awaiting review');
select is((select sum(review_overdue_actions) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')), 1::numeric,
  'the assignment snapshot determines review overdue');
select is((select sum(closed_findings) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')), 1::numeric,
  'the current official closure is counted');
select ok(exists(select 1 from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')
  where accountable_department_id is null and department_name = 'Unassigned'),
  'Unassigned is an explicit department row');
select is((select sum(open_findings) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')),
  (select count(*) from public.esh_register_rows where status in ('draft','new','open'))::numeric,
  'signal and register finding totals reconcile');
select is((select open_findings from public.esh_overview(
  (select id from public.departments where code = 'OPS'), '2026-08-22T00:00:00Z', null,
  '2026-09-20T01:00:00Z'))::numeric - pg_temp.was_open('ops'), 2::numeric,
  'two actions do not double-count their finding');
select is((select count(*) from public.esh_action_register_rows
  where finding_id = pg_temp.id('multi_finding') and is_overdue), 2::bigint,
  'the overdue drill-down contains action rows');
select is((select count(*) from public.esh_register_rows
  where finding_id = pg_temp.id('multi_finding')), 1::bigint,
  'the open drill-down contains one finding row');
select is((select sum(open_findings) from public.esh_overview(
  null, '2020-01-01T00:00:00Z', '2020-01-31T23:59:59Z', '2026-09-20T01:00:00Z'))
    - pg_temp.was_open('old_closure'),
  3::numeric, 'changing the closure period does not hide old open work');
select is((select sum(closed_findings) from public.esh_overview(
  null, '2020-01-01T00:00:00Z', '2020-01-31T23:59:59Z', '2026-09-20T01:00:00Z')),
  0::numeric, 'the closure period applies only to closed findings');
select is((select sum(closed_findings) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T01:00:00Z')),
  1::numeric, 'owner submission did not count as another closure');
select pg_temp.reset_role();

update public.esh_findings set status = 'open', closed_at = null,
  reopened_at = '2026-09-20T02:00:00Z', reopen_reason = 'Condition returned'
 where id = pg_temp.id('closed_finding');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((select sum(closed_findings) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T03:00:00Z')), 0::numeric,
  'a reopened finding leaves current closed totals');
select is((select sum(open_findings) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T03:00:00Z'))
    - pg_temp.was_open('after_reopen'), 4::numeric,
  'that reopened finding returns to open');
select pg_temp.reset_role();
update public.esh_findings set status = 'closed', closed_at = '2026-09-20T04:00:00Z'
 where id = pg_temp.id('closed_finding');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((select sum(closed_findings) from public.esh_overview(
  null, '2026-09-20T03:30:00Z', null, '2026-09-20T05:00:00Z')), 1::numeric,
  'reclosure uses the current closure event');
select is((select sum(open_findings) from public.esh_overview(
  null, '2026-09-20T03:30:00Z', null, '2026-09-20T05:00:00Z'))
    - pg_temp.was_open('after_reclose'), 3::numeric,
  'a reclosed finding no longer remains open');
select is((select count(*) from public.esh_register_export_rows
  where finding_id = pg_temp.id('multi_finding')), 2::bigint,
  'the export has one row per action');
select is((select before_description from public.esh_register_export_rows
  where action_id = pg_temp.id('multi_action')), '=unsafe spreadsheet text',
  'the export source includes the before description for safe serialization');
select ok((select baseline_due_at is not null and current_due_at is not null
  from public.esh_register_export_rows where action_id = pg_temp.id('multi_action')),
  'the export includes baseline and current deadlines');
select is((select escalation_state from public.esh_register_export_rows
  where action_id = pg_temp.id('multi_action')), 'configured',
  'the export names configured escalation state');
select is((select count(*) from information_schema.columns
  where table_schema = 'public' and table_name = 'esh_register_export_rows'
    and column_name ilike '%evidence%'), 0::bigint,
  'the export exposes no evidence URL or token column');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is((select count(*) from public.esh_overview(
  null, '2026-08-22T00:00:00Z', null, '2026-09-20T05:00:00Z')), 0::bigint,
  'a staff member without Finding access gets no overview rows');
select pg_temp.reset_role();
select throws_ok(
  $$set local role anon; select count(*) from public.esh_action_register_rows$$,
  '42501', null, 'anonymous callers cannot read action drill-down rows');

select * from finish();
rollback;
