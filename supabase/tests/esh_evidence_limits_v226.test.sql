-- ============================================================================
-- ESH Finding Management v226: evidence at the size §23 asks for.
--
-- §23; FM16-FM22. What only the database can establish: one file may be 25 MB
-- and not a byte more, the limit is asked for rather than repeated, and ten
-- files that each fit can still be refused together because a message has a
-- total of its own.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

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

create temporary table v226 (name text primary key, id uuid);
grant all on v226 to authenticated;

-- One number, in one place (§23).
select is(focus.esh_evidence_max_bytes(), 26214400::bigint,
          'the largest single file is 25 MiB');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into v226 (name, id)
select 'saved',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v226 extinguisher out of service',
          'description', 'Extinguisher past its service date.',
          'reported_on', '2026-09-21',
          'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 Plant room',
          'required_outcome', 'Service or replace it.',
          'priority', 'normal',
          'owner_email', 'evidence.owner.v226@example.com',
          'due_date', '2026-12-30',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture needs no route.'), true)->>'finding_id')::uuid;
insert into v226 (name, id)
select 'action', id from public.esh_finding_actions
 where finding_id = (select id from v226 where name = 'saved');
insert into v226 (name, id)
select 'finding', id from v226 where name = 'saved';

-- ---------------------------------------------------------------------------
-- One file (§23)
-- ---------------------------------------------------------------------------

select is(public.esh_start_upload((select id from v226 where name = 'finding'),
            (select id from v226 where name = 'action'),
            'message', 'over.jpg', 26214401)->>'code', 'too_large',
          'a file a byte over 25 MB cannot start uploading');
select ok((public.esh_start_upload((select id from v226 where name = 'finding'),
            (select id from v226 where name = 'action'),
            'message', 'phone.jpg', 26214400)->>'ok')::boolean,
          'and one of exactly 25 MB can');

-- The constraint agrees with the procedure, so nothing that passes one is
-- refused by the other at the last moment.
select pg_temp.reset_role();
select throws_ok(
  $$insert into public.esh_evidence_assets
      (organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
       original_name, declared_size, object_key)
    values ('e5e50000-0000-4000-8000-000000000001',
            (select id from v226 where name = 'finding'),
            (select id from v226 where name = 'action'), 'message', 'staff',
            'f0c05000-0000-4000-a000-000000000002', 'huge.pdf', 26214401, 'x/huge.pdf')$$,
  '23514', null,
  'the table refuses the same size the procedure does');

-- ---------------------------------------------------------------------------
-- A whole message (§23)
-- ---------------------------------------------------------------------------

/*
 * Five files of 24 MB each: every one of them inside the per-file limit, 120 MB
 * between them. Before v226 nothing counted the total at all, so a quarter of a
 * gigabyte could go in one message.
 */
insert into public.esh_evidence_assets
  (organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
   original_name, declared_size, object_key, state, content_type, size_bytes, content_sha256)
select 'e5e50000-0000-4000-8000-000000000001',
       (select id from v226 where name = 'finding'),
       (select id from v226 where name = 'action'), 'message', 'staff',
       'f0c05000-0000-4000-a000-000000000002',
       'big-' || n || '.jpg', 25165824, 'v226/big-' || n || '.jpg',
       'ready', 'image/jpeg', 25165824, repeat('a', 64)
  from generate_series(1, 5) n;

select is(focus.esh_files_problem((select id from v226 where name = 'action'),
            null, 'f0c05000-0000-4000-a000-000000000002',
            (select array_agg(id) from public.esh_evidence_assets
              where object_key like 'v226/big-%')),
          'message_too_large',
          'five files inside the per-file limit are too much for one message');

select is(focus.esh_files_problem((select id from v226 where name = 'action'),
            null, 'f0c05000-0000-4000-a000-000000000002',
            (select array_agg(id) from public.esh_evidence_assets
              where object_key in ('v226/big-1.jpg', 'v226/big-2.jpg', 'v226/big-3.jpg',
                                     'v226/big-4.jpg'))),
          null,
          'and four of them, at 96 MB, are not');

-- The count limit is still its own rule, whatever the sizes.
insert into public.esh_evidence_assets
  (organization_id, finding_id, action_id, purpose, uploader_kind, uploader_user_id,
   original_name, declared_size, object_key, state, content_type, size_bytes, content_sha256)
select 'e5e50000-0000-4000-8000-000000000001',
       (select id from v226 where name = 'finding'),
       (select id from v226 where name = 'action'), 'message', 'staff',
       'f0c05000-0000-4000-a000-000000000002',
       'small-' || n || '.jpg', 1024, 'v226/small-' || n || '.jpg',
       'ready', 'image/jpeg', 1024, repeat('b', 64)
  from generate_series(1, 11) n;

select is(focus.esh_files_problem((select id from v226 where name = 'action'),
            null, 'f0c05000-0000-4000-a000-000000000002',
            (select array_agg(id) from public.esh_evidence_assets
              where object_key like 'v226/small-%')),
          'too_many_files',
          'eleven tiny files are still eleven files');

-- And the bucket, which refuses after the bytes have already travelled.
select is((select file_size_limit from storage.buckets where id = 'finding-evidence'),
          26214400::bigint,
          'the bucket allows what the application allows');

select is((select count(*)::integer from public.esh_evidence_assets
            where object_key like 'v226/%' and scan_state <> 'not_scanned'), 0,
          'and nothing here is described as scanned');

select * from finish();
rollback;
