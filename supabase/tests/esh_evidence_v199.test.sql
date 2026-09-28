-- ============================================================================
-- ESH Finding Management v199: evidence and submissions.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §12,
-- §20.4, §22, §23; FM16-FM22, FM46, FM49, FM51. A message is not a
-- submission; a submission is a snapshot that cannot be edited, needs the
-- evidence its action asks for, and is one of a kind while pending; files are
-- reachable only through the action they belong to.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

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

-- An action for each of two owners, their access on, and a session each,
-- opened from an inbox link the way the worker would send one.
create or replace function pg_temp.arrange(p_key text, p_owner text)
returns void
language plpgsql
as $$
declare
  result jsonb;
  v_principal uuid;
begin
  perform pg_temp.act_as(pg_temp.uid('izzul'));
  result := public.esh_save_finding(null, jsonb_build_object(
    'title', 'v199 ' || p_key, 'description', 'Found on the v199 walk',
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
  update public.esh_email_principals set access_enabled = true where id = v_principal;
  insert into public.esh_access_grants
    (organization_id, principal_id, purpose, token_hash, issued_reason, expires_at)
  values ('e5e50000-0000-4000-8000-000000000001', v_principal, 'owner_inbox',
          focus.esh_secret_hash(pg_temp.secret('grant-' || p_key)), 'notification',
          now() + interval '1 day');
  result := public.esh_guest_exchange(pg_temp.secret('grant-' || p_key),
                                      pg_temp.secret('session-' || p_key), null, null, true);
  if not coalesce((result->>'ok')::boolean, false) then
    raise exception 'exchange failed: %', result;
  end if;
end;
$$;

select pg_temp.arrange('guard', 'guard.v199@example.com');
select pg_temp.arrange('spill', 'spill.v199@example.com');

-- A file the way the server records one after reading its bytes.
create or replace function pg_temp.upload(p_key text, p_name text)
returns uuid
language plpgsql
as $$
declare
  started jsonb;
begin
  started := public.esh_guest_start_upload(pg_temp.secret('session-' || p_key), pg_temp.id(p_key),
                                           p_name, 2048);
  perform public.esh_guest_finish_upload(pg_temp.secret('session-' || p_key),
    (started->>'asset_id')::uuid, true, 'image/jpeg', 2048, repeat('a', 64), null);
  return (started->>'asset_id')::uuid;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Uploading (§23)
-- ---------------------------------------------------------------------------

select is(
  public.esh_guest_start_upload(pg_temp.secret('session-guard'), pg_temp.id('guard'), 'tool.exe', 10)->>'code',
  'type_not_allowed',
  'an executable cannot even start uploading');
select is(
  public.esh_guest_start_upload(pg_temp.secret('session-guard'), pg_temp.id('guard'), 'big.pdf', 26214401)->>'code',
  'too_large',
  'nor a file over 25 MB (v226)');
-- The size the specification actually asks for has to be accepted, or raising
-- the limit in three other places achieves nothing.
select ok(
  (public.esh_guest_start_upload(pg_temp.secret('session-guard'), pg_temp.id('guard'),
                                 'phone-photo.jpg', 26214400)->>'ok')::boolean,
  'and a 25 MB photograph is accepted');
select is(
  public.esh_guest_start_upload(pg_temp.secret('session-spill'), pg_temp.id('guard'), 'photo.jpg', 10)->>'code',
  'not_available',
  'another owner cannot upload to this action');

insert into ids values ('photo', pg_temp.upload('guard', 'Walkway after.jpg'));
select matches(
  (select object_key from public.esh_evidence_assets where id = pg_temp.id('photo')),
  '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$',
  'the stored object is named by ids, never by the uploaded file name');
select is(
  (select state || '/' || scan_state from public.esh_evidence_assets where id = pg_temp.id('photo')),
  'ready/not_scanned',
  'a checked file is ready, and honestly not scanned');
select is(
  public.esh_guest_file(pg_temp.secret('session-spill'), pg_temp.id('photo'))->>'code',
  'not_available',
  'another owner cannot open it, whatever id they send (FM46)');

-- ---------------------------------------------------------------------------
-- 2. Submit needs the evidence the action asks for (§12, FM20)
-- ---------------------------------------------------------------------------

select is(
  public.esh_guest_submit(pg_temp.secret('session-guard'), pg_temp.id('guard'),
    'Done.', '{}', null, 'submit-key-0001')->'problems',
  '["file_required"]'::jsonb,
  'typing Done without a file does not pass a file-required rule');
select is(
  public.esh_guest_submit(pg_temp.secret('session-guard'), pg_temp.id('guard'),
    '', array[pg_temp.id('photo')], null, 'submit-key-0002')->'problems',
  '["result_required"]'::jsonb,
  'and a file needs a few words of result');
select is(
  (select count(*)::int from public.esh_action_messages where action_id = pg_temp.id('guard')),
  0,
  'a refused submission writes nothing');

-- ---------------------------------------------------------------------------
-- 3. An update is a message; the owner chooses it for review (FM16, FM18)
-- ---------------------------------------------------------------------------

insert into ids
select 'update', (public.esh_guest_send_message(pg_temp.secret('session-guard'), pg_temp.id('guard'),
  'The walkway is clear.', 'update-key-0001', array[pg_temp.id('photo')])->>'message_id')::uuid;
select is(
  (select message_id from public.esh_evidence_assets where id = pg_temp.id('photo')),
  pg_temp.id('update'),
  'the photo went with the update');
select is(
  (select state from public.esh_finding_actions where id = pg_temp.id('guard')),
  'in_progress',
  'an update, even "clear", does not submit anything');
select is(
  public.esh_guest_remove_upload(pg_temp.secret('session-guard'), pg_temp.id('photo'))->>'code',
  'not_available',
  'a file that was sent cannot be removed');
select throws_ok(
  $$ update public.esh_evidence_assets set original_name = 'renamed.jpg' where id = pg_temp.id('photo') $$,
  'P0001',
  'a file sent in a message is part of the record and cannot change',
  'not even directly in the database');

select is(
  public.esh_guest_submit(pg_temp.secret('session-spill'), pg_temp.id('spill'),
    null, '{}', pg_temp.id('update'), 'submit-key-0003')->>'code',
  'message_not_yours',
  'nobody can submit another owner''s update');
insert into ids
select 'submission', (public.esh_guest_submit(pg_temp.secret('session-guard'), pg_temp.id('guard'),
  null, '{}', pg_temp.id('update'), 'submit-key-0004')->>'submission_id')::uuid;
select is(
  (select version || '/' || state || '/' || result_text from public.esh_action_submissions
    where id = pg_temp.id('submission')),
  '1/pending/The walkway is clear.',
  'the chosen update becomes version 1, without retyping it');
select is(
  (select evidence_asset_ids from public.esh_action_submissions where id = pg_temp.id('submission')),
  array[pg_temp.id('photo')],
  'with exactly that update''s file, and nothing else');
select is(
  (select state from public.esh_finding_actions where id = pg_temp.id('guard')),
  'awaiting_verification',
  'the action now waits for ESH');
select is(
  public.esh_guest_submit(pg_temp.secret('session-guard'), pg_temp.id('guard'),
    null, '{}', pg_temp.id('update'), 'submit-key-0004')->>'duplicate',
  'true',
  'a second press is the same submission (FM51)');
select is(
  public.esh_guest_submit(pg_temp.secret('session-guard'), pg_temp.id('guard'),
    'Also swept.', '{}', null, 'submit-key-0005')->>'code',
  'already_submitted',
  'and nothing else can be submitted while one is waiting');
select throws_ok(
  $$ update public.esh_action_submissions set result_text = 'edited' where id = pg_temp.id('submission') $$,
  'P0001',
  'a submission is a snapshot and cannot be edited',
  'the snapshot cannot be edited');

select is(
  (select array_agg(recipient_user_id) from public.esh_notification_outbox
    where submission_id = pg_temp.id('submission') and event_type = 'submission_received'),
  array[pg_temp.uid('izzul')],
  'the Verifier who covers the finding is told (FM17)');

-- The conversation carries on during review (FM21).
select ok(
  (public.esh_guest_send_message(pg_temp.secret('session-guard'), pg_temp.id('guard'),
     'Photo of the other side coming.', 'update-key-0002')->>'ok')::boolean,
  'the owner can still write while ESH reviews');
select is(
  (select message_id from public.esh_action_submissions where id = pg_temp.id('submission')),
  pg_temp.id('update'),
  'and the submission under review does not change');

-- ---------------------------------------------------------------------------
-- 4. Withdraw and resubmit (FM22)
-- ---------------------------------------------------------------------------

select ok(
  (public.esh_guest_withdraw(pg_temp.secret('session-guard'), pg_temp.id('guard'), 'Adding a photo')->>'ok')::boolean,
  'the owner withdraws to revise');
select is(
  (select state from public.esh_action_submissions where id = pg_temp.id('submission')),
  'withdrawn',
  'the first version stays, marked withdrawn, so it can never be accepted');
select is(
  (select event_type from public.esh_notification_outbox
    where submission_id = pg_temp.id('submission') and event_type = 'submission_withdrawn'),
  'submission_withdrawn',
  'ESH is told it was withdrawn');
select is(
  public.esh_dispatch_claim(
    (select id from public.esh_notification_outbox
      where submission_id = pg_temp.id('submission') and event_type = 'submission_received'),
    '{}'::jsonb)->>'code',
  'suppressed',
  'and the unsent "please review" for it is not sent');

insert into ids values ('photo2', pg_temp.upload('guard', 'Other side.png'));
select is(
  (public.esh_guest_submit(pg_temp.secret('session-guard'), pg_temp.id('guard'),
     'Both sides clear.', array[pg_temp.id('photo2')], null, 'submit-key-0006')->>'version')::int,
  2,
  'the revision is version 2');
select is(
  (select count(*)::int from public.esh_action_submissions
    where action_id = pg_temp.id('guard') and state = 'pending'),
  1,
  'one submission waits at a time');

-- ---------------------------------------------------------------------------
-- 5. Original evidence, and who reads what (§20.4)
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzul'));
insert into ids
select 'original', (public.esh_start_upload(pg_temp.id('guard_finding'), null, 'original',
  'Before.jpg', 4096)->>'asset_id')::uuid;
select ok(
  (public.esh_finish_upload(pg_temp.id('original'), true, 'image/jpeg', 4096, repeat('b', 64), null)->>'ok')::boolean,
  'ESH adds original evidence to the finding');
select pg_temp.reset_role();
select is(
  public.esh_guest_file(pg_temp.secret('session-guard'), pg_temp.id('original'))->>'name',
  'Before.jpg',
  'the owner can open their finding''s original evidence');
select is(
  public.esh_guest_file(pg_temp.secret('session-spill'), pg_temp.id('original'))->>'code',
  'not_available',
  'another finding''s owner cannot');

select pg_temp.act_as(pg_temp.uid('amer'));
select is((select count(*)::int from public.esh_evidence_assets), 0,
  'somebody without Finding access reads no evidence records');
select throws_ok(
  $$ select public.esh_guest_file('x', gen_random_uuid()) $$,
  '42501',
  null,
  'nor calls the guest file check');
select pg_temp.act_as(pg_temp.uid('izzul'));
select is(
  (select count(*)::int from public.esh_evidence_assets
    where finding_id = pg_temp.id('guard_finding') and state = 'ready'),
  3,
  'ESH reads the finding''s files: two photos and the original');
select is(
  (select needs_attention::text || '/' || last_update_type from public.esh_register_rows
    where finding_id = pg_temp.id('guard_finding')),
  'true/submission_created',
  'the register puts a submission in front of ESH');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 6. An evidence exception is ESH's decision (§12)
-- ---------------------------------------------------------------------------

update public.esh_finding_actions set evidence_rule = 'no_file_exception',
  evidence_exception_reason = 'Verified on site'
 where id = pg_temp.id('spill');
select ok(
  (public.esh_guest_submit(pg_temp.secret('session-spill'), pg_temp.id('spill'),
     'Kit restocked.', '{}', null, 'submit-key-0007')->>'ok')::boolean,
  'with an exception, a written result is enough');

select * from finish();

rollback;
