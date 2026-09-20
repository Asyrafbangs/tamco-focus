-- ============================================================================
-- ESH Finding Management v200: verification, closure and changes.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §13,
-- §14, §20; FM22-FM29, FM52. Only the current pending version is decided;
-- nobody verifies their own work; closing locks the whole finding; the due
-- date and the owner change only through ESH's recorded actions.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(34);

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
    when 'lim'   then 'f0c05000-0000-4000-a000-000000000006'
  end::uuid;
$$;

create or replace function pg_temp.secret(p_seed text)
returns text
language sql
immutable
as $$
  select left(p_seed || repeat('x', 64), 43);
$$;

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;

create or replace function pg_temp.id(p_name text)
returns uuid
language sql
stable
as $$
  select id from ids where name = p_name;
$$;

/*
 * An action assigned by the local Verifier, the owner's access on, an inbox
 * session for them, and a submission with a file: ready for ESH to decide.
 */
create or replace function pg_temp.submitted(p_key text, p_owner text)
returns void
language plpgsql
as $$
declare
  result jsonb;
  v_principal uuid;
  v_asset uuid;
  v_session text := pg_temp.secret('session-' || p_key);
begin
  perform pg_temp.act_as(pg_temp.uid('izzul'));
  result := public.esh_save_finding(null, jsonb_build_object(
    'title', 'v200 ' || p_key, 'description', 'Found on the v200 walk',
    'reported_on', '2026-09-10',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Put it right', 'priority', 'high',
    'owner_email', p_owner, 'due_date', '2026-12-10',
    'no_further_escalation_reason', 'test'), true);
  perform pg_temp.reset_role();
  insert into ids values (p_key, (result->>'action_id')::uuid),
                         (p_key || '_finding', (result->>'finding_id')::uuid);
  select owner_principal_id into v_principal from public.esh_finding_actions
   where id = (result->>'action_id')::uuid;
  insert into ids values (p_key || '_owner', v_principal);
  update public.esh_email_principals set access_enabled = true where id = v_principal;
  -- As if ESH released the assignment email and it went.
  update public.esh_notification_outbox set state = 'provider_accepted', sent_at = now()
   where action_id = (result->>'action_id')::uuid and event_type = 'owner_assignment';
  insert into public.esh_access_grants
    (organization_id, principal_id, purpose, token_hash, issued_reason, expires_at)
  values ('e5e50000-0000-4000-8000-000000000001', v_principal, 'owner_inbox',
          focus.esh_secret_hash(pg_temp.secret('grant-' || p_key)), 'notification',
          now() + interval '1 day');
  perform public.esh_guest_exchange(pg_temp.secret('grant-' || p_key), v_session, null, null, true);
  result := public.esh_guest_start_upload(v_session, pg_temp.id(p_key), 'after.jpg', 2048);
  v_asset := (result->>'asset_id')::uuid;
  perform public.esh_guest_finish_upload(v_session, v_asset, true, 'image/jpeg', 2048, repeat('a', 64), null);
  result := public.esh_guest_submit(v_session, pg_temp.id(p_key), 'Done, photo attached.',
                                    array[v_asset], null, 'submit-' || p_key || '-0001');
  if not coalesce((result->>'ok')::boolean, false) then
    raise exception 'submit failed: %', result;
  end if;
  insert into ids values (p_key || '_submission', (result->>'submission_id')::uuid);
end;
$$;

select pg_temp.submitted('guard', 'guard.v200@example.com');
select pg_temp.submitted('exit', 'izzul@tamco.local');

-- ---------------------------------------------------------------------------
-- 1. Who may decide (§5, FM24, FM25)
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('amer'));
select is(
  public.esh_verify_submission(pg_temp.id('guard_submission'), 'accepted', 'document_review', null, null, null, null)->>'code',
  'not_permitted',
  'somebody without the Verifier role cannot accept');
select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  public.esh_verify_submission(pg_temp.id('exit_submission'), 'accepted', 'document_review', null, null, null, null)->>'code',
  'self_verification',
  'a Verifier cannot accept a correction submitted from their own address (FM25)');
select is(
  public.esh_verify_submission(pg_temp.id('guard_submission'), 'accepted', null, null, null, null, null)->'problems',
  '["method_required"]'::jsonb,
  'accepting says how it was verified');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 2. Asking for more (FM23)
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  public.esh_verify_submission(pg_temp.id('guard_submission'), 'changes_requested', null, null, null, null, null)->'problems',
  '["note_required", "due_decision_required"]'::jsonb,
  'asking for more says what, and decides the due date out loud');
select ok(
  (public.esh_verify_submission(pg_temp.id('guard_submission'), 'changes_requested', null,
     'The photo does not show the whole walkway.', true, null, null)->>'ok')::boolean,
  'ESH asks for more, keeping the due date');
select pg_temp.reset_role();
select is(
  (select state from public.esh_action_submissions where id = pg_temp.id('guard_submission')),
  'changes_requested',
  'the submission is kept, marked as needing more');
select is(
  (select state || '/' || coalesce(current_submission_id::text, 'none') from public.esh_finding_actions where id = pg_temp.id('guard')),
  'in_progress/none',
  'the work goes back to the owner');
select is(
  (select due_at from public.esh_finding_actions where id = pg_temp.id('guard')),
  (select due_at_snapshot from public.esh_action_submissions where id = pg_temp.id('guard_submission')),
  'the due date did not quietly restart');
select ok(
  exists (select 1 from public.esh_action_messages
           where action_id = pg_temp.id('guard') and author_kind = 'staff' and kind = 'message'
             and body = 'The photo does not show the whole walkway.'),
  'the owner reads the explanation in the conversation');
select is(
  (select state from public.esh_notification_outbox
    where action_id = pg_temp.id('guard') and event_type = 'changes_requested'),
  'queued',
  'and is emailed');
select is(
  public.esh_guest_submit(pg_temp.secret('session-guard'), pg_temp.id('guard'),
    'Whole walkway now.', (select array_agg(id) from public.esh_evidence_assets where action_id = pg_temp.id('guard')),
    null, 'submit-guard-0002')->>'code',
  'files_not_ready',
  'files already sent are not quietly reused in a new submission');

-- The owner resubmits with a new photo.
do $$
declare
  started jsonb;
  result jsonb;
begin
  started := public.esh_guest_start_upload(pg_temp.secret('session-guard'), pg_temp.id('guard'), 'whole.jpg', 2048);
  perform public.esh_guest_finish_upload(pg_temp.secret('session-guard'), (started->>'asset_id')::uuid,
    true, 'image/jpeg', 2048, repeat('b', 64), null);
  result := public.esh_guest_submit(pg_temp.secret('session-guard'), pg_temp.id('guard'),
    'Whole walkway now.', array[(started->>'asset_id')::uuid], null, 'submit-guard-0003');
  insert into ids values ('guard_submission2', (result->>'submission_id')::uuid);
end
$$;

select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  public.esh_verify_submission(pg_temp.id('guard_submission'), 'accepted', 'document_review', null, null, null, null)->>'code',
  'stale_submission',
  'the old version can never be accepted (FM22)');

-- ---------------------------------------------------------------------------
-- 3. Accept and close (FM26, FM27)
-- ---------------------------------------------------------------------------

-- A second action on the same finding: accepting one does not close it.
select pg_temp.reset_role();
with second as (
  insert into public.esh_finding_actions
    (organization_id, finding_id, sequence, title, required_outcome, priority, state,
     owner_principal_id, assignment_version, due_at, created_by, assigned_at)
  select organization_id, finding_id, 2, 'Second action', 'Also this', 'normal', 'in_progress',
         owner_principal_id, 1, due_at, created_by, now()
    from public.esh_finding_actions where id = pg_temp.id('guard')
  returning id
)
insert into ids select 'second', id from second;

select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  public.esh_verify_submission(pg_temp.id('guard_submission2'), 'accepted', 'site_verification',
    'Walked the route.', null, null, null)->>'closed',
  'false',
  'accepting one of two actions leaves the finding open (FM27)');
select pg_temp.reset_role();
select is(
  (select status from public.esh_findings where id = pg_temp.id('guard_finding')),
  'open',
  'the finding stays open while any action is');
update public.esh_finding_actions set state = 'cancelled' where id = pg_temp.id('second');

-- The single-action case closes in the same step.
select pg_temp.act_as(pg_temp.uid('lim'));
select is(
  public.esh_verify_submission(pg_temp.id('exit_submission'), 'accepted', 'document_review', null, null, null, null)->>'code',
  'not_permitted',
  'a person without Finding access cannot verify, even if the owner is someone else');
select pg_temp.reset_role();

-- Lim becomes an organisation-wide Verifier to verify Izzul's own correction.
insert into public.esh_staff_access
  (organization_id, user_id, enabled, preset, scope_all_departments)
values ('e5e50000-0000-4000-8000-000000000001', pg_temp.uid('lim'), true, 'verifier', true);
select pg_temp.act_as(pg_temp.uid('lim'));
select is(
  public.esh_verify_submission(pg_temp.id('exit_submission'), 'accepted', 'document_review',
    'Photo checked.', null, null, null)->>'closed',
  'true',
  'another Verifier accepts, and the finding closes in the same step (FM26)');
select pg_temp.reset_role();
select is(
  (select status || '/' || closed_by::text from public.esh_findings where id = pg_temp.id('exit_finding')),
  'closed/' || pg_temp.uid('lim'),
  'closed, by whom');
select is(
  (select state from public.esh_action_submissions where id = pg_temp.id('exit_submission')),
  'accepted',
  'the accepted submission is the record');
select is(
  (select method || '/' || verifier_user_id::text from public.esh_verification_events
    where submission_id = pg_temp.id('exit_submission')),
  'document_review/' || pg_temp.uid('lim'),
  'with the method and the verifier');
select throws_ok(
  $$ update public.esh_verification_events set note = 'edited' where submission_id = pg_temp.id('exit_submission') $$,
  null,
  null,
  'a verification record cannot be edited');

-- The owner keeps a read-only receipt (§20).
select is(
  public.esh_guest_action(pg_temp.secret('session-exit'), pg_temp.id('exit'), null)->>'read_only',
  'true',
  'the owner can still read an accepted action, read-only');
select is(
  public.esh_guest_send_message(pg_temp.secret('session-exit'), pg_temp.id('exit'), 'Thanks', 'owner-key-9999')->>'code',
  'not_available',
  'but not write to it');
select is(
  (public.esh_guest_my_actions(pg_temp.secret('session-exit'), 'needs', null, 0, 20)->>'total')::int,
  0,
  'and it has left My Actions');

-- ---------------------------------------------------------------------------
-- 4. Reopen (FM52)
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('lim'));
select is(
  public.esh_reopen_finding(pg_temp.id('exit_finding'), '', null, null)->'problems',
  '["reason_required"]'::jsonb,
  'reopening says why');
select ok(
  (public.esh_reopen_finding(pg_temp.id('exit_finding'), 'Guard found loose again.', '2027-01-15', null)->>'ok')::boolean,
  'a Verifier reopens the finding with a new due date');
select pg_temp.reset_role();
select is(
  (select f.status || '/' || a.state from public.esh_findings f
     join public.esh_finding_actions a on a.finding_id = f.id where f.id = pg_temp.id('exit_finding')),
  'open/in_progress',
  'the finding and its action are open again');
select is(
  (select state from public.esh_action_submissions where id = pg_temp.id('exit_submission')),
  'accepted',
  'and the earlier acceptance stays in history');
select is(
  (select count(*)::int from public.esh_notification_outbox
    where action_id = pg_temp.id('exit') and event_type = 'finding_reopened'),
  1,
  'the owner is told, with fresh links minted at sending');

-- ---------------------------------------------------------------------------
-- 5. Due date and owner change only through ESH (FM28, FM29, FM13)
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzul'));
select ok(
  (public.esh_change_due(pg_temp.id('exit'), '2027-02-01', null, 'Parts on order')->>'ok')::boolean,
  'ESH changes the due date with a reason');
select pg_temp.reset_role();
select is(
  (select reason || '/' || cause from public.esh_due_date_changes
    where action_id = pg_temp.id('exit') order by changed_at desc, cause limit 1),
  'Parts on order/changed',
  'the change is recorded with its reason, the baseline kept');
select is(
  (select baseline_due_at from public.esh_finding_actions where id = pg_temp.id('exit')),
  (select baseline_due_at_snapshot from public.esh_action_submissions where id = pg_temp.id('exit_submission')),
  'the baseline due date is untouched by any change');

select pg_temp.act_as(pg_temp.uid('izzul'));
select ok(
  (public.esh_reassign_action(pg_temp.id('exit'), 'new.owner.v200@example.com', 'Moved to the night shift')->>'ok')::boolean,
  'ESH reassigns the action');
select pg_temp.reset_role();
select is(
  public.esh_guest_action(pg_temp.secret('session-exit'), pg_temp.id('exit'), null)->>'code',
  'not_available',
  'the old owner loses it at once (FM13)');
select is(
  (select count(*)::int from public.esh_action_assignments
    where action_id = pg_temp.id('exit') and ended_at is null),
  1,
  'one current owner, the old interval ended');

select * from finish();

rollback;
