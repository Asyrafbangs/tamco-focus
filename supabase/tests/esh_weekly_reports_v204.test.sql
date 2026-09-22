-- ESH Finding Management v204: versioned weekly snapshots and report-only access.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

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
create temporary table v204_ids (name text primary key, id uuid);
grant all on v204_ids to authenticated;
create or replace function pg_temp.v204_id(p_name text)
returns uuid language sql stable as $$ select id from v204_ids where name = p_name $$;

select has_table('public', 'esh_report_definitions', 'report definitions are authoritative records');
select has_table('public', 'esh_report_runs', 'weekly runs are stored');
select has_table('public', 'esh_report_snapshot_rows', 'snapshot rows are immutable records');
select has_table('public', 'esh_report_recipients', 'recipient entitlements are explicit');
select has_table('public', 'esh_report_session_entitlements', 'guest report sessions are purpose-scoped');
select is((select count(*) from public.esh_report_definitions), 0::bigint,
          'no real leadership report is seeded active');

select ok(has_function_privilege('service_role', 'public.esh_generate_weekly_reports(timestamptz)', 'EXECUTE'),
          'only the scheduled service can generate reports');
select ok(not has_function_privilege('authenticated', 'public.esh_generate_weekly_reports(timestamptz)', 'EXECUTE'),
          'a signed-in browser cannot run the scheduler');
select ok(has_function_privilege('service_role', 'public.esh_guest_report(text,uuid,boolean)', 'EXECUTE'),
          'the server can resolve a report guest read');
select ok(not has_function_privilege('authenticated', 'public.esh_guest_report(text,uuid,boolean)', 'EXECUTE'),
          'a staff browser cannot call the guest capability directly');

insert into public.esh_email_principals
  (id, organization_id, display_email, canonical_email, created_by)
values
  ('20400000-0000-4000-8000-000000000001',
   'e5e50000-0000-4000-8000-000000000001',
   'v204-report@example.com', 'v204-report@example.com',
   'f0c05000-0000-4000-a000-000000000002');

select throws_ok($$
  insert into public.esh_access_grants
    (organization_id, principal_id, purpose, token_hash, issued_reason, expires_at)
  values ('e5e50000-0000-4000-8000-000000000001',
          '20400000-0000-4000-8000-000000000001', 'report_viewer',
          repeat('f', 64), 'notification', now() + interval '1 day')
$$, '23514', null, 'a report grant must name both its run and recipient');

select is((public.esh_generate_weekly_reports('2026-09-21 01:00:00+00')->>'created')::integer, 0,
          'with no active definition the scheduler is a safe no-op');
select is((select count(*) from public.esh_report_runs), 0::bigint,
          'a no-op invents no run');
select is((select count(*) from public.esh_report_outbox), 0::bigint,
          'a no-op invents no recipient delivery');
select ok((select relrowsecurity from pg_class where oid = 'public.esh_report_definitions'::regclass),
          'report definitions have RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.esh_report_session_entitlements'::regclass),
          'session entitlements have RLS and no browser policy');

-- ---------------------------------------------------------------------------
-- A configured report, from draft to a captured Monday morning.
-- ---------------------------------------------------------------------------

-- Reporting is its own permission: the seeded Verifier does not have it yet.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((public.esh_save_report_definition(
  null, 'v204 leadership weekly', 'draft', 'Asia/Kuala_Lumpur', 1, '08:30',
  true, true, '{}'::uuid[], array['lead.v204@example.com'])->>'code'),
  'not_permitted', 'Finding access alone does not configure leadership reports');

select pg_temp.reset_role();
update public.esh_staff_access set can_manage_reports = true
 where user_id = 'f0c05000-0000-4000-a000-000000000002';

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into v204_ids
select 'definition', (public.esh_save_report_definition(
  null, 'v204 leadership weekly', 'draft', 'Asia/Kuala_Lumpur', 1, '08:30',
  true, true, '{}'::uuid[], array['lead.v204@example.com', 'quiet.v204@example.com'])->>'id')::uuid;

select is((select state from public.esh_report_definitions where id = pg_temp.v204_id('definition')),
          'draft', 'a new report starts as a draft');
select is((select count(*)::integer from public.esh_report_recipients
            where report_definition_id = pg_temp.v204_id('definition')), 2,
          'both recipients are stored as explicit entitlements');

-- One finding in scope, and one the scope must never carry.
with saved as (
  select public.esh_save_finding(null, jsonb_build_object(
    'title', 'v204 open finding', 'description', 'Report fixture',
    'reported_on', '2026-09-14',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Correct it', 'priority', 'normal',
    'owner_email', 'owner.v204@example.com', 'due_date', '2026-10-20',
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true, 'v204-open') value
)
insert into v204_ids select 'open_finding', (value->>'finding_id')::uuid from saved;

with saved as (
  select public.esh_save_finding(null, jsonb_build_object(
    'title', 'v204 restricted finding', 'description', 'Report fixture',
    'reported_on', '2026-09-14', 'is_restricted', true,
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Correct it', 'priority', 'normal',
    'owner_email', 'secret.v204@example.com', 'due_date', '2026-10-20',
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture needs no route.'
  ), true, 'v204-restricted') value
)
insert into v204_ids select 'restricted_finding', (value->>'finding_id')::uuid from saved;

select pg_temp.reset_role();
select is((public.esh_generate_weekly_reports('2026-09-21 01:00:00+00')->>'created')::integer, 0,
          'a draft report captures nothing, however due it looks');

insert into v204_ids
select 'lead_principal', id from public.esh_email_principals
 where canonical_email = 'lead.v204@example.com'
union all
select 'quiet_principal', id from public.esh_email_principals
 where canonical_email = 'quiet.v204@example.com';

-- One recipient is enabled for delivery; the other stays off, as contacts do.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access(
  pg_temp.v204_id('lead_principal'), true, 'Approved fixture access')->>'ok')::boolean,
  'an administrator enables the leadership contact');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok((public.esh_save_report_definition(
  pg_temp.v204_id('definition'), 'v204 leadership weekly', 'active', 'Asia/Kuala_Lumpur', 1, '08:30',
  true, true, '{}'::uuid[], array['lead.v204@example.com', 'quiet.v204@example.com'])->>'ok')::boolean,
  'activation is a deliberate second act');

select pg_temp.reset_role();
select is((public.esh_generate_weekly_reports('2026-09-21 01:00:00+00')->>'created')::integer, 1,
          'the Monday morning cycle captures once');
insert into v204_ids
select 'run', id from public.esh_report_runs where report_definition_id = pg_temp.v204_id('definition');

select is((select cycle_local_date from public.esh_report_runs where id = pg_temp.v204_id('run')),
          '2026-09-21'::date, 'the cycle is dated in the definition timezone');
select is((select closed_window_end from public.esh_report_runs where id = pg_temp.v204_id('run')),
          '2026-09-20 16:00:00+00'::timestamptz,
          'the window closes at the start of this local week, not at capture time');
select ok(exists(select 1 from public.esh_report_snapshot_rows
                  where run_id = pg_temp.v204_id('run')
                    and finding_id = pg_temp.v204_id('open_finding')),
          'an open finding in scope is in the snapshot');
select ok(not exists(select 1 from public.esh_report_snapshot_rows
                      where run_id = pg_temp.v204_id('run')
                        and finding_id = pg_temp.v204_id('restricted_finding')),
          'a restricted finding never reaches a leadership report');
select is((select open_count from public.esh_report_runs where id = pg_temp.v204_id('run')), 1,
          'the run counts what it captured');
select is((select state from public.esh_report_outbox outbox
            join public.esh_report_recipients recipient on recipient.id = outbox.recipient_id
           where outbox.run_id = pg_temp.v204_id('run')
             and recipient.principal_id = pg_temp.v204_id('lead_principal')), 'queued',
          'the enabled recipient has a delivery of their own');
select is((select state from public.esh_report_outbox outbox
            join public.esh_report_recipients recipient on recipient.id = outbox.recipient_id
           where outbox.run_id = pg_temp.v204_id('run')
             and recipient.principal_id = pg_temp.v204_id('quiet_principal')), 'suppressed',
          'a contact whose access is off is held, not quietly sent to');

-- ---------------------------------------------------------------------------
-- A second run of the same morning, and what cannot be rewritten afterwards.
-- ---------------------------------------------------------------------------

select is((public.esh_generate_weekly_reports('2026-09-21 02:30:00+00')->>'created')::integer, 0,
          'a second run of the same cycle captures nothing again');
select is((select count(*) from public.esh_report_runs
            where report_definition_id = pg_temp.v204_id('definition')), 1::bigint,
          'and leaves one run, not two');
select is((select count(*) from public.esh_report_outbox
            where run_id = pg_temp.v204_id('run')), 2::bigint,
          'and no recipient is written to twice');

select throws_ok($$
  update public.esh_report_snapshot_rows set finding_title = 'rewritten'
   where run_id = (select id from public.esh_report_runs limit 1)
$$, '42501', null, 'a captured row cannot be rewritten');
select throws_ok($$
  delete from public.esh_report_snapshot_rows
   where run_id = (select id from public.esh_report_runs limit 1)
$$, '42501', null, 'a captured row cannot be deleted');
select throws_ok($$
  update public.esh_report_runs set cycle_local_date = '2026-09-14'
   where id = (select id from public.esh_report_runs limit 1)
$$, '42501', null, 'a run cannot be moved to another week');
select throws_ok($$
  delete from public.esh_report_runs where id = (select id from public.esh_report_runs limit 1)
$$, '42501', null, 'a run cannot be deleted');

-- ---------------------------------------------------------------------------
-- Pausing stops the next capture and leaves issued access alone.
-- ---------------------------------------------------------------------------

insert into public.esh_access_grants
  (organization_id, principal_id, purpose, report_run_id, report_recipient_id,
   token_hash, issued_reason, expires_at)
select 'e5e50000-0000-4000-8000-000000000001', recipient.principal_id, 'report_viewer',
       pg_temp.v204_id('run'), recipient.id, repeat('a', 64), 'notification',
       now() + interval '7 days'
  from public.esh_report_recipients recipient
 where recipient.report_definition_id = pg_temp.v204_id('definition')
   and recipient.principal_id = pg_temp.v204_id('lead_principal');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select ok((public.esh_save_report_definition(
  pg_temp.v204_id('definition'), 'v204 leadership weekly', 'paused', 'Asia/Kuala_Lumpur', 1, '08:30',
  true, true, '{}'::uuid[], array['lead.v204@example.com', 'quiet.v204@example.com'])->>'ok')::boolean,
  'a report can be paused');

select pg_temp.reset_role();
select is((public.esh_generate_weekly_reports('2026-09-28 01:00:00+00')->>'created')::integer, 0,
          'a paused report captures nothing next week');
select is((select count(*) from public.esh_access_grants
            where purpose = 'report_viewer' and revoked_at is null), 1::bigint,
          'pausing does not withdraw a link somebody already has');

-- ---------------------------------------------------------------------------
-- The contact directory: reporting participation, seen by administration.
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select is((select report_subscriptions from public.esh_admin_contacts('lead.v204')), 1,
          'a leadership subscription is counted where contacts are administered');
select is((select open_actions from public.esh_admin_contacts('owner.v204')), 1,
          'an administrator without Finding access still reads the live owner label');

select * from finish();
rollback;
