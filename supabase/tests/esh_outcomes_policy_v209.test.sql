-- ============================================================================
-- ESH Finding Management v209: outcomes that are not closures, and a policy
-- that can differ by risk and priority.
--
-- §6, §16, §21. What only the database can establish: a finding recorded in
-- error stops being work without being called verified, a duplicate keeps a
-- link to what it repeats, follow-up promises follow the action's own priority
-- and risk, quiet hours hold routine mail but never news, and the catch-up
-- rule is a decision rather than a habit.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

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
create or replace function pg_temp.assign(p_title text, p_priority text, p_risk text, p_due text)
returns uuid language plpgsql as $$
declare
  result jsonb;
begin
  result := public.esh_save_finding(null, jsonb_build_object(
    'title', p_title, 'description', 'Found on the v209 walk',
    'reported_on', '2026-09-01',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'location', 'BR2', 'required_outcome', 'Put it right', 'priority', p_priority,
    'risk_level', p_risk,
    'owner_email', 'owner.v209@example.com', 'due_date', p_due,
    'escalation', jsonb_build_array(
      jsonb_build_object('level', 1, 'email', 'lead.v209@example.com'),
      jsonb_build_object('level', 2, 'email', 'boss.v209@example.com'))
  ), true);
  if not coalesce((result->>'ok')::boolean, false) then
    raise exception 'assign failed: %', result;
  end if;
  return (result->>'action_id')::uuid;
end;
$$;

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;
create or replace function pg_temp.v209(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

select has_table('public', 'esh_followup_policy_rules', 'policy rules are their own records');
select has_column('public', 'esh_findings', 'duplicate_of_finding_id',
                  'a duplicate keeps a link to what it repeats');
select ok((select relrowsecurity from pg_class
            where oid = 'public.esh_followup_policy_rules'::regclass),
          'rules are read under Finding scope');

-- ---------------------------------------------------------------------------
-- An outcome that is not a closure (§6)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids values
  ('keep', pg_temp.assign('v209 the real one', 'normal', 'medium', '2026-12-10')),
  ('spare', pg_temp.assign('v209 typed twice', 'normal', 'medium', '2026-12-11'));
insert into ids
select 'keep_finding', finding_id from public.esh_finding_actions where id = pg_temp.v209('keep');
insert into ids
select 'spare_finding', finding_id from public.esh_finding_actions where id = pg_temp.v209('spare');

select is(public.esh_resolve_finding(pg_temp.v209('spare_finding'), 'cancelled', 'no')->>'code',
          'reason_required', 'an outcome without a reason is refused');
select is(public.esh_resolve_finding(pg_temp.v209('spare_finding'), 'closed',
            'Trying to sneak a closure in')->>'code',
          'invalid', 'and closing is not one of the outcomes this offers');
select is(public.esh_resolve_finding(pg_temp.v209('spare_finding'), 'duplicate',
            'Same as the other one')->>'code',
          'duplicate_of_required', 'a duplicate has to say what it duplicates');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_resolve_finding(pg_temp.v209('spare_finding'), 'cancelled',
            'Not mine to cancel')->>'code',
          'not_permitted', 'and somebody outside ESH cannot record one at all');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((public.esh_resolve_finding(pg_temp.v209('spare_finding'), 'duplicate',
            'Recorded twice on the same walk', pg_temp.v209('keep_finding'))
            ->>'actions_cancelled')::text, '1',
          'the duplicate is recorded and its outstanding work stops');
select is((select status from public.esh_findings where id = pg_temp.v209('spare_finding')),
          'duplicate', 'the finding says what became of it');
select is((select duplicate_of_finding_id from public.esh_findings
            where id = pg_temp.v209('spare_finding')), pg_temp.v209('keep_finding'),
          'with a link to the one it repeats, rather than being deleted');
select is((select state from public.esh_finding_actions where id = pg_temp.v209('spare')),
          'cancelled', 'its action is cancelled, not accepted');
select is((select closed_at from public.esh_findings where id = pg_temp.v209('spare_finding')),
          null::timestamptz, 'and nothing about it claims ESH verified a correction');
select is((select count(*)::integer from public.esh_notification_outbox
            where finding_id = pg_temp.v209('spare_finding')
              and state in ('queued', 'held_rollout')), 0,
          'nothing queued for it is still waiting to be sent');
select pg_temp.reset_role();
select is((select count(*)::integer from public.esh_access_grants
            where action_id = pg_temp.v209('spare') and revoked_at is null), 0,
          'and every link to that work stops working');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok(exists(select 1 from public.esh_audit_events
                  where finding_id = pg_temp.v209('spare_finding')
                    and event_type = 'finding_resolved'),
          'the decision is on the record');
select is(public.esh_resolve_finding(pg_temp.v209('spare_finding'), 'cancelled',
            'Changed my mind')->>'code',
          'already_resolved', 'and it cannot be resolved twice');

-- The finding it duplicates is untouched.
select is((select status from public.esh_findings where id = pg_temp.v209('keep_finding')),
          'open', 'the finding it repeats is left alone');

-- ---------------------------------------------------------------------------
-- A policy that differs by risk and priority (§16)
-- ---------------------------------------------------------------------------

select is((select followup_level_days from public.esh_action_assignments
            where action_id = pg_temp.v209('keep')), array[1, 3, 7]::smallint[],
          'without a rule, an assignment carries the organisation policy');

select ok((public.esh_set_followup_rule('risk', 'critical', 1, true, 1,
            array[1, 2, 3], 1)->>'ok')::boolean,
          'ESH writes a rule for critical risk');
select ok((public.esh_set_followup_rule('priority', 'urgent', 0, true, 1,
            array[1, 2, 4], 1)->>'ok')::boolean,
          'and another for urgent work');
select is(public.esh_set_followup_rule('risk', 'catastrophic', 1, true, 1,
            array[1], 1)->>'code', 'invalid',
          'a level that is not one of this organisation''s is refused');

insert into ids values
  ('critical', pg_temp.assign('v209 critical', 'normal', 'critical', '2026-12-12')),
  ('urgent', pg_temp.assign('v209 urgent', 'urgent', 'critical', '2026-12-13'));

select is((select followup_level_days from public.esh_action_assignments
            where action_id = pg_temp.v209('critical')), array[1, 2, 3]::smallint[],
          'a critical finding is chased on the critical schedule');
select is((select followup_level_days from public.esh_action_assignments
            where action_id = pg_temp.v209('urgent')), array[1, 2, 4]::smallint[],
          'and priority wins over risk, because it is the judgement about this action');
select is((select followup_pre_due_days from public.esh_action_assignments
            where action_id = pg_temp.v209('urgent')), 0::smallint,
          'the whole rule applies, not only its levels');

select ok((public.esh_set_followup_rule('priority', 'urgent', null, null, null, null, null, true)
            ->>'ok')::boolean, 'a rule can be taken away again');
select is((select count(*)::integer from public.esh_followup_policy_rules
            where applies_to = 'priority'), 0, 'and it is gone');

-- ---------------------------------------------------------------------------
-- Quiet hours hold routine mail, and nothing else (§16)
-- ---------------------------------------------------------------------------

select is(public.esh_set_followup_quiet_hours('21:00', null, 'coalesce')->>'code',
          'quiet_hours_incomplete', 'half a quiet window is not a quiet window');
select ok((public.esh_set_followup_quiet_hours('21:00', '07:00', 'coalesce')->>'ok')::boolean,
          'ESH sets quiet hours that cross midnight');

select pg_temp.reset_role();
select is(focus.esh_after_quiet_hours('e5e50000-0000-4000-8000-000000000001',
            '2026-09-21 15:00:00+00'),  -- 23:00 in Kuala Lumpur
          '2026-09-21 23:00:00+00'::timestamptz,
          'a routine notice raised at eleven at night waits until seven');
select is(focus.esh_after_quiet_hours('e5e50000-0000-4000-8000-000000000001',
            '2026-09-21 02:00:00+00'),  -- 10:00 in Kuala Lumpur
          '2026-09-21 02:00:00+00'::timestamptz,
          'and one raised in the morning goes at once');

-- ---------------------------------------------------------------------------
-- The catch-up rule is a decision (§16)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok((public.esh_set_followup_quiet_hours(null, null, 'every_missed')->>'ok')::boolean,
          'an organisation may ask for every missed stage');
select pg_temp.reset_role();

-- Both levels of the critical action are due by then.
select ok((public.esh_run_followups('2026-12-23 01:00:00+00')->>'escalations')::integer > 0,
          'the run escalates the overdue work');
select is((select array_agg(stage order by stage)::integer[] from public.esh_followup_events
            where action_id = pg_temp.v209('critical') and kind = 'escalation'
              and trigger_key like 'level-%' and state is distinct from 'suppressed'),
          array[1, 2],
          'every missed stage is sent in its own right, not only the highest');
select is((select count(*)::integer from public.esh_followup_events
            where action_id = pg_temp.v209('critical') and kind = 'escalation'
              and state = 'suppressed'), 0,
          'and nothing is recorded as skipped when nothing was skipped');

select * from finish();
rollback;
