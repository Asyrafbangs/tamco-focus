-- ============================================================================
-- ESH Finding Management v206: several actions at once, each still its own.
--
-- §40; FM91-FM96. What only the database can establish: a batch is a batch of
-- single actions, nothing in it finishes anything, an item that is no longer
-- the owner's is skipped rather than written, a partial failure keeps what
-- worked, and the same press twice is one operation.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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
create or replace function pg_temp.secret(p_seed text)
returns text language sql immutable as $$
  select left(p_seed || repeat('x', 64), 43);
$$;
create or replace function pg_temp.dept(p_code text)
returns uuid language sql stable as $$
  select id from public.departments where code = p_code;
$$;
create or replace function pg_temp.assign(p_title text, p_due text)
returns uuid language plpgsql as $$
declare
  result jsonb;
begin
  result := public.esh_save_finding(null, jsonb_build_object(
    'title', p_title, 'description', 'Found on the v206 walk',
    'reported_on', '2026-09-10', 'accountable_department_id', pg_temp.dept('OPS'),
    'location', 'BR2', 'required_outcome', 'Put it right', 'priority', 'normal',
    'owner_email', 'owner.v206@example.com', 'due_date', p_due,
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true);
  if not coalesce((result->>'ok')::boolean, false) then
    raise exception 'assign failed: %', result;
  end if;
  return (result->>'action_id')::uuid;
end;
$$;

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;

select has_table('public', 'esh_bulk_operations', 'a bulk operation is a record');
select has_table('public', 'esh_bulk_operation_items', 'and so is each item of it');
select ok((select relrowsecurity from pg_class where oid = 'public.esh_bulk_operations'::regclass),
          'bulk records have row security');
select ok(not has_function_privilege('authenticated',
            'public.esh_guest_bulk_update(text,uuid[],text,text)', 'EXECUTE'),
          'a signed-in browser cannot call a guest bulk routine directly');

-- Three actions for one owner, and the owner's own inbox link.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids values
  ('one', pg_temp.assign('v206 walkway', '2026-12-10')),
  ('two', pg_temp.assign('v206 guard', '2026-12-12')),
  ('three', pg_temp.assign('v206 label', '2026-12-14'));
select pg_temp.reset_role();

insert into ids
select 'owner', id from public.esh_email_principals where canonical_email = 'owner.v206@example.com';

-- Two of them can be answered in words; the third wants a photograph, which
-- is what makes the partial failure below a real one.
update public.esh_finding_actions set
  evidence_rule = 'no_file_exception',
  evidence_exception_reason = 'Fixture: the work speaks for itself'
 where id in (select id from ids where name in ('one', 'two'));

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access((select id from ids where name = 'owner'), true,
            'v206 fixture')->>'ok')::boolean,
          'the contact is enabled for the fixture');
select pg_temp.reset_role();

insert into public.esh_access_grants
  (organization_id, principal_id, purpose, token_hash, issued_reason, expires_at)
select organization_id, id, 'owner_inbox', focus.esh_secret_hash(pg_temp.secret('inbox-v206')),
       'notification', now() + interval '1 day'
  from public.esh_email_principals where canonical_email = 'owner.v206@example.com';
insert into public.esh_access_grants
  (organization_id, principal_id, purpose, action_id, assignment_version, token_hash,
   issued_reason, expires_at)
select p.organization_id, p.id, 'owner_action', (select id from ids where name = 'one'), 1,
       focus.esh_secret_hash(pg_temp.secret('action-v206')), 'notification',
       now() + interval '1 day'
  from public.esh_email_principals p where p.canonical_email = 'owner.v206@example.com';

select ok((public.esh_guest_exchange(pg_temp.secret('inbox-v206'), pg_temp.secret('session-inbox'),
            null, null, true)->>'ok')::boolean,
          'the owner opens their My Actions link');
select ok((public.esh_guest_exchange(pg_temp.secret('action-v206'), pg_temp.secret('session-action'),
            null, null, true)->>'ok')::boolean,
          'and, separately, a single action link');

-- An action link does not become a batch tool by being asked nicely (FM96).
select is(public.esh_guest_bulk_update(pg_temp.secret('session-action'),
            array[(select id from ids where name = 'one')], 'Working on it.', 'k-action-0001')->>'code',
          'not_available',
          'bulk work belongs to the inbox link, not an action link');

-- One update, three actions, three separate messages (FM92).
select is((public.esh_guest_bulk_update(pg_temp.secret('session-inbox'),
            array[(select id from ids where name = 'one'),
                  (select id from ids where name = 'two'),
                  (select id from ids where name = 'three')],
            'Parts ordered; fitting on Friday.', 'k-update-0001')->>'succeeded')::text, '3',
          'the update reaches every chosen action');
select is((select count(*)::integer from public.esh_action_messages
            where body = 'Parts ordered; fitting on Friday.' and author_kind = 'owner'), 3,
          'as three messages, each attributed to the owner');
select is((select count(*)::integer from public.esh_action_submissions), 0,
          'and an update submits nothing at all (FM92)');
select is((select count(distinct state)::integer from public.esh_finding_actions
            where id in (select id from ids where name in ('one', 'two', 'three'))), 1,
          'every one of them moved the same way');

-- The same press twice is the same operation (FM95).
select is((public.esh_guest_bulk_update(pg_temp.secret('session-inbox'),
            array[(select id from ids where name = 'one')],
            'Parts ordered; fitting on Friday.', 'k-update-0001')->>'succeeded')::text, '3',
          'a repeated operation key returns the first answer');
select is((select count(*)::integer from public.esh_action_messages
            where body = 'Parts ordered; fitting on Friday.'), 3,
          'and writes nothing a second time');

-- Asking for more time is asking (FM92).
insert into ids select 'due_before', null;
select is((public.esh_guest_bulk_extension(pg_temp.secret('session-inbox'),
            array[(select id from ids where name = 'one'),
                  (select id from ids where name = 'two')],
            'Waiting on the contractor.', '2027-01-15', 'k-time-0001')->>'succeeded')::text, '2',
          'the request reaches both actions');
select is((select count(*)::integer from public.esh_action_messages
            where proposed_due_date = '2027-01-15'), 2,
          'each with the date being asked for on the record');
select is((select count(*)::integer from public.esh_finding_actions
            where id in (select id from ids where name in ('one', 'two'))
              and due_at::date = '2026-12-10'), 1,
          'and no official deadline moves because somebody asked');

-- Submitting several is several submissions (FM94).
select is((public.esh_guest_bulk_submit(pg_temp.secret('session-inbox'), jsonb_build_array(
    jsonb_build_object('action_id', (select id from ids where name = 'one'),
                       'result_text', 'Guard refitted and tested.'),
    jsonb_build_object('action_id', (select id from ids where name = 'two'),
                       'result_text', 'Label replaced.')
  ), 'k-submit-0001')->>'succeeded')::text, '2',
  'each chosen action is submitted');
select is((select count(*)::integer from public.esh_action_submissions where state = 'pending'), 2,
          'as two separate submissions, each waiting on its own verification');
select is((select count(distinct action_id)::integer from public.esh_action_submissions), 2,
          'one per action, never one for the batch');
select is((select count(*)::integer from public.esh_finding_actions
            where state = 'awaiting_verification'
              and id in (select id from ids where name in ('one', 'two'))), 2,
          'and both actions are with ESH now');

-- Talking is always allowed, even about an action that is with ESH: what a
-- batch cannot do is submit it again (§40).
select is((public.esh_guest_bulk_update(pg_temp.secret('session-inbox'),
            array[(select id from ids where name = 'one'),
                  (select id from ids where name = 'three')],
            'One more note.', 'k-update-0002')->>'succeeded')::text, '2',
          'an update still reaches an action that is awaiting review');
select is((select count(*)::integer from public.esh_action_messages
            where body = 'One more note.'), 2,
          'as a message on each, the way the single-action chat allows');

-- A partial failure keeps what worked and names what did not (FM95).
select is((public.esh_guest_bulk_submit(pg_temp.secret('session-inbox'), jsonb_build_array(
    jsonb_build_object('action_id', (select id from ids where name = 'three'),
                       'result_text', 'Done.'),
    jsonb_build_object('action_id', (select id from ids where name = 'one'),
                       'result_text', 'Done again.')
  ), 'k-submit-0002')->>'failed')::text, '1',
  'the row that needed a photograph is a failure of its own');
select is((select code from public.esh_bulk_operation_items item
            join public.esh_bulk_operations operation on operation.id = item.operation_id
           where operation.operation_key = 'k-submit-0002'
             and item.action_id = (select id from ids where name = 'three')), 'evidence_incomplete',
          'and says what it needed');
select is((select skipped from public.esh_bulk_operations where operation_key = 'k-submit-0002'), 1,
          'while the one already with ESH is skipped, not failed');
select is((select state from public.esh_bulk_operation_items item
            join public.esh_bulk_operations operation on operation.id = item.operation_id
           where operation.operation_key = 'k-submit-0002'
             and item.action_id = (select id from ids where name = 'one')), 'skipped',
          'per item, so the owner knows which ones they still owe');

-- What was done cannot be rewritten afterwards.
select throws_ok($$
  update public.esh_bulk_operations set operation_key = 'rewritten'
   where operation_key = 'k-update-0001'
$$, '42501', null, 'a bulk record cannot be rewritten into another operation');
select throws_ok($$
  delete from public.esh_bulk_operation_items
   where operation_id = (select id from public.esh_bulk_operations
                          where operation_key = 'k-update-0001')
$$, '42501', null, 'and its items cannot be removed');

select * from finish();
rollback;
