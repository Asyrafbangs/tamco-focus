-- ============================================================================
-- ESH Finding Management v268: somebody is told the day has come.
--
-- v267 could record a check and a verdict. Nothing told anybody the date had
-- arrived, so a check booked in January for April depended on somebody opening
-- that finding in April -- the dependence on human memory this whole module
-- exists to remove.
--
-- Two rules worth the test: a check that is not due yet queues nothing, and a
-- second run the same day queues nothing again. Daily nagging about a check
-- nobody has done is how people learn to filter the sender.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

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
create or replace function pg_temp.v268(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

create or replace function pg_temp.raise(p_name text)
returns void language plpgsql as $$
begin
  insert into ids (name, id)
  select p_name, (public.esh_save_finding(null, jsonb_build_object(
    'title', 'v268 ' || p_name, 'description', 'Something corrected months ago.',
    'reported_on', '2026-08-01',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'location', 'BR2', 'required_outcome', 'Correct it.', 'priority', 'normal',
    'risk_level', 'high',
    'owner_email', 'owner.' || p_name || '.v268@example.com', 'due_date', '2026-09-30',
    'escalation', '[]'::jsonb, 'no_further_escalation_reason', 'Fixture.'
  ), true)->>'action_id')::uuid;
end;
$$;

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select pg_temp.raise('today');
select pg_temp.raise('later');
select pg_temp.reset_role();

update public.esh_finding_actions
   set state = 'accepted', accepted_at = now()
 where id in (select id from ids);

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok(
  (public.esh_schedule_effectiveness_check(pg_temp.v268('today'), current_date + 1,
     'The guard is fitted and the interlock works.')->>'ok')::boolean,
  'a check is booked for this finding');
select ok(
  (public.esh_schedule_effectiveness_check(pg_temp.v268('later'), current_date + 200,
     'Still extracting at the measured rate.')->>'ok')::boolean,
  'and another one a long way off');
select pg_temp.reset_role();

-- The scheduling procedure refuses a date in the past, so the day arrives the
-- way it does in life: by the date coming round.
update public.esh_effectiveness_checks
   set due_on = current_date
 where action_id = pg_temp.v268('today');

create or replace function pg_temp.queued(p_action uuid)
returns integer language sql stable as $$
  select count(*)::int from public.esh_notification_outbox
   where event_type = 'effectiveness_due' and action_id = p_action;
$$;

-- ---------------------------------------------------------------------------
-- The sweep
-- ---------------------------------------------------------------------------

select is(
  (public.esh_run_effectiveness_due()->>'ok')::text,
  'true',
  'the sweep runs');

select ok(
  pg_temp.queued(pg_temp.v268('today')) > 0,
  'the check whose day has come puts a notice in the outbox');

select is(
  pg_temp.queued(pg_temp.v268('later')),
  0,
  'and the one due in two hundred days does not');

-- The second run is the one that decides whether people keep reading these.
create temporary table v268_after as select pg_temp.queued(pg_temp.v268('today')) as n;
grant all on v268_after to authenticated;
select public.esh_run_effectiveness_due();
select is(
  pg_temp.queued(pg_temp.v268('today')),
  (select n from v268_after),
  'a second run the same day adds nothing');

select is(
  (select count(distinct recipient_user_id)::int from public.esh_notification_outbox
    where event_type = 'effectiveness_due' and action_id = pg_temp.v268('today')),
  pg_temp.queued(pg_temp.v268('today')),
  'one notice per person, never two to the same reader');

/*
 * Addressed to ESH, never to the named checker. `checker` is free text -- often
 * a supervisor with no contact record -- so there is nobody to write to and no
 * entitlement to write with (section 8).
 */
select is(
  (select count(*)::int from public.esh_notification_outbox
    where event_type = 'effectiveness_due' and recipient_principal_id is not null),
  0,
  'and no email principal is invented for a free-text name');

select * from finish();
rollback;
