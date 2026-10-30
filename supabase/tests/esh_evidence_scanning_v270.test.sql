-- ============================================================================
-- ESH Finding Management v270: evidence is scanned after it lands.
--
-- v199 pinned this column and said why: "nothing ever claims a file was
-- checked when it was not." Two assertions here exist only to keep that true:
-- a scanner that could not be reached leaves `unavailable`, never `clean`, and
-- a file nobody has looked at stays `not_scanned`.
--
-- The third is quarantine. An infected file is marked `rejected`, which every
-- existing read already excludes, so no download path needed a new gate.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

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
create or replace function pg_temp.v270(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids
select 'action', (public.esh_save_finding(null, jsonb_build_object(
  'title', 'v270 something to photograph', 'description', 'Evidence will be attached.',
  'reported_on', '2026-10-25',
  'accountable_department_id', (select id from public.departments where code = 'OPS'),
  'location', 'BR2', 'required_outcome', 'Correct it.', 'priority', 'normal',
  'risk_level', 'medium',
  'owner_email', 'owner.v270@example.com', 'due_date', '2026-12-10',
  'escalation', '[]'::jsonb, 'no_further_escalation_reason', 'Fixture.'
), true)->>'action_id')::uuid;
insert into ids
select 'finding', finding_id from public.esh_finding_actions where id = pg_temp.v270('action');
select pg_temp.reset_role();

create or replace function pg_temp.attach(p_name text)
returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  insert into public.esh_evidence_assets
    (organization_id, finding_id, action_id, purpose, object_key, original_name,
     declared_size, content_type, size_bytes, content_sha256, state, uploader_kind,
     uploader_user_id, ready_at)
  select a.organization_id, a.finding_id, a.id, 'message',
         'v270/' || p_name || '/' || gen_random_uuid(), p_name || '.jpg',
         120000, 'image/jpeg', 120000,
         -- A ready file carries its hash; the constraint is right to insist.
         encode(sha256(p_name::bytea), 'hex'), 'ready', 'staff',
         'f0c05000-0000-4000-a000-000000000002', now()
    from public.esh_finding_actions a where a.id = pg_temp.v270('action')
  returning id into v_id;
  return v_id;
end;
$$;

insert into ids select 'good', pg_temp.attach('walkway');
insert into ids select 'bad', pg_temp.attach('invoice');

-- ---------------------------------------------------------------------------
-- Nothing claims a file was checked when it was not
-- ---------------------------------------------------------------------------

select is(
  (select scan_state from public.esh_evidence_assets where id = pg_temp.v270('good')),
  'not_scanned',
  'a file nobody has looked at says so');

-- ---------------------------------------------------------------------------
-- The worker claims a batch
-- ---------------------------------------------------------------------------

create temporary table v270_claim as
  select public.esh_scan_claim(50) as result;
grant all on v270_claim to authenticated;

select ok(
  (select (result->>'ok')::boolean from v270_claim),
  'the worker claims a batch');

select ok(
  (select jsonb_array_length(result->'files') >= 2 from v270_claim),
  'and both unscanned files are in it');

select is(
  (select scan_state from public.esh_evidence_assets where id = pg_temp.v270('good')),
  'pending',
  'a claimed file is marked pending so a second worker leaves it alone');

select is(
  (select scan_attempts from public.esh_evidence_assets where id = pg_temp.v270('good')),
  1,
  'and the attempt is counted, so a file cannot be retried forever');

select is(
  (select jsonb_array_length(public.esh_scan_claim(50)->'files')),
  0,
  'a second claim straight away takes nothing, because the first still holds them');

-- ---------------------------------------------------------------------------
-- Recording the verdicts
-- ---------------------------------------------------------------------------

select is(
  public.esh_scan_record(pg_temp.v270('good'), 'probably fine')->>'code',
  'invalid',
  'a verdict has to be one of the three the column allows');

select ok(
  (public.esh_scan_record(pg_temp.v270('good'), 'unavailable', 'scanner timed out')
   ->>'ok')::boolean,
  'a scanner that could not be reached is recorded as such');

/*
 * The assertion the whole column exists for. `unavailable` must never be read
 * as a clean bill of health, and the file stays openable because an outage is
 * not a reason to withhold somebody's evidence.
 */
select is(
  (select scan_state || ' / ' || state from public.esh_evidence_assets
    where id = pg_temp.v270('good')),
  'unavailable / ready',
  'which is not clean, and does not quarantine the file either');

-- ---------------------------------------------------------------------------
-- Quarantine
-- ---------------------------------------------------------------------------

select ok(
  (public.esh_scan_record(pg_temp.v270('bad'), 'infected', 'Eicar-Test-Signature')
   ->>'ok')::boolean,
  'an infected file is recorded');

/*
 * Marked `rejected`, which `esh_guest_file` and the staff route already refuse,
 * so quarantine closed every download path at once rather than one at a time.
 */
select is(
  (select scan_state || ' / ' || state from public.esh_evidence_assets
    where id = pg_temp.v270('bad')),
  'infected / rejected',
  'and quarantined by the state every existing read already excludes');

select * from finish();
rollback;
