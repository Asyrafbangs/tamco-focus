-- ============================================================================
-- ESH Finding Management v208: priority, changed and explained.
--
-- §39; FM90. What only the database can establish: priority can be changed
-- after assignment, never without a reason, never by somebody outside the
-- finding's scope, and never at the cost of the deadline, the risk assessment
-- or the follow-up schedule.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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
create or replace function pg_temp.v208(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

select has_table('public', 'esh_priority_changes', 'every change is a record of its own');
select ok((select relrowsecurity from pg_class where oid = 'public.esh_priority_changes'::regclass),
          'read under the same scope as the finding');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
with saved as (
  select public.esh_save_finding(null, jsonb_build_object(
    'title', 'v208 walkway', 'description', 'Found on the v208 walk',
    'reported_on', '2026-09-10',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Put it right', 'priority', 'normal',
    'owner_email', 'owner.v208@example.com', 'due_date', '2026-12-10',
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true, 'v208-one') value
)
insert into ids
select 'action', (value->>'action_id')::uuid from saved
union all select 'finding', (value->>'finding_id')::uuid from saved;

select is((select priority from public.esh_finding_actions where id = pg_temp.v208('action')),
          'normal', 'the fixture starts Normal');
-- Somebody without Finding coordination cannot reorder anybody's week.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_set_priority(pg_temp.v208('action'), 'urgent', 'It looks bad')->>'code',
          'not_permitted', 'a colleague outside ESH cannot change a priority');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is(public.esh_set_priority(pg_temp.v208('action'), 'urgent', '')->>'code',
          'reason_required', 'and ESH cannot change one silently');
select is(public.esh_set_priority(pg_temp.v208('action'), 'critical', 'Because')->>'code',
          'invalid', 'the levels are the three the owner''s list uses');
select is(public.esh_set_priority(pg_temp.v208('action'), 'normal', 'No change really')->>'code',
          'unchanged', 'and setting it to what it already is changes nothing');

select ok((public.esh_set_priority(pg_temp.v208('action'), 'urgent',
            'Contractor on site Thursday only')->>'ok')::boolean,
          'ESH moves it to Urgent, with a reason');
select is((select priority from public.esh_finding_actions where id = pg_temp.v208('action')),
          'urgent', 'the owner''s list now leads with it');
select is((select reason from public.esh_priority_changes where action_id = pg_temp.v208('action')),
          'Contractor on site Thursday only', 'and the reason is kept');
select is((select from_priority from public.esh_priority_changes
            where action_id = pg_temp.v208('action')), 'normal',
          'with what it was before');

-- Nothing else moved.
select is((select due_at::date from public.esh_finding_actions where id = pg_temp.v208('action')),
          '2026-12-10'::date, 'the agreed deadline is where it was');
select is((select risk_level from public.esh_findings where id = pg_temp.v208('finding')),
          'not_assessed', 'the risk assessment is untouched');
select is((select count(*)::integer from public.esh_followup_events
            where action_id = pg_temp.v208('action')), 0,
          'and no reminder or escalation clock was restarted');

select pg_temp.reset_role();
select throws_ok($$
  update public.esh_priority_changes set reason = 'rewritten'
$$, '42501', null, 'a recorded change cannot be rewritten afterwards');

select * from finish();
rollback;
