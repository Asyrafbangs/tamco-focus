-- ============================================================================
-- ESH Finding Management v224: the rollout has two settings, and held mail can
-- be let go at once.
--
-- §43.2, §43.3, §43.4, §43.5; FM105, FM106, FM107. What only the database can
-- establish: the mode is an administrator's decision and nobody else's, going
-- live reaches contacts nobody named individually, a contact somebody switched
-- off on purpose stays off through a broad launch, going live sends nothing by
-- itself, coming back to restricted takes hold at once, and releasing in bulk
-- obeys every rule the one-at-a-time release obeys.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

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

create temporary table v224 (name text primary key, id uuid);
grant all on v224 to authenticated;

-- A finding assigned to somebody nobody has cleared: the ordinary starting
-- point of every assignment under a restricted rollout.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into v224 (name, id)
select 'action',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v224 blocked exit',
          'description', 'Pallets stacked across the fire exit.',
          'reported_on', '2026-09-21',
          'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 Warehouse',
          'required_outcome', 'Clear the exit and keep it marked.',
          'priority', 'high',
          'owner_email', 'rollout.owner.v224@example.com',
          'due_date', '2026-11-30',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture needs no route.'), true)->>'action_id')::uuid;
insert into v224 (name, id)
select 'owner', id from public.esh_email_principals
 where canonical_email = 'rollout.owner.v224@example.com';

select is((select state from public.esh_notification_outbox
            where action_id = (select id from v224 where name = 'action')
              and event_type = 'owner_assignment'),
          'held_rollout',
          'an assignment to an uncleared contact starts held, as it always did');

/*
 * Bulk release acts on everything held, so the fixtures this database was
 * seeded with would decide the counts below. One held letter, and the counts
 * mean what they say. Inside a transaction that rolls back.
 */
select pg_temp.reset_role();
delete from public.esh_notification_outbox
 where state = 'held_rollout'
   and action_id is distinct from (select id from v224 where name = 'action');

-- ---------------------------------------------------------------------------
-- The mode is an administrator's decision (§43.2)
-- ---------------------------------------------------------------------------

select is(public.esh_set_rollout_mode('live', 'Trying it on from ESH.')->>'code',
          'not_permitted',
          'an ESH verifier cannot open the rollout');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select is(public.esh_set_rollout_mode('everyone', 'A mode that does not exist.')->>'code',
          'mode_invalid', 'and there are only two modes to choose from');
select is(public.esh_set_rollout_mode('live', 'go')->>'code', 'reason_required',
          'a broad launch is not recorded as the word "go"');
select is((select mode from public.esh_rollout_settings), 'restricted',
          'a refused change leaves the rollout exactly as it was');

-- ---------------------------------------------------------------------------
-- Bulk release obeys the same rules as releasing one (§43.4, FM106)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((public.esh_release_held_notifications()->>'released')::integer, 0,
          'nothing is released while the contacts are not cleared');
select is(public.esh_release_held_notifications()->'reasons'->>'contact_access_off', '1',
          'and it says which rule stopped each one');
select is((select state from public.esh_notification_outbox
            where action_id = (select id from v224 where name = 'action')
              and event_type = 'owner_assignment'),
          'held_rollout', 'the letter is still held');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is(public.esh_release_held_notifications()->>'code', 'not_permitted',
          'somebody outside ESH cannot release anything');

-- ---------------------------------------------------------------------------
-- Going live (§43.3)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_rollout_mode('live',
             'Broad launch approved: every supervisor now owns actions.')->>'ok')::boolean,
          'an administrator opens the rollout, with a reason');
select is((select authorization_version from public.esh_rollout_settings), 2,
          'and the rollout authorisation moves with it');

select pg_temp.reset_role();
select ok(focus.esh_contact_usable((select id from v224 where name = 'owner')),
          'a contact nobody named individually is now reachable');

/*
 * The rule lives in one function now, so everything that decides whether a
 * letter waits asks that function. Four places used to decide it themselves,
 * and with the rollout open they went on holding mail it could have sent.
 */
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
insert into v224 (name, id)
select 'live_action',
       (public.esh_save_finding(null, jsonb_build_object(
          'title', 'v224 spill by the press',
          'description', 'Oil pooling under the press guard.',
          'reported_on', '2026-09-21',
          'accountable_department_id', pg_temp.ops(),
          'location', 'BR2 Workshop',
          'required_outcome', 'Stop the leak and clean the floor.',
          'priority', 'normal',
          'owner_email', 'rollout.second.v224@example.com',
          'due_date', '2026-11-30',
          'escalation', '[]'::jsonb,
          'no_further_escalation_reason', 'Fixture needs no route.'), true)->>'action_id')::uuid;
select is((select state from public.esh_notification_outbox
            where action_id = (select id from v224 where name = 'live_action')
              and event_type = 'owner_assignment'),
          'queued',
          'an assignment made while the rollout is open is never held');
-- The register is read straight from the application, with select *, so the
-- column that used to state this must be gone rather than merely corrected.
select hasnt_column('public', 'esh_register_rows', 'owner_access_enabled',
          'and the register no longer carries a copy of the rule');

-- Going live is not sending (FM106): the two acts stay two acts.
select is((select state from public.esh_notification_outbox
            where action_id = (select id from v224 where name = 'action')
              and event_type = 'owner_assignment'),
          'held_rollout',
          'what was held before the launch is still held after it');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((public.esh_release_held_notifications()->>'released')::integer, 1,
          'and one press now lets it go');
select is((select state from public.esh_notification_outbox
            where action_id = (select id from v224 where name = 'action')
              and event_type = 'owner_assignment'),
          'queued', 'the letter is queued for the next dispatch');

/*
 * A released backlog's own letters (§41).
 *
 * `esh_import_release` writes one summary per owner for the whole batch, so the
 * row carries a batch and no finding. Releasing asked for the finding's
 * department and refused every one of them — which meant an imported backlog
 * could queue ninety-four letters that nothing was able to send.
 */
select pg_temp.reset_role();
insert into public.esh_import_batches
  (id, organization_id, source_name, source_hash, source_register, state, created_by, released_at)
values ('b0000000-0000-4000-a000-0000000002a6',
        'e5e50000-0000-4000-8000-000000000001', 'v226 backlog.xlsx', repeat('a', 64),
        'BR2 ESH register', 'released', 'f0c05000-0000-4000-a000-000000000002', now());
insert into public.esh_notification_outbox
  (organization_id, event_type, recipient_principal_id, import_batch_id, state, link_intents,
   idempotency_key)
values ('e5e50000-0000-4000-8000-000000000001', 'import_assignment',
        (select id from v224 where name = 'owner'), 'b0000000-0000-4000-a000-0000000002a6',
        'held_rollout', '["owner_inbox"]'::jsonb, 'v224:import_assignment');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
select is((public.esh_release_held_notifications('b0000000-0000-4000-a000-0000000002a6'::uuid)
            ->>'released')::integer, 1,
          'a batch summary belonging to no single finding can be released');
select is((select state from public.esh_notification_outbox
            where idempotency_key = 'v224:import_assignment'),
          'queued', 'and the backlog finally tells its owners');

-- ---------------------------------------------------------------------------
-- Somebody switched off on purpose stays off (§43.5)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok(not ((public.esh_set_contact_access((select id from v224 where name = 'owner'),
                  false, 'Left the company.')->>'unchanged')::boolean is true),
          'switching off a contact live mode was reaching is a real change');
select pg_temp.reset_role();
select ok(not focus.esh_contact_usable((select id from v224 where name = 'owner')),
          'and they are not reachable, live mode or not');
select is((select state from public.esh_notification_outbox
            where action_id = (select id from v224 where name = 'action')
              and event_type = 'owner_assignment'),
          'held_rollout', 'their queued letter goes back to held at once');

-- ---------------------------------------------------------------------------
-- Coming back to restricted takes hold at once (FM107)
-- ---------------------------------------------------------------------------

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.esh_set_contact_access((select id from v224 where name = 'owner'),
             true, 'Came back as a contractor.')->>'ok')::boolean,
          'an administrator clears them again by name');

select ok((public.esh_set_rollout_mode('restricted',
             'Closing the launch while the mail provider is replaced.')->>'ok')::boolean,
          'the rollout can be closed again');
select pg_temp.reset_role();
select ok(focus.esh_contact_usable((select id from v224 where name = 'owner')),
          'a contact cleared by name survives the rollout closing');
-- FM107: closing the rollout takes hold at once for whoever it was reaching.
select is((select state from public.esh_notification_outbox
            where action_id = (select id from v224 where name = 'live_action')
              and event_type = 'owner_assignment'),
          'held_rollout',
          'and a letter queued only because it was open goes back to held');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select is(public.esh_rollout_status()->>'mode', 'restricted',
          'and the administration screen reads the mode back');

select * from finish();
rollback;
