-- ============================================================================
-- ESH Finding Management v223: the workflow keeps its machinery underneath.
--
-- What only the database can establish: Test mode holds email to contacts
-- nobody cleared and Live sends it; an administrator's "off" outlasts either
-- mode; Release all releases what it may and leaves the rest held; a
-- department cannot be created twice under two spellings; a department's
-- route is configuration, verifier-owned; an open finding's wording and risk
-- are corrected on the record; "raised in error" is an outcome and Withdraw
-- is no longer one; the register knows when changes were requested and no
-- longer counts a held email as a row needing attention.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

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
create or replace function pg_temp.v223(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

-- The cast: 0001 administrates the platform, 0002 is an ESH Verifier with
-- organisation-wide scope, 0003 has no Finding access.
create or replace function pg_temp.assign(p_key text, p_owner text)
returns void language plpgsql as $$
declare saved jsonb;
begin
  saved := public.esh_save_finding(null, jsonb_build_object(
    'title', 'v223 ' || p_key, 'description', 'Found on the v223 walk',
    'reported_on', '2026-09-10',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Put it right', 'priority', 'normal',
    'owner_email', p_owner, 'due_date', '2026-12-10',
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true, 'v223-' || p_key);
  insert into ids values (p_key || '_action', (saved->>'action_id')::uuid),
                         (p_key || '_finding', (saved->>'finding_id')::uuid);
end;
$$;

-- Read as the table owner whoever is acting: an administrator without
-- Finding access cannot see the outbox, and these checks are about its rows.
create or replace function pg_temp.assignment_state(p_key text)
returns text language plpgsql as $$
declare
  claims text := current_setting('request.jwt.claims', true);
  who text := current_setting('role', true);
  v text;
begin
  perform set_config('role', 'postgres', true);
  select state into v from public.esh_notification_outbox
   where action_id = pg_temp.v223(p_key || '_action') and event_type = 'owner_assignment';
  perform set_config('role', coalesce(nullif(who, ''), 'postgres'), true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  return v;
end;
$$;
create or replace function pg_temp.principal(p_email text)
returns public.esh_email_principals language plpgsql as $$
declare
  claims text := current_setting('request.jwt.claims', true);
  who text := current_setting('role', true);
  v public.esh_email_principals;
begin
  perform set_config('role', 'postgres', true);
  select * into v from public.esh_email_principals where canonical_email = p_email;
  perform set_config('role', coalesce(nullif(who, ''), 'postgres'), true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  return v;
end;
$$;

-- 1. Test mode is where the module starts -------------------------------------

select is((select owner_notices from public.esh_rollout_settings), 'held',
          'owner email starts in Test mode');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select pg_temp.assign('test', 'first.owner.v223@example.com');
select is(pg_temp.assignment_state('test'), 'held_rollout',
          'in Test mode an assignment to an uncleared contact is held, as it always was');
select ok((public.esh_held_summary()->>'assignments')::int >= 1,
          'the held count is readable by ESH for the one line that replaces per-row warnings');
select is(public.esh_held_summary()->>'mode', 'held', 'and it says which mode is on');

select is(public.esh_set_owner_notices('live', 'Go live for the pilot')->>'code', 'not_permitted',
          'an ESH Verifier cannot open owner email; that is an administrator''s decision');

-- 2. Live ---------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select is(public.esh_set_owner_notices('live', '')->>'code', 'reason_required',
          'switching mode needs a reason');
select is(public.esh_set_owner_notices('open', 'Because')->>'code', 'invalid',
          'the modes are Test and Live');
select ok((public.esh_set_owner_notices('live', 'Pilot owners are briefed')->>'ok')::boolean,
          'an administrator switches owner email to Live');
select is((select count(*)::int from public.esh_audit_events
            where event_type = 'owner_notices_changed' and detail->>'to' = 'live'), 1,
          'and the switch is on the record');
select is(pg_temp.assignment_state('test'), 'held_rollout',
          'switching to Live releases nothing by itself');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select pg_temp.assign('live', 'second.owner.v223@example.com');
select is(pg_temp.assignment_state('live'), 'queued',
          'in Live an assignment is sent at once, with no second press');
select ok((pg_temp.principal('second.owner.v223@example.com')).access_enabled,
          'and its owner is cleared by the assignment itself');

select pg_temp.reset_role();
select ok((select (detail->>'automatic')::boolean from public.esh_audit_events
            where event_type = 'contact_access_enabled'
              and detail->>'email' = 'second.owner.v223@example.com'),
          'the clearance is recorded, marked as automatic');

-- An administrator's "off" outlasts Live.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select pg_temp.assign('seed_off', 'switched.off.v223@example.com');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access(
             (pg_temp.principal('switched.off.v223@example.com')).id,
             false, 'Left the company')->>'ok')::boolean,
          'an administrator switches a contact off');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select pg_temp.assign('off', 'switched.off.v223@example.com');
select is(pg_temp.assignment_state('off'), 'held_rollout',
          'Live does not send to a contact an administrator switched off');

-- 3. Release all --------------------------------------------------------------

select is(public.esh_release_all_held('Pilot starts')->>'code', 'not_permitted',
          'Release all is an administrator''s act');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select is(public.esh_release_all_held('')->>'code', 'reason_required',
          'and it carries a reason');
create temporary table released as
  select public.esh_release_all_held('Pilot starts on Monday') as result;
select ok(((select result from released)->>'ok')::boolean, 'everything held is released at once');
select is(pg_temp.assignment_state('test'), 'queued',
          'the assignment held in Test mode is on its way');
select ok((pg_temp.principal('first.owner.v223@example.com')).access_enabled,
          'and the contact nobody had decided about is cleared');
select is(pg_temp.assignment_state('off'), 'held_rollout',
          'the switched-off contact''s assignment stays held');
select ok(((select result from released)->>'still_held')::int >= 1,
          'and the answer says something is still held');
select ok((public.esh_held_summary()->>'switched_off')::int >= 1,
          'the summary says why: somebody switched that contact off');
select is((select count(*)::int from public.esh_audit_events
            where event_type = 'notifications_released_all'), 1,
          'the release is one audited act');

-- 4. Departments --------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_create_department('Quality Lab')->>'code', 'not_permitted',
          'a colleague without Finding coordination cannot add a department');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is(public.esh_create_department('Operations')->>'code', 'exists',
          'a department that already exists is not created again');
select is(public.esh_create_department(' OPERATIONS. ')->>'id',
          (select id::text from public.departments where code = 'OPS'),
          'even spelled differently, and the answer is the one that exists');
select is(public.esh_create_department('Environment, Health and Safety')->>'code', 'exists',
          '"&" and "and" do not make two departments');
select is(public.esh_create_department('x')->>'code', 'name_invalid', 'a name is a name');
insert into ids select 'lab', (public.esh_create_department('Quality  Lab')->>'id')::uuid;
select is((select name from public.departments where id = pg_temp.v223('lab')), 'Quality Lab',
          'a new department is created, its spacing tidied');
select ok(pg_temp.v223('lab') = any (focus.esh_visible_department_ids()),
          'and it can be chosen at once');

-- 5. A department's route -----------------------------------------------------

select is(public.esh_set_department_route(pg_temp.v223('lab'),
            '[{"level": 2, "email": "director@example.com"}]'::jsonb)->>'code',
          'escalation_levels_have_gaps', 'a route starts at level 1');
select ok((public.esh_set_department_route(pg_temp.v223('lab'), jsonb_build_array(
            jsonb_build_object('level', 1, 'email', 'lab.manager@example.com'),
            jsonb_build_object('level', 2, 'email', 'ops.director@example.com'),
            jsonb_build_object('level', 2, 'email', 'OPS.Director@example.com')))->>'ok')::boolean,
          'a verifier sets the department''s usual route');
select is((select count(*)::int from public.esh_department_routes
            where department_id = pg_temp.v223('lab')), 2,
          'one address once per level');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is((select count(*)::int from public.esh_department_routes), 0,
          'a colleague without Finding access cannot read who escalations reach');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

-- 6. Correcting an open finding -----------------------------------------------

select ok((public.esh_edit_finding(pg_temp.v223('live_finding'), 'v223 walkway, bay 4',
            'Found on the v223 walk', 'Bay 4',
            (select id from public.departments where code = 'OPS'))->>'ok')::boolean,
          'ESH corrects an open finding''s wording');
select is((select detail->'changed'->'title'->>1 from public.esh_audit_events
            where event_type = 'finding_edited' and finding_id = pg_temp.v223('live_finding')),
          'v223 walkway, bay 4', 'with the before and after on the record');
select is(public.esh_edit_finding(pg_temp.v223('live_finding'), 'v223 walkway, bay 4',
            'Found on the v223 walk', 'Bay 4',
            (select id from public.departments where code = 'OPS'))->>'code', 'unchanged',
          'saving the same words changes nothing');

select is(public.esh_set_risk(pg_temp.v223('live_finding'), 'high', '')->>'code',
          'reason_required', 'risk is not reassessed silently');
select ok((public.esh_set_risk(pg_temp.v223('live_finding'), 'high',
            'Forklift route crosses it')->>'ok')::boolean, 'ESH reassesses the risk');
select is((select risk_level from public.esh_findings where id = pg_temp.v223('live_finding')),
          'high', 'and the finding carries it');
select is((select due_at::date from public.esh_finding_actions
            where id = pg_temp.v223('live_action')),
          '2026-12-10'::date, 'the deadline did not move with it');

-- 7. Outcomes -----------------------------------------------------------------

select is(public.esh_resolve_finding(pg_temp.v223('seed_off_finding'), 'withdrawn',
            'Not needed')->>'code', 'invalid', 'Withdraw is no longer an outcome');
select ok((public.esh_resolve_finding(pg_temp.v223('seed_off_finding'), 'raised_in_error',
            'Wrong area recorded')->>'ok')::boolean, 'Raised in error is');
select is((select status || '/' || resolved_outcome from public.esh_findings
            where id = pg_temp.v223('seed_off_finding')),
          'cancelled/raised_in_error', 'recorded as no longer open, with the reason it is not');

-- 8. The register -------------------------------------------------------------

select pg_temp.reset_role();
insert into public.esh_action_messages
  (organization_id, action_id, author_kind, author_principal_id, author_email, body, client_key)
select organization_id, id, 'owner', owner_principal_id, 'second.owner.v223@example.com', 'Done',
       'v223-msg'
  from public.esh_finding_actions where id = pg_temp.v223('live_action');
insert into public.esh_action_submissions
  (organization_id, action_id, version, assignment_version, principal_id, owner_email,
   message_id, result_text, state, client_key)
select a.organization_id, a.id, 1, a.assignment_version, a.owner_principal_id,
       'second.owner.v223@example.com',
       (select id from public.esh_action_messages where client_key = 'v223-msg'),
       'Done', 'changes_requested', 'v223-sub'
  from public.esh_finding_actions a where a.id = pg_temp.v223('live_action');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok((select changes_requested from public.esh_register_rows
            where finding_id = pg_temp.v223('live_finding')),
          'a correction sent back reads as changes requested');
select ok(not (select needs_attention from public.esh_register_rows
                where finding_id = pg_temp.v223('off_finding')),
          'a held email alone no longer makes a row need attention');

select * from finish();
rollback;
