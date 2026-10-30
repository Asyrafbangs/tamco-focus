-- ============================================================================
-- ESH Finding Management v267: did the fix actually hold?
--
-- The assertion worth having is what a failure does. It must NOT reopen the
-- original closure: that closure was a true statement about the day it was
-- made, and overwriting it destroys the only evidence that the fix was once in
-- place and later was not — which is the entire reason for checking.
-- ============================================================================

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

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;
create or replace function pg_temp.v267(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids
select 'action', (public.esh_save_finding(null, jsonb_build_object(
  'title', 'v267 guard removed from the press', 'description', 'The fixed guard was missing.',
  'reported_on', '2026-08-01',
  'accountable_department_id', (select id from public.departments where code = 'OPS'),
  'location', 'BR2 press line 2', 'required_outcome', 'Refit the guard.',
  'priority', 'high', 'risk_level', 'high',
  'owner_email', 'owner.v267@example.com', 'due_date', '2026-09-30',
  'escalation', '[]'::jsonb, 'no_further_escalation_reason', 'Fixture.'
), true)->>'action_id')::uuid;
insert into ids
select 'finding', finding_id from public.esh_finding_actions where id = pg_temp.v267('action');

-- ---------------------------------------------------------------------------
-- Not before the correction has been accepted
-- ---------------------------------------------------------------------------

select is(
  public.esh_schedule_effectiveness_check(pg_temp.v267('action'), current_date + 90,
    'The guard is fitted and the interlock stops the press.')->>'code',
  'not_accepted',
  'a check on work still being done asks about a fix that does not exist yet');

select pg_temp.reset_role();
update public.esh_finding_actions
   set state = 'accepted', accepted_at = now() where id = pg_temp.v267('action');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

-- ---------------------------------------------------------------------------
-- Scheduling
-- ---------------------------------------------------------------------------

select is(
  public.esh_schedule_effectiveness_check(pg_temp.v267('action'), current_date - 1,
    'Anything.')->>'code',
  'date_invalid',
  'and one due in the past is not a check, it is a tidy-up');

select is(
  public.esh_schedule_effectiveness_check(pg_temp.v267('action'), current_date + 90,
    'ok')->>'code',
  'criteria_required',
  'a check has to say what the person has to see');

select ok(
  (public.esh_schedule_effectiveness_check(pg_temp.v267('action'), current_date + 90,
     'The guard is fitted and the interlock stops the press when it is opened.',
     'Line 2 supervisor')->>'ok')::boolean,
  'ESH books somebody to go and look in ninety days');

select is(
  public.esh_schedule_effectiveness_check(pg_temp.v267('action'), current_date + 120,
    'Again.')->>'code',
  'already_scheduled',
  'and one outstanding check at a time is enough');

insert into ids
select 'check', id from public.esh_effectiveness_checks
 where action_id = pg_temp.v267('action') and state = 'scheduled';

-- ---------------------------------------------------------------------------
-- A failure, which is the case that matters
-- ---------------------------------------------------------------------------

select is(
  public.esh_record_effectiveness_check(pg_temp.v267('check'), false, null)->>'code',
  'note_required',
  'a failure has to say what was actually found');

create temporary table v267_before as
  select status, closed_at from public.esh_findings where id = pg_temp.v267('finding');
grant all on v267_before to authenticated;

select ok(
  (public.esh_record_effectiveness_check(pg_temp.v267('check'), false,
     'The guard was fitted but the interlock has been bypassed with a magnet.')
   ->>'follow_up_finding_id') is not null,
  'a failure raises a new finding');

select is(
  (select status from public.esh_findings where id = pg_temp.v267('finding')),
  (select status from v267_before),
  'and leaves the original exactly as it was closed');

select is(
  (select source_reference from public.esh_findings
    where id = (select follow_up_finding_id from public.esh_effectiveness_checks
                 where id = pg_temp.v267('check'))),
  (select reference from public.esh_findings where id = pg_temp.v267('finding')),
  'the new one points back at the finding whose fix did not hold');

select is(
  (select state from public.esh_effectiveness_checks where id = pg_temp.v267('check')),
  'failed',
  'and the check itself records the verdict');

select is(
  public.esh_record_effectiveness_check(pg_temp.v267('check'), true, 'Changed my mind.')->>'code',
  'not_found',
  'a check that has been decided cannot be decided again');

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(
  public.esh_schedule_effectiveness_check(pg_temp.v267('action'), current_date + 30,
    'Anything at all.')->>'code',
  'not_permitted',
  'somebody without Finding access books nobody to check anything');

select * from finish();
rollback;
