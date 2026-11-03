-- ============================================================================
-- ESH Finding Management v288: public QR reporting, with the switch off.
--
-- v272 built the tables and deliberately stopped: no anonymous policy, no
-- submission procedure. This is that path, and the assertions below are
-- mostly about what it refuses.
--
-- What only the database can establish:
--   * the switch can actually be moved, by an administrator, with a reason —
--     and that a settings row exists to move, which it did not before;
--   * a report submitted while it is closed is refused outright, not queued;
--   * an unknown or retired QR code is refused;
--   * the rate limit counts, and counts per bucket;
--   * a photograph can only be attached with the unguessable token issued to
--     the browser that submitted, and only three of them;
--   * none of it is reachable by `anon` or by a signed-in person: the server
--     holds the boundary and calls as the service role.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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

create or replace function pg_temp.admin() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000001'::uuid $$;
create or replace function pg_temp.izzul() returns uuid language sql immutable as
  $$ select 'f0c05000-0000-4000-a000-000000000002'::uuid $$;
create or replace function pg_temp.org() returns uuid language sql immutable as
  $$ select 'e5e50000-0000-4000-8000-000000000001'::uuid $$;

-- A QR code on a wall, and a retired one beside it.
insert into public.esh_qr_locations
  (organization_id, public_code, display_label, department_id, active)
values (pg_temp.org(), 'BR2-PRESS-LINE-2', 'BR2 Press line 2',
        (select id from public.departments where code = 'OPS'), true),
       (pg_temp.org(), 'BR1-OLD-STORE-07', 'BR1 Old store', null, false);

-- ---------------------------------------------------------------------------
-- The switch exists, and starts closed
-- ---------------------------------------------------------------------------

-- v272 created the settings table and nothing ever inserted a row, so every
-- read fell through to "not configured" and the switch could not be moved at
-- all. This is the assertion that would have caught it.
select is(
  (select count(*)::integer from public.esh_qr_intake_settings
    where organization_id = pg_temp.org()),
  1,
  'the organisation has a settings row to switch');
select is(
  (select enabled from public.esh_qr_intake_settings where organization_id = pg_temp.org()),
  false,
  'and public reporting starts closed');

select is(
  public.esh_qr_location_for('BR2-PRESS-LINE-2')->>'code',
  'not_enabled',
  'a QR code resolves to nothing while reporting is closed');
select is(
  public.esh_public_report_submit('BR2-PRESS-LINE-2', 'A guard is missing.', null, null,
    null, null)->>'code',
  'not_enabled',
  'and a report submitted while it is closed is refused, not queued');

-- ---------------------------------------------------------------------------
-- Who may open it
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.izzul());
select is(
  public.esh_set_qr_intake(true, 'Opening for the pilot on line 2.')->>'code',
  'not_permitted',
  'an ESH coordinator cannot open public reporting');
select pg_temp.reset_role();

select pg_temp.act_as(pg_temp.admin());
select is(
  public.esh_set_qr_intake(true, 'too short')->>'code',
  'reason_required',
  'and an administrator cannot open it without saying why');
select is(
  public.esh_set_qr_intake(null, 'Opening for the pilot on line 2.')->>'code',
  'state_required',
  'nor by leaving the state unsaid');
select ok(
  (public.esh_set_qr_intake(true, 'Opening for the pilot on press line 2.')->>'ok')::boolean,
  'an administrator opens it, with a reason');
select pg_temp.reset_role();

select is(
  (select change_reason from public.esh_qr_intake_settings
    where organization_id = pg_temp.org()),
  'Opening for the pilot on press line 2.',
  'the reason is kept on the row, not only in a log');
select is(
  (select count(*)::integer from public.esh_audit_events
    where event_type = 'qr_intake_switched'),
  1,
  'and the switch is in the audit trail');

-- ---------------------------------------------------------------------------
-- The form's own read
-- ---------------------------------------------------------------------------

select is(
  public.esh_qr_location_for('BR2-PRESS-LINE-2')->>'label',
  'BR2 Press line 2',
  'an open code resolves to the label the form shows');
select is(
  public.esh_qr_location_for('BR1-OLD-STORE-07')->>'code',
  'unknown_location',
  'a retired code resolves to nothing, so an old sticker cannot be used');
select is(
  public.esh_qr_location_for('NOT-A-REAL-CODE')->>'code',
  'unknown_location',
  'and so does a code nobody issued');

-- ---------------------------------------------------------------------------
-- Submitting
-- ---------------------------------------------------------------------------

select is(
  public.esh_public_report_submit('BR2-PRESS-LINE-2', '   ', null, null, null, null)->>'code',
  'description_required',
  'a report with nothing in it is refused: the one field is the whole point');

create temporary table v288 (name text primary key, value text);

insert into v288 (name, value)
select 'anonymous',
       public.esh_public_report_submit('BR2-PRESS-LINE-2',
         'The wheel guard is off the bench grinder and it is still being used.',
         null, null, null, null)->>'reference';
select isnt((select value from v288 where name = 'anonymous'), null,
            'a report is accepted and answers with its reference');

select is(
  (select source || ' ' || status || ' ' || coalesce(reporter_contact, 'anonymous')
     from public.esh_report_intake
    where public_reference = (select value from v288 where name = 'anonymous')::uuid),
  'qr new anonymous',
  'it lands in the queue as a new QR report with no reporter attached');
select is(
  (select reported_location from public.esh_report_intake
    where public_reference = (select value from v288 where name = 'anonymous')::uuid),
  'BR2 Press line 2',
  'and takes its location from the code, so nobody has to type where they are');
select is(
  (select d.code from public.esh_report_intake r
     join public.departments d on d.id = r.department_id
    where r.public_reference = (select value from v288 where name = 'anonymous')::uuid),
  'OPS',
  'routed to the department the code belongs to');
select is(
  (select detail->>'anonymous' from public.esh_audit_events
    where event_type = 'public_report_received'
    order by occurred_at desc limit 1),
  'true',
  'and the audit trail records that nobody left their name');

-- The optional half: a contact line, and nothing else about who they are.
insert into v288 (name, value)
select 'named',
       public.esh_public_report_submit('BR2-PRESS-LINE-2',
         'Same grinder, the guard is still off two days later.',
         'By the goods-in door', 'Aisyah, ext 4412', null, null)->>'reference';
select is(
  (select reporter_contact from public.esh_report_intake
    where public_reference = (select value from v288 where name = 'named')::uuid),
  'Aisyah, ext 4412',
  'a reporter who wants to be contacted is, and only then');
select is(
  (select reported_location from public.esh_report_intake
    where public_reference = (select value from v288 where name = 'named')::uuid),
  'By the goods-in door',
  'and what they typed beats the label on the sticker');

-- ---------------------------------------------------------------------------
-- The rate limit
-- ---------------------------------------------------------------------------

-- Five more on the same bucket: seven in all, and the limit here is six.
select is(
  (select count(*)::integer from (
     select public.esh_public_report_submit('BR2-PRESS-LINE-2', 'Spam ' || n,
              null, null, 'bucket-aaaaaaaa', null, 600, 6) as answer
       from generate_series(1, 7) n
   ) attempts
   where (answer->>'ok')::boolean),
  6,
  'six reports from one bucket go through and the seventh does not');
select is(
  (select public.esh_public_report_submit('BR2-PRESS-LINE-2', 'From another phone.',
     null, null, 'bucket-bbbbbbbb', null, 600, 6)->>'ok'),
  'true',
  'and the limit is per bucket, so one spammer does not close the site');

-- ---------------------------------------------------------------------------
-- Photographs
-- ---------------------------------------------------------------------------

insert into v288 (name, value) values ('token', encode(digest('a-secret-token', 'sha256'), 'hex'));
insert into v288 (name, value)
select 'with_photos',
       public.esh_public_report_submit('BR2-PRESS-LINE-2',
         'Oil across the walkway by the press, about two metres of it.',
         null, null, null, (select value from v288 where name = 'token'))->>'reference';

select is(
  public.esh_public_photo_start(
    (select value from v288 where name = 'with_photos')::uuid,
    'the-wrong-hash', 'walkway.jpg', 400000)->>'code',
  'not_permitted',
  'knowing the reference is not enough to attach a photograph to a report');
select ok(
  (public.esh_public_photo_start(
     (select value from v288 where name = 'with_photos')::uuid,
     (select value from v288 where name = 'token'), 'walkway.jpg', 400000)->>'ok')::boolean,
  'the browser that submitted it can, with the token it was issued');
select is(
  public.esh_public_photo_start(
    (select value from v288 where name = 'anonymous')::uuid,
    (select value from v288 where name = 'token'), 'walkway.jpg', 400000)->>'code',
  'not_permitted',
  'and a report that was never issued a token cannot take photographs at all');

select is(
  public.esh_public_photo_start(
    (select value from v288 where name = 'with_photos')::uuid,
    (select value from v288 where name = 'token'), 'huge.jpg', 20000000)->>'code',
  'too_large',
  'a file over the input limit is refused before anything is signed');

-- Two more, then the fourth.
select public.esh_public_photo_start(
  (select value from v288 where name = 'with_photos')::uuid,
  (select value from v288 where name = 'token'), 'second.jpg', 400000);
select public.esh_public_photo_start(
  (select value from v288 where name = 'with_photos')::uuid,
  (select value from v288 where name = 'token'), 'third.jpg', 400000);
select is(
  public.esh_public_photo_start(
    (select value from v288 where name = 'with_photos')::uuid,
    (select value from v288 where name = 'token'), 'fourth.jpg', 400000)->>'code',
  'too_many_photos',
  'three photographs is the limit, and the fourth is refused');

-- ---------------------------------------------------------------------------
-- Who can reach any of this
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon',
    'public.esh_public_report_submit(text, text, text, text, text, text, integer, integer)',
    'execute'),
  'the anonymous role cannot submit a report directly');
select ok(
  not has_function_privilege('authenticated',
    'public.esh_public_report_submit(text, text, text, text, text, text, integer, integer)',
    'execute'),
  'and nor can a signed-in person: the server holds the boundary');
select ok(
  has_function_privilege('service_role',
    'public.esh_public_report_submit(text, text, text, text, text, text, integer, integer)',
    'execute'),
  'only the server, as the service role, may call it');
select ok(
  not has_table_privilege('anon', 'public.esh_report_intake_photos', 'select')
  and not has_table_privilege('anon', 'public.esh_public_submit_throttle', 'select'),
  'the photographs and the rate-limit counters are closed to the anonymous role');

select * from finish();
rollback;
