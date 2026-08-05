-- ============================================================================
-- RLS: effective visibility, and the separation of view from edit
--
-- Covers MASTER_PRODUCT_SPEC.md sections 3.4, 22.5, and Appendix A9, and the
-- acceptance gates in BUILD_ACCEPTANCE_GATES.md section 4.
--
-- These are the properties nothing else in the build can establish. Executing
-- the schema proves the policies compile and attach; only running as a real
-- role with real claims proves they ALLOW and DENY the right rows.
--
-- Each test switches identity with `set local`, so the change is scoped to the
-- surrounding transaction and cannot leak into the next assertion.
-- ============================================================================

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

-- ---------------------------------------------------------------------------
-- Fixture identities (supabase/seed.sql)
-- ---------------------------------------------------------------------------

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

create or replace function pg_temp.act_as_anon()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
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

-- Fixture UUIDs. Business logic never depends on these; tests may.
create or replace function pg_temp.uid(p_who text)
returns uuid
language sql
immutable
as $$
  select case p_who
    when 'admin' then 'f0c05000-0000-4000-a000-000000000001'
    when 'izzul' then 'f0c05000-0000-4000-a000-000000000002'
    when 'amer'  then 'f0c05000-0000-4000-a000-000000000003'
    when 'izzah' then 'f0c05000-0000-4000-a000-000000000004'
    when 'ajmal' then 'f0c05000-0000-4000-a000-000000000005'
    when 'lim'   then 'f0c05000-0000-4000-a000-000000000006'
  end::uuid;
$$;

-- ---------------------------------------------------------------------------
-- 1. Unauthenticated access reads nothing, anywhere.
--
--    `anon` is refused at the PRIVILEGE gate, before RLS is consulted at all,
--    so these raise 42501 rather than returning an empty set. That is the
--    stronger of the two outcomes: there is no unauthenticated surface to
--    filter in the first place.
-- ---------------------------------------------------------------------------

select pg_temp.act_as_anon();

select throws_ok(
  'select id from public.tasks',
  '42501',
  null,
  'anon cannot read tasks');

select throws_ok(
  'select id from public.user_profiles',
  '42501',
  null,
  'anon cannot read user profiles');

select throws_ok(
  'select id from public.audit_events',
  '42501',
  null,
  'anon cannot read audit history');

select throws_ok(
  'select id from public.attachments',
  '42501',
  null,
  'anon cannot read attachments');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 2. The approved visibility example (section 22.5, Appendix A9).
--
--    Amer may VIEW Izzah and Ajmal because they are his interns. He is a team
--    member, not their manager, so the grant conveys sight and nothing else.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('amer'));

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('izzah')),
  'Amer can view Izzah''s work through the explicit grant');

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('ajmal')),
  'Amer can view Ajmal''s work through the explicit grant');

select is_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('lim')),
  'Amer canNOT view Lim, who was never granted');

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('amer')),
  'Amer can always view his own work');

-- ---------------------------------------------------------------------------
-- 3. View access does NOT confer edit, activation, or reassignment.
--
--    This is the property section 3.4 turns on, and the one most likely to be
--    quietly lost in a future change.
-- ---------------------------------------------------------------------------

select is(
  (select (public.activate_task(
     (select id from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'backlog' limit 1),
     (select version from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'backlog' limit 1),
     null, null, null) ->> 'code')),
  'not_authorised',
  'Amer cannot ACTIVATE work he can only view');

select is(
  (select (public.move_task_to_available(
     (select id from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'active' limit 1),
     (select version from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'active' limit 1),
     null) ->> 'code')),
  'not_authorised',
  'Amer cannot MOVE OUT work he can only view');

select is(
  (select (public.reassign_task(
     (select id from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'active' limit 1),
     (select version from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'active' limit 1),
     pg_temp.uid('amer'), null) ->> 'code')),
  'not_authorised',
  'Amer cannot REASSIGN work he can only view');

-- A direct UPDATE must be refused by RLS too, not only by the procedures.
select lives_ok(
  format($q$ update public.tasks set title = 'tampered'
              where primary_owner_id = %L $q$, pg_temp.uid('izzah')),
  'a direct UPDATE against viewable-but-not-editable work does not error');

select is(
  (select count(*)::int from public.tasks
    where primary_owner_id = pg_temp.uid('izzah') and title = 'tampered'),
  0,
  'and it changes nothing, because no row passes the UPDATE policy');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 4. A viewer with no team visibility sees only themselves.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('lim'));

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('lim')),
  'Lim can view his own work');

select is_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('izzah')),
  'Lim, whose mode is none, canNOT view Izzah');

select is_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('amer')),
  'Lim canNOT view Amer');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 5. A manager sees their reporting line; an owner sees their own work.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzul'));

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('izzah')),
  'Izzul, as manager, can view a direct report''s work');

select isnt_empty(
  format('select id from public.tasks where primary_owner_id = %L', pg_temp.uid('lim')),
  'Izzul can view every direct report, including Lim');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 6. Owners have edit authority over their own work.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzah'));

select is(
  (select (public.activate_task(
     (select id from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'backlog' limit 1),
     (select version from public.tasks
       where primary_owner_id = pg_temp.uid('izzah') and status = 'backlog' limit 1),
     null, null, null) ->> 'ok')),
  'true',
  'Izzah CAN activate her own Available Work');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 7. Audit history is append-only through the API.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('izzah'));

select throws_ok(
  $q$ insert into public.audit_events (event_type, actor_id)
      values ('task_activated', null) $q$,
  '42501',
  null,
  'a client cannot forge an audit event');

select throws_ok(
  $q$ update public.audit_events set reason_note = 'rewritten' $q$,
  '42501',
  null,
  'a client cannot rewrite audit history');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 8. A deactivated account loses access even holding a valid token.
-- ---------------------------------------------------------------------------

select public.deactivate_user(pg_temp.uid('lim'), true);

select pg_temp.act_as(pg_temp.uid('lim'));

select is_empty(
  'select id from public.tasks',
  'a deactivated account reads no tasks');

select is_empty(
  'select id from public.user_profiles',
  'a deactivated account reads no profiles');

select pg_temp.reset_role();

-- ---------------------------------------------------------------------------
-- 9. Attachments follow the authorisation of the task that owns them.
-- ---------------------------------------------------------------------------

select pg_temp.act_as(pg_temp.uid('lim'));

select is_empty(
  'select id from public.attachments',
  'a deactivated account reads no attachments either');

select pg_temp.reset_role();

select * from finish();

rollback;
