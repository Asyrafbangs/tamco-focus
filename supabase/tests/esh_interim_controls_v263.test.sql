-- ============================================================================
-- ESH Finding Management v263: what protects people while the finding is open.
--
-- The rule worth testing hardest is the one that costs something: changing the
-- interim control clears its verification. Everything else here is the usual
-- authority and validation; that one is the difference between a record that
-- says somebody checked the barrier and a record that says somebody checked a
-- barrier that has since been replaced.
--
-- The dashboard figures are org-wide, so each assertion states its own
-- contribution against a baseline taken before this test creates anything
-- (AGENTS.md section 10).
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
create or replace function pg_temp.ops()
returns uuid language sql stable as $$
  select id from public.departments where code = 'OPS'
$$;

create temporary table v263 (name text primary key, id uuid);
grant all on v263 to authenticated;

delete from public.esh_findings where title like 'v263 %';

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

create temporary table v263_before (
  k text primary key, unprotected integer, unverified integer, unassessed integer);
grant all on v263_before to authenticated;
insert into v263_before
select 'x',
       (public.esh_dashboard()->'protection'->>'unprotected')::integer,
       (public.esh_dashboard()->'protection'->>'unverified')::integer,
       (public.esh_dashboard()->'protection'->>'unassessed')::integer;

create or replace function pg_temp.raise(p_name text, p_risk text)
returns void language plpgsql as $$
begin
  insert into v263 (name, id)
  select p_name,
         (public.esh_save_finding(null, jsonb_build_object(
            'title', 'v263 ' || p_name, 'description', 'Guard missing on the press.',
            'reported_on', '2026-10-20', 'accountable_department_id', pg_temp.ops(),
            'location', 'BR2 press line 2', 'required_outcome', 'Fit a fixed guard.',
            'priority', 'high', 'risk_level', p_risk,
            'owner_email', 'owner.' || p_name || '.v263@example.com',
            'due_date', '2026-12-30', 'escalation', '[]'::jsonb,
            'no_further_escalation_reason', 'Fixture.'), true)->>'finding_id')::uuid;
end;
$$;

select pg_temp.raise('guard', 'critical');
select pg_temp.raise('spill', 'high');
select pg_temp.raise('label', 'high');
select pg_temp.raise('unknown', 'not_assessed');

create or replace function pg_temp.id(p_name text)
returns uuid language sql stable as $$ select id from v263 where name = p_name $$;

create or replace function pg_temp.protection(p_key text)
returns integer language sql stable as $$
  select (public.esh_dashboard()->'protection'->>p_key)::integer
$$;

-- ---------------------------------------------------------------------------
-- Recording the interim position
-- ---------------------------------------------------------------------------

select is(
  public.esh_set_interim_control(pg_temp.id('guard'), jsonb_build_object(
    'immediate_containment', 'Press stopped and locked off at 14:10.',
    'interim_control', 'Physical barrier and a padlocked isolator; operators briefed.',
    'interim_owner', 'Shift supervisor, Line 2'))->>'ok',
  'true',
  'ESH records what is holding the hazard until the guard arrives');

select is(
  public.esh_set_interim_control(pg_temp.id('spill'), jsonb_build_object(
    'interim_control', 'Absorbent mat and a cordon.'))->>'code',
  'owner_required',
  'a control nobody is responsible for is not a control');

select is(
  public.esh_set_interim_control(pg_temp.id('spill'), jsonb_build_object(
    'interim_control', 'Cordon.', 'interim_owner', 'Supervisor',
    'not_required_reason', 'None needed.'))->>'code',
  'both_given',
  'and it cannot both need one and not need one');

-- ---------------------------------------------------------------------------
-- Verifying it is a separate claim from recording it
-- ---------------------------------------------------------------------------

select is(
  public.esh_verify_interim_control(pg_temp.id('label'))->>'code',
  'no_control',
  'there is nothing to verify until something is written down');

select ok(
  (public.esh_verify_interim_control(pg_temp.id('guard'))->>'ok')::boolean,
  'somebody goes and checks the barrier is actually there');

select is(
  (select interim_verified_by from public.esh_findings where id = pg_temp.id('guard')),
  'f0c05000-0000-4000-a000-000000000002'::uuid,
  'and the record says who checked it');

-- The rule with teeth.
select is(
  public.esh_set_interim_control(pg_temp.id('guard'), jsonb_build_object(
    'immediate_containment', 'Press stopped and locked off at 14:10.',
    'interim_control', 'Barrier replaced with a temporary interlocked gate.',
    'interim_owner', 'Shift supervisor, Line 2'))->>'verification_cleared',
  'true',
  'changing the control says plainly that its verification is gone');

select is(
  (select interim_verified_at from public.esh_findings where id = pg_temp.id('guard')),
  null,
  'and a barrier nobody has checked since it changed is not a verified barrier');

select ok(
  (select interim_owner is not null and immediate_containment is not null
     from public.esh_findings where id = pg_temp.id('guard')),
  'the rest of the position survives the change');

-- ---------------------------------------------------------------------------
-- Deciding none is needed is a decision, not silence
-- ---------------------------------------------------------------------------

select ok(
  (public.esh_set_interim_control(pg_temp.id('label'), jsonb_build_object(
     'not_required_reason', 'The container was removed from the floor the same hour.'
   ))->>'ok')::boolean,
  'a finding that needs no interim control says so, with a reason');

select ok(
  (select interim_control is null and interim_not_required_reason is not null
     from public.esh_findings where id = pg_temp.id('label')),
  'and that decision replaces any control previously written');

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(
  public.esh_set_interim_control(pg_temp.id('spill'), jsonb_build_object(
    'interim_control', 'Anything.', 'interim_owner', 'Me'))->>'code',
  'not_permitted',
  'somebody without Finding access cannot write the safety position');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok(
  (public.esh_resolve_finding(pg_temp.id('unknown'), 'raised_in_error',
                              'Reported twice in the same hour.')->>'ok')::boolean,
  'a finding can be closed administratively');
select is(
  public.esh_set_interim_control(pg_temp.id('unknown'), jsonb_build_object(
    'interim_control', 'Too late.', 'interim_owner', 'Nobody'))->>'code',
  'not_open',
  'and a closed finding no longer takes an interim position');

-- ---------------------------------------------------------------------------
-- What the dashboard makes of it
-- ---------------------------------------------------------------------------

-- `spill` is high risk with nothing recorded; `guard` is high risk with a
-- control whose verification was just cleared. Both are unprotected; only
-- `guard` has something written waiting to be checked. `label` decided it
-- needed none, and `unknown` was closed above, so neither counts.
select is(
  pg_temp.protection('unprotected') - (select unprotected from v263_before),
  2,
  'significant work with no verified protection is counted');

select is(
  pg_temp.protection('unverified') - (select unverified from v263_before),
  1,
  'and a control written but not yet checked is counted separately');

/*
 * Two statements, not one `and`: both sides of an `and` are evaluated and the
 * planner may read the count before the verification it is supposed to follow,
 * which is how this assertion first failed while the behaviour was correct.
 */
select ok(
  (public.esh_verify_interim_control(pg_temp.id('guard'))->>'ok')::boolean,
  'the replaced barrier is checked in its turn');

select is(
  pg_temp.protection('unprotected') - (select unprotected from v263_before),
  1,
  'and checking it removes it from the unprotected count');

select ok(
  exists(select 1 from public.esh_audit_events
          where finding_id = pg_temp.id('guard')
            and event_type = 'interim_control_set'
            and detail->'to'->>'control' like 'Barrier replaced%'
            and (detail->>'verification_cleared')::boolean),
  'and the whole change is on the audit trail, including what it cost');

select * from finish();
rollback;
