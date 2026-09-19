-- ============================================================================
-- ESH Finding Management v198: email-link access for Action Owners.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §9,
-- §10, §18-§20, §43; FM03-FM15, FM40-FM45, FM105-FM107. What only the
-- database can establish: a link is spent once, scopes never widen, every
-- guest read re-checks the live assignment, and switching a contact off ends
-- everything at once.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

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
  end::uuid;
$$;

create or replace function pg_temp.dept(p_code text)
returns uuid
language sql
stable
as $$
  select id from public.departments where code = p_code;
$$;

-- A secret the shape the worker mints: 43 URL-safe characters.
create or replace function pg_temp.secret(p_seed text)
returns text
language sql
immutable
as $$
  select left(p_seed || repeat('x', 64), 43);
$$;

create or replace function pg_temp.assign(p_title text, p_owner text, p_priority text, p_due text)
returns uuid
language plpgsql
as $$
declare
  result jsonb;
begin
  result := public.esh_save_finding(null, jsonb_build_object(
    'title', p_title, 'description', 'Found on the v198 walk',
    'reported_on', '2026-09-10', 'accountable_department_id', pg_temp.dept('OPS'),
    'location', 'BR2', 'required_outcome', 'Put it right', 'priority', p_priority,
    'owner_email', p_owner, 'due_date', p_due,
    'escalation', jsonb_build_array(jsonb_build_object('level', 1, 'email', 'lead.v198@example.com'))
  ), true);
  if not coalesce((result->>'ok')::boolean, false) then
    raise exception 'assign failed: %', result;
  end if;
  return (result->>'action_id')::uuid;
end;
$$;

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;

-- ---------------------------------------------------------------------------
-- Work for one owner (two actions) and another owner (one), assigned by a
-- Verifier. Everyone starts with access off.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzul'));
insert into ids values
  ('walkway', pg_temp.assign('v198 walkway', 'Owner.V198@Example.com', 'normal', '2026-12-10')),
  ('guard',   pg_temp.assign('v198 guard', 'owner.v198@example.com', 'urgent', '2026-12-20')),
  ('label',   pg_temp.assign('v198 label', 'other.v198@example.com', 'high', '2026-12-05'));
-- ESH replies before the owner has access: the notice is held too.
select ok(
  (public.esh_post_message((select id from ids where name = 'walkway'),
     'Please include the whole walkway.', 'staff-key-0001')->>'ok')::boolean,
  'a Verifier writes in the action conversation');
select pg_temp.reset_role();

insert into ids
select 'owner', id from public.esh_email_principals where canonical_email = 'owner.v198@example.com';
insert into ids
select 'other', id from public.esh_email_principals where canonical_email = 'other.v198@example.com';
insert into ids
select 'assignment_walkway', o.id from public.esh_notification_outbox o
 where o.action_id = (select id from ids where name = 'walkway') and o.event_type = 'owner_assignment';

select is(
  (select array_agg(distinct state) from public.esh_notification_outbox
    where recipient_principal_id = (select id from ids where name = 'owner')),
  array['held_rollout'],
  'every notice for a contact whose access is off is held (FM105)');
select is(
  public.esh_dispatch_claim((select id from ids where name = 'assignment_walkway'), '{}'::jsonb)->>'code',
  'not_due',
  'the worker cannot pick up a held notification');

-- A link cannot be requested for a contact whose access is off.
do $$ begin perform public.esh_guest_request_link(null, null, 'owner.v198@example.com', 'tamco'); end $$;
select is(
  (select count(*)::int from public.esh_notification_outbox
    where recipient_principal_id = (select id from ids where name = 'owner') and event_type = 'access_link'),
  0,
  'asking for a link sends nothing while access is off, and says the same as ever');

-- ---------------------------------------------------------------------------
-- Enabling and releasing are two acts (FM106).
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('amer'));
select is(
  public.esh_set_contact_access((select id from ids where name = 'owner'), true, null)->>'code',
  'not_permitted',
  'only an administrator switches a contact on');
select is(
  public.esh_release_notification((select id from ids where name = 'assignment_walkway'))->>'code',
  'not_permitted',
  'and somebody without Finding access releases nothing');

select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  public.esh_release_notification((select id from ids where name = 'assignment_walkway'))->>'code',
  'contact_access_off',
  'ESH cannot release while the contact is still off');

select pg_temp.act_as(pg_temp.uid('admin'));
select ok(
  (public.esh_set_contact_access((select id from ids where name = 'owner'), true, 'pilot')->>'ok')::boolean,
  'an administrator switches the contact on');
select pg_temp.reset_role();
select is(
  (select count(*)::int from public.esh_notification_outbox
    where recipient_principal_id = (select id from ids where name = 'owner') and state <> 'held_rollout'),
  0,
  'switching a contact on sends nothing by itself (FM106)');

select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  public.esh_release_notification((select id from public.esh_notification_outbox
    where action_id = (select id from ids where name = 'walkway') and event_type = 'esh_reply'))->>'code',
  'assignment_first',
  'a reply notice cannot go out ahead of the assignment email it follows');
select ok(
  (public.esh_release_notification((select id from ids where name = 'assignment_walkway'))->>'ok')::boolean,
  'ESH releases the assignment email');
select pg_temp.reset_role();
select is(
  (select state from public.esh_notification_outbox
    where action_id = (select id from ids where name = 'walkway') and event_type = 'esh_reply'),
  'suppressed',
  'the held reply notice is settled by the assignment email, not sent as well');

-- With access on but the assignment still held, a new reply waits as well.
select pg_temp.act_as(pg_temp.uid('admin'));
do $$ begin perform public.esh_set_contact_access((select id from ids where name = 'other'), true, 'pilot'); end $$;
select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  public.esh_post_message((select id from ids where name = 'label'), 'Any news?', 'staff-key-0002')->>'notification',
  'held_rollout',
  'a reply to an owner whose assignment email is held is held too, access or not');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- Dispatch mints the two links at send time, stored as hashes (§22).
-- ---------------------------------------------------------------------------

select ok(
  (public.esh_dispatch_claim((select id from ids where name = 'assignment_walkway'),
     jsonb_build_object('owner_action', pg_temp.secret('action-walkway'),
                        'owner_inbox', pg_temp.secret('inbox-walkway')))->>'ok')::boolean,
  'the worker claims the released notification');
select is(
  (select array_agg(purpose order by purpose) from public.esh_access_grants
    where outbox_id = (select id from ids where name = 'assignment_walkway')),
  array['owner_action', 'owner_inbox'],
  'one grant per link: action and inbox are separate scopes (§9)');
select is(
  (select count(*)::int from public.esh_access_grants
    where token_hash in (pg_temp.secret('action-walkway'), pg_temp.secret('inbox-walkway'))),
  0,
  'no link secret is stored as itself');
select is(
  (select round(extract(epoch from (expires_at - issued_at)) / 3600)::int from public.esh_access_grants
    where token_hash = focus.esh_secret_hash(pg_temp.secret('action-walkway'))),
  24,
  'an emailed link lasts 24 hours from sending');
select is(
  public.esh_dispatch_complete((select id from ids where name = 'assignment_walkway'), true, null, false, 'smtp-1')->>'state',
  'provider_accepted',
  'accepted by the mail server is recorded as exactly that');

-- ---------------------------------------------------------------------------
-- Exchange (§19, FM40-FM43).
-- ---------------------------------------------------------------------------

select is(
  public.esh_guest_exchange(pg_temp.secret('action-walkway'), pg_temp.secret('session-a1'), null, null, false)->>'code',
  'needs_tap',
  'looking without pressing the button spends nothing');
select is(
  (select consumed_at from public.esh_access_grants
    where token_hash = focus.esh_secret_hash(pg_temp.secret('action-walkway'))),
  null,
  'so a scanner fetching the page leaves the link usable (FM40)');
select is(
  public.esh_guest_exchange(pg_temp.secret('action-walkway'), pg_temp.secret('session-a1'), null,
    'challenge-tab-1', true)->>'destination',
  '/respond/actions/' || (select id from ids where name = 'walkway'),
  'pressing it opens the action');
select is(
  public.esh_guest_exchange(pg_temp.secret('action-walkway'), pg_temp.secret('session-b1'), null, null, true)->>'code',
  'used',
  'a second browser gets nothing from the spent link (FM43)');
select ok(
  (public.esh_guest_exchange(pg_temp.secret('action-walkway'), pg_temp.secret('session-a2'), null,
     'challenge-tab-1', true)->>'ok')::boolean,
  'the same tab, having lost the answer, may ask again for two minutes');
select is(
  (select revoked_reason from public.esh_guest_sessions
    where session_hash = focus.esh_secret_hash(pg_temp.secret('session-a1'))),
  'reissued',
  'and the session it replaced is ended');

-- An action link is not an inbox (FM09).
select is(
  public.esh_guest_my_actions(pg_temp.secret('session-a2'), 'needs', null, 0, 20)->>'code',
  'no_inbox_scope',
  'an action session cannot list the owner''s other actions');
select is(
  public.esh_guest_action(pg_temp.secret('session-a2'), (select id from ids where name = 'guard'), null)->>'code',
  'not_available',
  'nor open one of them by changing the address');

-- The inbox link, redeemed on its own (FM11).
select ok(
  (public.esh_guest_exchange(pg_temp.secret('inbox-walkway'), pg_temp.secret('session-i1'), null, null, true)->>'ok')::boolean,
  'the inbox link works although the action link was spent');
select is(
  (select array_agg(value->>'reference' order by ordinality)
     from jsonb_array_elements(public.esh_guest_my_actions(pg_temp.secret('session-i1'), 'needs', null, 0, 20)->'rows')
          with ordinality),
  (select array_agg(reference order by title) from public.esh_findings
    where title in ('v198 walkway', 'v198 guard')),
  'My Actions lists both of this owner''s actions, Urgent before Normal (FM05, FM06)');
select is(
  public.esh_guest_action(pg_temp.secret('session-i1'), (select id from ids where name = 'label'), null)->>'code',
  'not_available',
  'and never another owner''s');

-- ---------------------------------------------------------------------------
-- The conversation (§11, FM16).
-- ---------------------------------------------------------------------------

select is(
  public.esh_guest_send_message(pg_temp.secret('session-i1'), (select id from ids where name = 'walkway'),
    'Done. Materials moved.', 'owner-key-0001')->>'state',
  'in_progress',
  'the owner''s first update starts the work; "Done" submits nothing');
select is(
  public.esh_guest_send_message(pg_temp.secret('session-i1'), (select id from ids where name = 'walkway'),
    'Done. Materials moved.', 'owner-key-0001')->>'duplicate',
  'true',
  'a second press with the same key is the same message');
select is(
  (select count(*)::int from public.esh_action_messages
    where action_id = (select id from ids where name = 'walkway')),
  2,
  'one message from ESH and one from the owner');
select is(
  (select jsonb_array_length(public.esh_guest_action(pg_temp.secret('session-i1'),
     (select id from ids where name = 'walkway'), null)->'messages')),
  2,
  'the owner reads the whole conversation');
-- Both messages were sent in this one transaction, so they share a time:
-- pick ESH's by its author, not by position.
select is(
  (select m->>'author_email'
     from jsonb_array_elements(public.esh_guest_action(pg_temp.secret('session-i1'),
            (select id from ids where name = 'walkway'), null)->'messages') m
    where m->>'author_kind' = 'staff'),
  null,
  'without the ESH author''s address');

select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  (select last_update_type from public.esh_register_rows
    where action_id = (select id from ids where name = 'walkway')),
  'owner_message',
  'the register counts the owner''s update as the last update');
select pg_temp.act_as(pg_temp.uid('amer'));
select is((select count(*)::int from public.esh_action_messages), 0,
  'somebody without Finding access reads no conversation');
select throws_ok(
  $$ select count(*) from public.esh_access_grants $$,
  '42501',
  null,
  'no signed-in person reads link grants');
select throws_ok(
  $$ select public.esh_guest_exchange('x', 'y', null, null, true) $$,
  '42501',
  null,
  'nor calls the guest boundary directly');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- Live checks: reassignment (FM13, FM14) and another organisation (FM10).
-- ---------------------------------------------------------------------------

update public.esh_finding_actions set
  owner_principal_id = (select id from ids where name = 'other'),
  assignment_version = assignment_version + 1
 where id = (select id from ids where name = 'walkway');

select is(
  public.esh_guest_action(pg_temp.secret('session-i1'), (select id from ids where name = 'walkway'), null)->>'code',
  'not_available',
  'a reassigned action is gone for its old owner at once');
select is(
  (public.esh_guest_my_actions(pg_temp.secret('session-i1'), 'needs', null, 0, 20)->'counts'->>'needs')::int,
  1,
  'while their other action stays in their inbox');

insert into public.organizations (id, slug, name) values ('e5e50000-0000-4000-8000-000000000002', 'other-org', 'Other');
insert into public.esh_email_principals (id, organization_id, display_email, canonical_email, access_enabled)
values ('e5e50000-0000-4000-8000-0000000000a2', 'e5e50000-0000-4000-8000-000000000002',
        'owner.v198@example.com', 'owner.v198@example.com', true);
insert into public.esh_findings (id, organization_id, reference, title, status, created_by, source)
values ('e5e50000-0000-4000-8000-0000000000f2', 'e5e50000-0000-4000-8000-000000000002', 'F-001',
        'Other organisation finding', 'open', pg_temp.uid('izzul'), 'import');
insert into public.esh_finding_actions
  (organization_id, finding_id, title, required_outcome, priority, state, owner_principal_id,
   assignment_version, due_at, created_by)
values ('e5e50000-0000-4000-8000-000000000002', 'e5e50000-0000-4000-8000-0000000000f2', 'Other',
        'Other', 'urgent', 'assigned', 'e5e50000-0000-4000-8000-0000000000a2', 1, now(), pg_temp.uid('izzul'));
select is(
  (public.esh_guest_my_actions(pg_temp.secret('session-i1'), 'needs', null, 0, 20)->>'total')::int,
  1,
  'the same address in another organisation brings nothing across (FM10)');

-- ---------------------------------------------------------------------------
-- Recovery (§19, FM42, FM44).
-- ---------------------------------------------------------------------------

select is(
  public.esh_guest_request_link(null, pg_temp.secret('action-walkway'), null, null)->>'ok',
  'true',
  'a spent link can ask for a fresh one');
select is(
  (select link_intents from public.esh_notification_outbox
    where event_type = 'access_link' order by created_at desc limit 1),
  '["owner_inbox"]'::jsonb,
  'for an action no longer theirs it is an inbox link, never the action');
do $$
begin
  perform public.esh_guest_request_link(null, null, 'OWNER.v198@example.com', 'tamco');
  perform public.esh_guest_request_link(null, null, 'owner.v198@example.com', 'tamco');
  perform public.esh_guest_request_link(null, null, 'owner.v198@example.com', 'tamco');
end
$$;
select is(
  (select count(*)::int from public.esh_notification_outbox
    where event_type = 'access_link' and recipient_principal_id = (select id from ids where name = 'owner')),
  3,
  'three requests an hour at most, so nobody can flood a mailbox');
select is(
  public.esh_guest_request_link(null, null, 'nobody.v198@example.com', 'tamco'),
  '{"ok": true}'::jsonb,
  'an unknown address gets the same answer as a known one');

-- ---------------------------------------------------------------------------
-- Switching a contact off ends everything at once (FM107).
-- ---------------------------------------------------------------------------

insert into public.esh_access_grants
  (organization_id, principal_id, purpose, token_hash, issued_reason, issued_at, expires_at)
values
  ('e5e50000-0000-4000-8000-000000000001', (select id from ids where name = 'owner'), 'owner_inbox',
   focus.esh_secret_hash(pg_temp.secret('expired-inbox')), 'recovery',
   now() - interval '1 hour', now() - interval '30 minutes');
select is(
  public.esh_guest_exchange(pg_temp.secret('expired-inbox'), pg_temp.secret('session-x1'), null, null, true)->>'code',
  'expired',
  'an expired link opens nothing and offers a fresh one (FM42)');

select pg_temp.act_as(pg_temp.uid('admin'));
select ok(
  (public.esh_set_contact_access((select id from ids where name = 'owner'), false, 'left the company')->>'ok')::boolean,
  'an administrator switches the contact off');
select pg_temp.reset_role();
select is(
  public.esh_guest_my_actions(pg_temp.secret('session-i1'), 'needs', null, 0, 20)->>'code',
  'no_session',
  'their session stops working on the next request');
select is(
  (select count(*)::int from public.esh_notification_outbox
    where recipient_principal_id = (select id from ids where name = 'owner') and state = 'queued'),
  0,
  'nothing waits to be sent to them');
select is(
  (select count(*)::int from public.esh_finding_actions
    where owner_principal_id = (select id from ids where name = 'owner')
      and state in ('assigned', 'in_progress')),
  1,
  'and their work is untouched, for ESH to deal with');

select * from finish();

rollback;
