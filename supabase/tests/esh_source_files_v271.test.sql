-- ============================================================================
-- ESH Finding Management v271: sent evidence can be scanned, and the file that
-- came off the camera is kept.
--
-- The first six assertions exist because v270 shipped a scanner that could not
-- scan anything real. Every file that matters is sent in a message, and a sent
-- row was refused every update by one guard and pinned to `state = 'ready'` by
-- one constraint. v270's own fixture never sent a file, so eleven assertions
-- passed over a feature that raised an exception on its first production row.
--
-- Hence the fixture here: every scanning assertion runs against a file that
-- has been sent, which is the only kind there will ever be.
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

create temporary table ids (name text primary key, id uuid);
grant all on ids to authenticated;
create or replace function pg_temp.v271(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

-- The ESH user who files the finding, and a colleague with no ESH access.
-- Spelled out rather than held in a psql variable: scripts/check-sql-syntax.mjs
-- parses these files with a real parser, which does not speak psql's \set.

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids
select 'action', (public.esh_save_finding(null, jsonb_build_object(
  'title', 'v271 a photograph worth keeping', 'description', 'Evidence will be attached.',
  'reported_on', '2026-10-25',
  'accountable_department_id', (select id from public.departments where code = 'OPS'),
  'location', 'BR2', 'required_outcome', 'Correct it.', 'priority', 'normal',
  'risk_level', 'medium',
  'owner_email', 'owner.v271@example.com', 'due_date', '2026-12-10',
  'escalation', '[]'::jsonb, 'no_further_escalation_reason', 'Fixture.'
), true)->>'action_id')::uuid;
insert into ids
select 'finding', finding_id from public.esh_finding_actions where id = pg_temp.v271('action');
select pg_temp.reset_role();

/*
 * A ready file on the action. `p_sent` decides whether it is part of the
 * record, which is the distinction every assertion below turns on. `p_owner`
 * makes it the Action Owner's upload rather than ESH's.
 */
create or replace function pg_temp.attach(p_name text, p_sent boolean, p_owner boolean default false)
returns uuid language plpgsql as $$
declare
  a public.esh_finding_actions;
  v_id uuid;
  v_message uuid;
begin
  select * into a from public.esh_finding_actions where id = pg_temp.v271('action');
  insert into public.esh_evidence_assets
    (organization_id, finding_id, action_id, purpose, object_key, original_name,
     declared_size, content_type, size_bytes, content_sha256, state, uploader_kind,
     uploader_user_id, uploader_principal_id, ready_at)
  values
    (a.organization_id, a.finding_id, a.id, 'message',
     'v271/' || p_name || '/' || gen_random_uuid(), p_name || '.jpg',
     900000, 'image/jpeg', 900000, encode(sha256(p_name::bytea), 'hex'), 'ready',
     case when p_owner then 'owner' else 'staff' end,
     case when p_owner then null else 'f0c05000-0000-4000-a000-000000000002'::uuid end,
     case when p_owner then a.owner_principal_id else null end,
     now())
  returning id into v_id;

  if p_sent then
    insert into public.esh_action_messages
      (organization_id, action_id, author_kind, author_user_id, author_email, body, client_key)
    values
      (a.organization_id, a.id, 'staff', 'f0c05000-0000-4000-a000-000000000002',
       'esh@example.com', 'Here is the evidence.', 'v271-' || p_name || '-' || gen_random_uuid())
    returning id into v_message;
    update public.esh_evidence_assets set message_id = v_message where id = v_id;
  end if;
  return v_id;
end;
$$;

insert into ids select 'sent', pg_temp.attach('walkway', true);
insert into ids select 'doomed', pg_temp.attach('invoice', true);
insert into ids select 'draft', pg_temp.attach('notyet', false);
insert into ids select 'theirs', pg_temp.attach('ownerphoto', false, true);
insert into ids select 'stale', pg_temp.attach('abandoned', true);

-- ---------------------------------------------------------------------------
-- The defect: a sent file is the only kind of file there is
-- ---------------------------------------------------------------------------

create temporary table v271_claim as
  select public.esh_scan_claim(100) as result;
grant all on v271_claim to authenticated;

select ok(
  (select result->'files' @> jsonb_build_array(
            jsonb_build_object('id', pg_temp.v271('sent')))
     from v271_claim),
  'a file that has been sent can be claimed for scanning at all');

select is(
  (select scan_state from public.esh_evidence_assets where id = pg_temp.v271('sent')),
  'pending',
  'and marking it pending is not refused as a change to the record');

select is(
  (public.esh_scan_record(pg_temp.v271('sent'), 'clean'))->>'ok',
  'true',
  'a verdict on a sent file is recorded');

/*
 * Quarantine, on a sent file. v199 pinned a sent row to `state = 'ready'`,
 * which is precisely the state v270's quarantine moves out of, so this is the
 * assertion that would have caught the second half of the defect.
 */
select ok(
  (public.esh_scan_record(pg_temp.v271('doomed'), 'infected', 'Eicar-Test-Signature')
   ->>'ok')::boolean,
  'an infected sent file is quarantined');

select is(
  (select scan_state || ' / ' || state from public.esh_evidence_assets
    where id = pg_temp.v271('doomed')),
  'infected / rejected',
  'by the state every existing read already excludes');

-- ---------------------------------------------------------------------------
-- What the guard still guards
-- ---------------------------------------------------------------------------

select throws_ok(
  format('update public.esh_evidence_assets set state = ''removed'' where id = %L',
         pg_temp.v271('sent')),
  null,
  'a sent file changes state only when a scanner quarantines it',
  'a sent file still cannot be quietly marked removed');

select throws_ok(
  format('update public.esh_evidence_assets set original_name = ''swapped.jpg'' where id = %L',
         pg_temp.v271('sent')),
  null,
  'a file sent in a message is part of the record and cannot change',
  'and the record itself is still immutable');

-- ---------------------------------------------------------------------------
-- Keeping the file that came off the camera
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

create temporary table v271_start as
  select public.esh_start_source(pg_temp.v271('sent'), 'walkway.jpg', 9000000) as result;
grant all on v271_start to authenticated;

select is(
  (select e.source_state from public.esh_evidence_assets e where e.id = pg_temp.v271('sent')),
  'pending',
  'a source file is pending until its bytes are accounted for');

select is(
  (select e.source_object_key from public.esh_evidence_assets e where e.id = pg_temp.v271('sent')),
  (select e.object_key || '.source.jpg' from public.esh_evidence_assets e
    where e.id = pg_temp.v271('sent')),
  'and goes to one object derived from the copy, so a retry overwrites rather than orphans');

/*
 * Not claimable while pending. A file scanned now and never again would be a
 * file whose source copy nobody ever looked at, reported as clean.
 *
 * The claim runs as the worker does -- `esh_scan_claim` is granted to
 * service_role and nothing else, which is why these two assertions step out
 * of the ESH session rather than calling it as a person.
 */
select pg_temp.reset_role();
create temporary table v271_while_pending as
  select public.esh_scan_claim(100) as result;
grant all on v271_while_pending to authenticated;
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

select is(
  (select count(*)::integer
     from v271_while_pending, jsonb_array_elements(result->'files') f
    where (f->>'id')::uuid = pg_temp.v271('sent')),
  0,
  'and is left out of the scan queue until it has arrived');

select is(
  public.esh_record_source(pg_temp.v271('sent'), true, 9000000,
                           repeat('a', 64))->>'state',
  'kept',
  'bytes that are accounted for and larger than the copy are kept');

select is(
  (select e.source_size_bytes || ' / ' || e.size_bytes from public.esh_evidence_assets e
    where e.id = pg_temp.v271('sent')),
  '9000000 / 900000',
  'with its own size beside the copy''s');

/*
 * And the scan starts over. The copy was already called clean, but a canvas
 * re-encode cannot carry what the camera's file carried, so the bytes a
 * scanner has looked at are no longer the bytes being kept.
 */
select is(
  (select e.scan_state || ' / ' || e.scan_attempts from public.esh_evidence_assets e
    where e.id = pg_temp.v271('sent')),
  'not_scanned / 0',
  'and the scanner is sent back, because it has not seen these bytes');

select pg_temp.reset_role();
create temporary table v271_once_kept as
  select public.esh_scan_claim(100) as result;
grant all on v271_once_kept to authenticated;
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

select is(
  (select f->>'object_key'
     from v271_once_kept, jsonb_array_elements(result->'files') f
    where (f->>'id')::uuid = pg_temp.v271('sent')),
  (select e.source_object_key from public.esh_evidence_assets e
    where e.id = pg_temp.v271('sent')),
  'which is the source file it is handed, not the copy');

-- ---------------------------------------------------------------------------
-- A source upload nobody finished
--
-- The browser records its own failures, but a phone that goes into a pocket
-- mid-upload records nothing. Without an expiry, that row is 'pending' for
-- ever and never scanned at all -- a worse outcome than the compressed copy
-- being the thing a scanner looks at.
-- ---------------------------------------------------------------------------

select is(
  public.esh_start_source(pg_temp.v271('stale'), 'abandoned.jpg', 9000000)->>'ok',
  'true',
  'a source upload begins');

select pg_temp.reset_role();
update public.esh_evidence_assets
   set source_started_at = now() - interval '3 hours'
 where id = pg_temp.v271('stale');
create temporary table v271_after_stall as
  select public.esh_scan_claim(100) as result;
grant all on v271_after_stall to authenticated;

select is(
  (select e.source_state from public.esh_evidence_assets e where e.id = pg_temp.v271('stale')),
  'unavailable',
  'and one that never arrives says so rather than staying pending for ever');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');

-- ---------------------------------------------------------------------------
-- What will not be kept
-- ---------------------------------------------------------------------------

select is(
  public.esh_start_source(pg_temp.v271('draft'), 'notyet.jpg', 900000)->>'code',
  'not_larger',
  'a source file no larger than the copy is not a source file');

select is(
  public.esh_start_source(pg_temp.v271('theirs'), 'ownerphoto.jpg', 9000000)->>'code',
  'not_available',
  'and ESH cannot put bytes behind somebody else''s photograph');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(
  public.esh_start_source(pg_temp.v271('draft'), 'notyet.jpg', 9000000)->>'code',
  'not_permitted',
  'nor can anybody without Finding access');

select pg_temp.reset_role();
select * from finish();
rollback;
