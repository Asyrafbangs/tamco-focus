-- ============================================================================
-- ESH Finding Management v286: the uploads that never finished.
--
-- An upload is agreed, the bytes are put into private storage, and the server
-- reads them back and records what they are. When the third step never
-- happens, a row stays in `uploading` and an object may sit in the bucket with
-- nothing pointing at it. v271's background upload of the camera's own file
-- has the same shape: `source_state = 'pending'` is a sentence ESH reads --
-- "Full-size original still arriving" -- and without a sweep it says that for
-- ever.
--
-- What only the database can establish: that the sweep takes exactly the rows
-- that are genuinely abandoned, hands back the keys the worker must delete
-- BEFORE clearing them, leaves everything else alone, refuses to sweep inside
-- its own five-minute floor however it is called, and is reachable by nobody
-- but the service role.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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

create temporary table v286 (name text primary key, id uuid);
grant all on v286 to authenticated;

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into v286 (name, id)
select 'finding',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v286 guard missing from the bench grinder',
          'description', 'The wheel guard has been removed.',
          'reported_on', '2026-11-03',
          'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 Workshop',
          'required_outcome', 'Refit the guard.',
          'priority', 'normal',
          'owner_email', 'orphan.owner.v286@example.com',
          'due_date', '2026-12-30',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture needs no route.'), true)->>'finding_id')::uuid;
insert into v286 (name, id)
select 'action', id from public.esh_finding_actions
 where finding_id = (select id from v286 where name = 'finding');
select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- Six assets, one for each thing the sweep must and must not do
-- ---------------------------------------------------------------------------

-- An upload agreed three hours ago that never came back.
insert into public.esh_evidence_assets
  (id, organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
   original_name, declared_size, object_key, state, created_at)
values ('d2860000-0000-4000-8000-000000000001',
        'e5e50000-0000-4000-8000-000000000001',
        (select id from v286 where name = 'finding'),
        (select id from v286 where name = 'action'), 'message', 'staff',
        'f0c05000-0000-4000-a000-000000000002',
        'abandoned.jpg', 120000, 'v286/abandoned.jpg', 'uploading',
        now() - interval '3 hours');

-- One that started a minute ago and is still going. A minute, not `now()`:
-- inside a transaction `now()` is the transaction's own clock, so a row
-- created at `now()` is never strictly older than any cutoff and would pass
-- the floor assertion below whether the floor existed or not.
insert into public.esh_evidence_assets
  (id, organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
   original_name, declared_size, object_key, state, created_at)
values ('d2860000-0000-4000-8000-000000000002',
        'e5e50000-0000-4000-8000-000000000001',
        (select id from v286 where name = 'finding'),
        (select id from v286 where name = 'action'), 'message', 'staff',
        'f0c05000-0000-4000-a000-000000000002',
        'in-flight.jpg', 120000, 'v286/in-flight.jpg', 'uploading',
        now() - interval '1 minute');

-- An old file that finished properly. Age is not the test; state is.
insert into public.esh_evidence_assets
  (id, organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
   original_name, declared_size, object_key, state, content_type, size_bytes, content_sha256,
   created_at)
values ('d2860000-0000-4000-8000-000000000003',
        'e5e50000-0000-4000-8000-000000000001',
        (select id from v286 where name = 'finding'),
        (select id from v286 where name = 'action'), 'message', 'staff',
        'f0c05000-0000-4000-a000-000000000002',
        'walkway.jpg', 120000, 'v286/walkway.jpg', 'ready', 'image/jpeg', 120000,
        repeat('a', 64), now() - interval '3 hours');

-- A sent file whose full-size original never arrived.
insert into public.esh_evidence_assets
  (id, organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
   original_name, declared_size, object_key, state, content_type, size_bytes, content_sha256,
   source_state, source_object_key, source_file_name, source_started_at, created_at)
values ('d2860000-0000-4000-8000-000000000004',
        'e5e50000-0000-4000-8000-000000000001',
        (select id from v286 where name = 'finding'),
        (select id from v286 where name = 'action'), 'message', 'staff',
        'f0c05000-0000-4000-a000-000000000002',
        'grinder.jpg', 120000, 'v286/grinder.jpg', 'ready', 'image/jpeg', 120000,
        repeat('b', 64), 'pending', 'v286/grinder.source.jpg', 'grinder.jpg',
        now() - interval '3 hours', now() - interval '3 hours');

-- One whose original is still on its way up.
insert into public.esh_evidence_assets
  (id, organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
   original_name, declared_size, object_key, state, content_type, size_bytes, content_sha256,
   source_state, source_object_key, source_file_name, source_started_at)
values ('d2860000-0000-4000-8000-000000000005',
        'e5e50000-0000-4000-8000-000000000001',
        (select id from v286 where name = 'finding'),
        (select id from v286 where name = 'action'), 'message', 'staff',
        'f0c05000-0000-4000-a000-000000000002',
        'ladder.jpg', 120000, 'v286/ladder.jpg', 'ready', 'image/jpeg', 120000,
        repeat('c', 64), 'pending', 'v286/ladder.source.jpg', 'ladder.jpg',
        now() - interval '1 minute');

-- And one whose original did arrive, which must keep its key for ever.
insert into public.esh_evidence_assets
  (id, organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
   original_name, declared_size, object_key, state, content_type, size_bytes, content_sha256,
   source_state, source_object_key, source_file_name, source_size_bytes, source_sha256,
   source_kept_at, source_started_at, created_at)
values ('d2860000-0000-4000-8000-000000000006',
        'e5e50000-0000-4000-8000-000000000001',
        (select id from v286 where name = 'finding'),
        (select id from v286 where name = 'action'), 'message', 'staff',
        'f0c05000-0000-4000-a000-000000000002',
        'panel.jpg', 120000, 'v286/panel.jpg', 'ready', 'image/jpeg', 120000,
        repeat('d', 64), 'kept', 'v286/panel.source.jpg', 'panel.jpg', 8000000,
        repeat('e', 64), now() - interval '3 hours', now() - interval '3 hours',
        now() - interval '3 hours');

-- ---------------------------------------------------------------------------
-- The floor, before anything is swept: a caller asking for zero minutes
-- ---------------------------------------------------------------------------

-- Five minutes is a floor, not a default. An upload in flight must not be
-- swept out from under the person making it because a caller passed 0.
select is(
  jsonb_array_length(public.esh_evidence_claim_orphans(0, 50) -> 'abandoned'),
  1,
  'asking for zero minutes still only reaches the three-hour-old row');
select is(
  (select state from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000002'),
  'uploading',
  'the upload that started a minute ago is untouched by a zero-minute sweep');

-- That call swept both kinds of orphan, which is itself the point of the two
-- assertions above. Put them back as they were for the sweep under test.
update public.esh_evidence_assets
   set state = 'uploading', rejected_reason = null
 where id = 'd2860000-0000-4000-8000-000000000001';
update public.esh_evidence_assets
   set source_state = 'pending', source_object_key = 'v286/grinder.source.jpg'
 where id = 'd2860000-0000-4000-8000-000000000004';

-- ---------------------------------------------------------------------------
-- The sweep itself
-- ---------------------------------------------------------------------------

create temporary table v286_swept (payload jsonb);
insert into v286_swept (payload) select public.esh_evidence_claim_orphans(120, 50);

select is(
  (select payload -> 'abandoned' -> 0 ->> 'object_key' from v286_swept),
  'v286/abandoned.jpg',
  'the abandoned upload hands back the object key the worker must delete');
select is(
  (select jsonb_array_length(payload -> 'abandoned') from v286_swept), 1,
  'and only that one: a recent upload and an old finished one are not orphans');
select is(
  (select state from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000001'),
  'rejected',
  'the abandoned upload is refused rather than left in uploading for ever');
select is(
  (select rejected_reason from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000001'),
  'abandoned',
  'and says why, so it is not confused with a file whose content was refused');
select is(
  (select state from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000003'),
  'ready',
  'an old file that finished properly is not swept');

-- ---------------------------------------------------------------------------
-- The original that never arrived (v271)
-- ---------------------------------------------------------------------------

-- The key is read before the update clears it. `returning` on the updated
-- table would hand back the null the statement just wrote, and the worker
-- would then delete nothing while the row claimed the object was gone.
select is(
  (select payload -> 'sources' -> 0 ->> 'object_key' from v286_swept),
  'v286/grinder.source.jpg',
  'the never-arrived original hands back its key, not the null that replaced it');
select is(
  (select source_state from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000004'),
  'unavailable',
  'and stops telling ESH the original is still arriving');
select is(
  (select source_object_key from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000004'),
  null,
  'and no longer points at an object that is about to be deleted');

-- The asset itself is somebody's evidence: attached, sent and verified. Only
-- the sentence about its original changes.
select is(
  (select state || ' ' || object_key from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000004'),
  'ready v286/grinder.jpg',
  'the compressed copy that was actually sent is untouched');

select is(
  (select source_state from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000005'),
  'pending',
  'an original still on its way up is left alone');
select is(
  (select source_state || ' ' || source_object_key from public.esh_evidence_assets
    where id = 'd2860000-0000-4000-8000-000000000006'),
  'kept v286/panel.source.jpg',
  'and an original that did arrive keeps its key');

-- ---------------------------------------------------------------------------
-- Who may run it
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated',
    'public.esh_evidence_claim_orphans(integer, integer)', 'execute'),
  'a signed-in person cannot sweep evidence');
select ok(
  not has_function_privilege('anon',
    'public.esh_evidence_claim_orphans(integer, integer)', 'execute'),
  'and nor can anybody who is not signed in');
select ok(
  has_function_privilege('service_role',
    'public.esh_evidence_claim_orphans(integer, integer)', 'execute'),
  'only the worker that can reach the bucket may run it');

select * from finish();
rollback;
