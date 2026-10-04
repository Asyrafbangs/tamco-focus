-- ESH Finding Management v205: the backlog import, staged and released.
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
create temporary table v205_ids (name text primary key, id uuid);
grant all on v205_ids to authenticated;
create or replace function pg_temp.v205_id(p_name text)
returns uuid language sql stable as $$ select id from v205_ids where name = p_name $$;

select has_table('public', 'esh_import_batches', 'an import is a record of a file');
select has_table('public', 'esh_import_rows', 'every source row is kept');
select has_table('public', 'esh_import_owner_emails', 'name to address decisions are kept');
select has_table('public', 'esh_import_evidence_refs', 'evidence that did not come in is kept');
select ok((select relrowsecurity from pg_class where oid = 'public.esh_import_batches'::regclass),
          'staging has row security');

-- An ordinary member of staff has no business importing a backlog.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is((public.esh_import_start('backlog.xlsx', repeat('a', 64), 'ESH register 2026',
  'imports/x.xlsx', 'Sheet1', 'xl/worksheets/sheet1.xml', 1, 'dmy', '{}'::jsonb, 3)->>'code'),
  'not_permitted', 'importing is Finding work, not everybody''s');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into v205_ids
select 'batch', (public.esh_import_start('backlog.xlsx', repeat('a', 64), 'ESH register 2026',
  'imports/backlog.xlsx', 'Backlog', 'xl/worksheets/sheet1.xml', 1, 'dmy',
  jsonb_build_object('reference', 0, 'description', 1), 4)->>'batch_id')::uuid;
select ok(pg_temp.v205_id('batch') is not null, 'the file is recorded as one import');

select is((public.esh_import_start('backlog-copy.xlsx', repeat('a', 64), 'ESH register 2026',
  'imports/copy.xlsx', 'Backlog', 'xl/worksheets/sheet1.xml', 1, 'dmy', '{}'::jsonb, 4)->>'code'),
  'already_imported', 'the same file again is the same import, not a second one');

-- Four rows: one complete, one with no address, one with no corrective action,
-- and one blank.
select is((public.esh_import_stage(pg_temp.v205_id('batch'), jsonb_build_array(
  jsonb_build_object('line', 2,
    'raw', jsonb_build_object('Finding no', 'BL-001', 'Detail', 'Guard missing'),
    'mapped', jsonb_build_object(
      'reference', 'BL-001', 'description', 'Guard missing from the press',
      'action', 'Refit the guard', 'department', 'OPS', 'location', 'Press shop',
      'owner_email', 'backlog.owner@example.com', 'reported_on', '2026-03-02',
      'due_on', '2026-04-01', 'priority', 'high', 'risk', 'high',
      'remarks', 'Chased twice in April.', 'status', 'In progress')),
  jsonb_build_object('line', 3,
    'raw', jsonb_build_object('Finding no', 'BL-002'),
    'mapped', jsonb_build_object(
      'reference', 'BL-002', 'description', 'Spill kit empty',
      'action', 'Restock the spill kit', 'department', 'OPS',
      'owner_name', 'Rosli bin Ahmad', 'reported_on', '2026-03-04',
      'due_on', '2026-04-04', 'priority', 'normal')),
  jsonb_build_object('line', 4,
    'raw', jsonb_build_object('Finding no', 'BL-003'),
    'mapped', jsonb_build_object(
      'reference', 'BL-003', 'description', 'Extinguisher overdue',
      'department', 'OPS', 'owner_email', 'backlog.owner@example.com',
      'due_on', '2026-04-06', 'priority', 'urgent')),
  jsonb_build_object('line', 5, 'raw', '{}'::jsonb, 'mapped', '{}'::jsonb)
))->>'ok')::text, 'true', 'the sheet stages');

select is((select count(*)::integer from public.esh_import_rows
            where batch_id = pg_temp.v205_id('batch') and outcome = 'ready'), 1,
          'the complete row is ready');
select is((select count(*)::integer from public.esh_import_rows
            where batch_id = pg_temp.v205_id('batch') and outcome = 'ignored'), 1,
          'a blank row is ignored, explicitly');
select ok((select needs_assignment from public.esh_import_rows
            where batch_id = pg_temp.v205_id('batch') and source_line = 3),
          'a name with no address needs assignment rather than a guess');
select ok((select 'action_missing' = any(problems) from public.esh_import_rows
            where batch_id = pg_temp.v205_id('batch') and source_line = 4),
          'a row with no corrective action says so');
-- Scoped to this batch, not to the table. These counted every imported
-- finding and every notice in the database, which is true only on a freshly
-- reset one: after the end-to-end import spec has run, the same assertion
-- sees its hundred released findings and fails for a reason that has nothing
-- to do with staging.
select is((select count(*) from public.esh_import_rows
            where batch_id = pg_temp.v205_id('batch') and finding_id is not null),
          0::bigint,
          'staging creates no findings at all');
select is((select count(*) from public.esh_notification_outbox
            where import_batch_id = pg_temp.v205_id('batch')), 0::bigint,
          'and tells nobody');

-- Nothing is released until every row chosen for release is ready.
insert into v205_ids
select 'row_ready', id from public.esh_import_rows
 where batch_id = pg_temp.v205_id('batch') and source_line = 2;
insert into v205_ids
select 'row_unassigned', id from public.esh_import_rows
 where batch_id = pg_temp.v205_id('batch') and source_line = 3;
insert into v205_ids
select 'row_no_action', id from public.esh_import_rows
 where batch_id = pg_temp.v205_id('batch') and source_line = 4;

select is((public.esh_import_release(pg_temp.v205_id('batch'),
  array[pg_temp.v205_id('row_ready'), pg_temp.v205_id('row_no_action')],
  null, 'v205-refused')->>'code'),
  'row_not_ready', 'a batch containing an unready row releases nothing');
select is((select count(*) from public.esh_import_rows
            where batch_id = pg_temp.v205_id('batch') and finding_id is not null),
          0::bigint,
          'and really nothing');

-- The decisions that make the other rows releasable.
select is((public.esh_import_set_owner_email(pg_temp.v205_id('batch'), 'Rosli bin Ahmad',
  'not-an-address')->>'code'), 'owner_email_invalid', 'an address is an address');
select ok((public.esh_import_set_owner_email(pg_temp.v205_id('batch'), 'Rosli bin Ahmad',
  'rosli.v205@example.com')->>'ok')::boolean, 'one decision covers every row with that name');
select is((select outcome from public.esh_import_rows where id = pg_temp.v205_id('row_unassigned')),
          'ready', 'and that row becomes ready');

select ok((public.esh_import_amend_row(pg_temp.v205_id('row_no_action'),
  jsonb_build_object('action', 'Service and retag the extinguisher',
                     'reported_on', '2026-03-06'))->>'ok')::boolean,
  'ESH can write the corrective action and the date the file lacked');
select is((select raw->>'Finding no' from public.esh_import_rows
            where id = pg_temp.v205_id('row_no_action')), 'BL-003',
          'amending changes the reading, never the original row');
select is((public.esh_import_amend_row(pg_temp.v205_id('row_no_action'),
  jsonb_build_object('status', 'Done'))->>'code'), 'unknown_field',
  'and only the fields this import writes');

-- A photograph that could not be brought in has to be answered for first.
-- Written as the import itself would write it: staff read these, never write.
select pg_temp.reset_role();
insert into public.esh_import_evidence_refs (organization_id, batch_id, row_id, kind, detail)
select organization_id, pg_temp.v205_id('batch'), pg_temp.v205_id('row_ready'),
       'local_path', 'S:\\ESH\\photos\\BL-001.jpg'
  from public.esh_import_batches where id = pg_temp.v205_id('batch');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((public.esh_import_release(pg_temp.v205_id('batch'),
  array[pg_temp.v205_id('row_ready')], null, 'v205-evidence')->>'code'),
  'evidence_unresolved', 'evidence with no outcome stops the release');
select ok((public.esh_import_acknowledge_evidence(
  (select id from public.esh_import_evidence_refs where batch_id = pg_temp.v205_id('batch')),
  'On the shared drive; ESH will attach it after release.')->>'ok')::boolean,
  'an acknowledgment is a decision somebody signs');

-- Release.
select is((public.esh_import_release(pg_temp.v205_id('batch'),
  array[pg_temp.v205_id('row_ready'), pg_temp.v205_id('row_unassigned'),
        pg_temp.v205_id('row_no_action')],
  '2026-09-25 01:00+08', 'v205-release')->>'released')::text, '3',
  'the reviewed rows become findings together');
select is((select due_at::date from public.esh_finding_actions action
            join public.esh_import_rows imported on imported.action_id = action.id
           where imported.id = pg_temp.v205_id('row_ready')), '2026-04-01'::date,
          'an old deadline stays old: import is not a way to look on time');
select is((select followup_active_from from public.esh_finding_actions action
            join public.esh_import_rows imported on imported.action_id = action.id
           where imported.id = pg_temp.v205_id('row_ready')),
          '2026-09-25 01:00+08'::timestamptz,
          'and following it up starts when the release said it would');
select is((select count(*)::integer from public.esh_notification_outbox
            where event_type = 'owner_assignment' and import_batch_id is null
              and finding_id in (select imported.finding_id from public.esh_import_rows imported
                                  where imported.batch_id = pg_temp.v205_id('batch'))), 0,
          'nobody receives one email per backlog row');
select is((select count(*)::integer from public.esh_notification_outbox
            where event_type = 'import_assignment'
              and import_batch_id = pg_temp.v205_id('batch')), 2,
          'each owner receives one summary of their own');
-- `limit 1` over the whole table would read somebody else's notice.
select is((select state from public.esh_notification_outbox
            where event_type = 'import_assignment'
              and import_batch_id = pg_temp.v205_id('batch') limit 1),
          'held_rollout',
          'held, because these contacts are not enabled yet');

-- A second release of the same rows is the same release.
select is((public.esh_import_release(pg_temp.v205_id('batch'),
  array[pg_temp.v205_id('row_ready')], null, 'v205-release')->>'released')::text, '3',
  'the same release key returns the first answer');
select is((select count(*) from public.esh_import_rows
            where batch_id = pg_temp.v205_id('batch') and finding_id is not null),
          3::bigint,
          'and creates nothing a second time');

select is((public.esh_import_discard(pg_temp.v205_id('batch'), 'Changed my mind')->>'code'),
          'already_released',
          'a released batch is corrected the ordinary way, never erased');

select * from finish();
rollback;
