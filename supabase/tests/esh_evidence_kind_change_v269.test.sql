-- ============================================================================
-- ESH Finding Management v269: the kind of proof can be corrected.
--
-- The case this exists for: the owner sent a photograph, and a photograph
-- cannot show that an interlock functions. Before this, the only way to say so
-- was a sentence in the conversation -- the unenforceable prose that v266
-- existed to replace.
--
-- The change is audited with both values, because changing what will be
-- accepted after somebody has already sent something is a decision the owner
-- is entitled to see the history of.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

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
create or replace function pg_temp.v269(p_name text)
returns uuid language sql stable as $$ select id from ids where name = p_name $$;

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into ids
select 'action', (public.esh_save_finding(null, jsonb_build_object(
  'title', 'v269 interlock bypassed', 'description', 'The guard interlock has a magnet on it.',
  'reported_on', '2026-10-20',
  'accountable_department_id', (select id from public.departments where code = 'OPS'),
  'location', 'BR2', 'required_outcome', 'Restore the interlock.', 'priority', 'high',
  'risk_level', 'critical', 'evidence_kind', 'photograph',
  'owner_email', 'owner.v269@example.com', 'due_date', '2026-12-10',
  'escalation', '[]'::jsonb, 'no_further_escalation_reason', 'Fixture.'
), true)->>'action_id')::uuid;
insert into ids
select 'finding', finding_id from public.esh_finding_actions where id = pg_temp.v269('action');

select is(
  (select evidence_kind from public.esh_finding_actions where id = pg_temp.v269('action')),
  'photograph',
  'assignment recorded what would be accepted (v266)');

-- ---------------------------------------------------------------------------
-- Correcting it
-- ---------------------------------------------------------------------------

select is(
  public.esh_set_evidence_kind(pg_temp.v269('action'), 'interpretive_dance')->>'code',
  'invalid',
  'the kinds are a list, not free text');

select ok(
  (public.esh_set_evidence_kind(pg_temp.v269('action'), 'functional_test')->>'ok')::boolean,
  'a photograph cannot show an interlock works, so ESH asks for a test instead');

select is(
  (select evidence_kind from public.esh_finding_actions where id = pg_temp.v269('action')),
  'functional_test',
  'and that is what the owner is now asked for');

select is(
  public.esh_set_evidence_kind(pg_temp.v269('action'), 'functional_test')->>'code',
  'unchanged',
  'setting it to what it already is changes nothing and says so');

select ok(
  exists(select 1 from public.esh_audit_events
          where finding_id = pg_temp.v269('finding')
            and event_type = 'evidence_kind_changed'
            and detail->>'from' = 'photograph'
            and detail->>'to' = 'functional_test'),
  'the change is on the audit trail with both values');

-- ---------------------------------------------------------------------------
-- Authority
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(
  public.esh_set_evidence_kind(pg_temp.v269('action'), 'measurement')->>'code',
  'not_permitted',
  'somebody without Finding access cannot change what will be accepted');

select * from finish();
rollback;
