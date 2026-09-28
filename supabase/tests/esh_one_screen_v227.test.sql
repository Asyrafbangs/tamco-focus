-- ============================================================================
-- ESH Finding Management v227: one screen, one job.
--
-- What only the database can establish: an open finding's wording and risk
-- are corrected on the record without moving its deadline; the register knows
-- when changes were requested and no longer counts a held email as a row
-- needing attention; "raised in error" is an outcome and Withdraw is no longer
-- one.
-- ============================================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

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
create or replace function pg_temp.v227(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;


-- The cast: 0002 is an ESH Verifier with organisation-wide scope.
create or replace function pg_temp.assign(p_key text, p_owner text)
returns void language plpgsql as $$
declare saved jsonb;
begin
  saved := public.esh_save_finding(null, jsonb_build_object(
    'title', 'v227 ' || p_key, 'description', 'Found on the v227 walk',
    'reported_on', '2026-09-10',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Put it right', 'priority', 'normal',
    'owner_email', p_owner, 'due_date', '2026-12-10',
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true, 'v227-' || p_key);
  insert into ids values (p_key || '_action', (saved->>'action_id')::uuid),
                         (p_key || '_finding', (saved->>'finding_id')::uuid);
end;
$$;

-- Read as the table owner whoever is acting.
create or replace function pg_temp.assignment_state(p_key text)
returns text language plpgsql as $$
declare
  claims text := current_setting('request.jwt.claims', true);
  who text := current_setting('role', true);
  v text;
begin
  perform set_config('role', 'postgres', true);
  select state into v from public.esh_notification_outbox
   where action_id = pg_temp.v227(p_key || '_action') and event_type = 'owner_assignment';
  perform set_config('role', coalesce(nullif(who, ''), 'postgres'), true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  return v;
end;
$$;
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select pg_temp.assign('live', 'second.owner.v227@example.com');
select pg_temp.assign('held', 'held.owner.v227@example.com');
select is(pg_temp.assignment_state('held'), 'held_rollout',
          'fixture: a restricted rollout holds the assignment to an uncleared contact');

-- 1. Correcting an open finding -----------------------------------------------

select ok((public.esh_edit_finding(pg_temp.v227('live_finding'), 'v227 walkway, bay 4',
            'Found on the v227 walk', 'Bay 4',
            (select id from public.departments where code = 'OPS'))->>'ok')::boolean,
          'ESH corrects an open finding''s wording');
select is((select detail->'changed'->'title'->>1 from public.esh_audit_events
            where event_type = 'finding_edited' and finding_id = pg_temp.v227('live_finding')),
          'v227 walkway, bay 4', 'with the before and after on the record');
select is(public.esh_edit_finding(pg_temp.v227('live_finding'), 'v227 walkway, bay 4',
            'Found on the v227 walk', 'Bay 4',
            (select id from public.departments where code = 'OPS'))->>'code', 'unchanged',
          'saving the same words changes nothing');

select is(public.esh_set_risk(pg_temp.v227('live_finding'), 'high', '')->>'code',
          'reason_required', 'risk is not reassessed silently');
select ok((public.esh_set_risk(pg_temp.v227('live_finding'), 'high',
            'Forklift route crosses it')->>'ok')::boolean, 'ESH reassesses the risk');
select is((select risk_level from public.esh_findings where id = pg_temp.v227('live_finding')),
          'high', 'and the finding carries it');
select is((select due_at::date from public.esh_finding_actions
            where id = pg_temp.v227('live_action')),
          '2026-12-10'::date, 'the deadline did not move with it');

-- 3. The register -------------------------------------------------------------

select pg_temp.reset_role();
insert into public.esh_action_messages
  (organization_id, action_id, author_kind, author_principal_id, author_email, body, client_key)
select organization_id, id, 'owner', owner_principal_id, 'second.owner.v227@example.com', 'Done',
       'v227-msg'
  from public.esh_finding_actions where id = pg_temp.v227('live_action');
insert into public.esh_action_submissions
  (organization_id, action_id, version, assignment_version, principal_id, owner_email,
   message_id, result_text, state, client_key)
select a.organization_id, a.id, 1, a.assignment_version, a.owner_principal_id,
       'second.owner.v227@example.com',
       (select id from public.esh_action_messages where client_key = 'v227-msg'),
       'Done', 'changes_requested', 'v227-sub'
  from public.esh_finding_actions a where a.id = pg_temp.v227('live_action');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok((select changes_requested from public.esh_register_rows
            where finding_id = pg_temp.v227('live_finding')),
          'a correction sent back reads as changes requested');
select ok(not (select needs_attention from public.esh_register_rows
                where finding_id = pg_temp.v227('held_finding')),
          'a held email alone no longer makes a row need attention');

-- 4. Outcomes -----------------------------------------------------------------

select is(public.esh_resolve_finding(pg_temp.v227('held_finding'), 'withdrawn',
            'Not needed')->>'code', 'invalid', 'Withdraw is no longer an outcome');
select ok((public.esh_resolve_finding(pg_temp.v227('held_finding'), 'raised_in_error',
            'Wrong area recorded')->>'ok')::boolean, 'Raised in error is');
select is((select status || '/' || resolved_outcome from public.esh_findings
            where id = pg_temp.v227('held_finding')),
          'cancelled/raised_in_error', 'recorded as no longer open, with the reason it is not');

select * from finish();
rollback;
