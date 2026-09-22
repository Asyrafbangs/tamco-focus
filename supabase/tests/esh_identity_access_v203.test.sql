-- ESH Finding Management v203: identity, module access and contact controls.
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
create temporary table v203_ids (name text primary key, id uuid);
grant all on v203_ids to authenticated;
create or replace function pg_temp.v203_id(p_name text)
returns uuid language sql stable as $$ select id from v203_ids where name = p_name $$;

select is((select count(*) from public.identity_module_access_migrations),
          (select count(*) from public.user_profiles),
          'every existing person has a reviewed migration record');
select is((select focus_access_preset from public.user_profiles
            where id = 'f0c05000-0000-4000-a000-000000000001'), 'manager',
          'the existing administrator keeps manager-like Focus access');
select ok((select platform_administrator from public.user_profiles
            where id = 'f0c05000-0000-4000-a000-000000000001'),
          'the existing administrator is explicitly a platform administrator');
select ok(not (select platform_administrator from public.user_profiles
                where id = 'f0c05000-0000-4000-a000-000000000002'),
          'an existing manager is not silently made a platform administrator');
select ok(not exists(select 1 from public.esh_staff_access
                       where user_id = 'f0c05000-0000-4000-a000-000000000001'),
          'platform administration does not imply Finding business access');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000003');
select is((public.set_person_module_access(
  'f0c05000-0000-4000-a000-000000000005', 'manager', false, 'unauthorised')->>'code'),
  'not_permitted', 'a normal user cannot change module access');
select pg_temp.reset_role();

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select ok((public.set_person_module_access(
  'f0c05000-0000-4000-a000-000000000005', 'manager', false, 'Access review')->>'ok')::boolean,
  'a platform administrator can change the Focus preset');
select pg_temp.reset_role();
select is((select focus_access_preset from public.user_profiles
            where id = 'f0c05000-0000-4000-a000-000000000005'), 'manager',
          'the explicit Focus preset is stored');
select is((select role::text from public.user_profiles
            where id = 'f0c05000-0000-4000-a000-000000000005'), 'manager',
          'the compatibility role follows the explicit preset');
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select is((public.set_person_module_access(
  'f0c05000-0000-4000-a000-000000000005', 'no_access', true, 'Bad combination')->>'code'),
  'administrator_needs_focus_access', 'an incompatible administration combination is refused');

-- One unknown address owns an action and is also configured on a second route.
select pg_temp.act_as('f0c05000-0000-4000-a000-000000000002');
with saved as (
  select public.esh_save_finding(null, jsonb_build_object(
    'title', 'v203 identity owner', 'description', 'Identity fixture',
    'reported_on', '2026-09-20',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Correct it', 'priority', 'normal',
    'owner_email', 'wrong.v203@example.com', 'due_date', '2026-10-20',
    'escalation', '[]'::jsonb,
    'no_further_escalation_reason', 'Fixture route is on the second action.'
  ), true, 'v203-owner') value
)
insert into v203_ids
select 'owner_finding', (value->>'finding_id')::uuid from saved
union all select 'owner_action', (value->>'action_id')::uuid from saved;

with saved as (
  select public.esh_save_finding(null, jsonb_build_object(
    'title', 'v203 identity escalation', 'description', 'Identity fixture',
    'reported_on', '2026-09-20',
    'accountable_department_id', (select id from public.departments where code = 'OPS'),
    'required_outcome', 'Correct it', 'priority', 'normal',
    'owner_email', 'another.v203@example.com', 'due_date', '2026-10-20',
    'escalation', jsonb_build_array(jsonb_build_object(
      'level', 1, 'email', 'wrong.v203@example.com'))
  ), true, 'v203-route') value
)
insert into v203_ids
select 'route_finding', (value->>'finding_id')::uuid from saved
union all select 'route_action', (value->>'action_id')::uuid from saved;

select pg_temp.reset_role();
insert into v203_ids
select 'old_principal', id from public.esh_email_principals
 where canonical_email = 'wrong.v203@example.com';

select is((select count(*) from auth.users), 7::bigint,
          'assigning an unknown email creates no authentication account');
select is((select staff_user_id from public.esh_email_principals
            where id = pg_temp.v203_id('old_principal')), null::uuid,
          'the unknown address remains a contact identity');

insert into public.esh_escalation_entitlements
  (organization_id, action_id, level, principal_id, assignment_version)
select action.organization_id, action.id, 1, pg_temp.v203_id('old_principal'),
       action.assignment_version
  from public.esh_finding_actions action where action.id = pg_temp.v203_id('route_action');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select is((select open_actions from public.esh_admin_contacts('wrong.v203')), 1,
          'the live owner label comes from an open action');
select is((select configured_escalations from public.esh_admin_contacts('wrong.v203')), 1,
          'configured escalation participation is counted separately');
select is((select active_escalations from public.esh_admin_contacts('wrong.v203')), 1,
          'activated escalation participation is counted separately');
select ok((public.esh_set_contact_access(
  pg_temp.v203_id('old_principal'), true, 'Approved fixture access')->>'ok')::boolean,
  'the administrator can enable the contact');
select pg_temp.reset_role();

create temporary table v203_grant as
with inserted as (
  insert into public.esh_access_grants
    (organization_id, principal_id, purpose, action_id, assignment_version,
     token_hash, issued_reason, expires_at)
  select action.organization_id, pg_temp.v203_id('old_principal'), 'owner_action', action.id,
         action.assignment_version, repeat('a', 64), 'recovery', now() + interval '1 day'
    from public.esh_finding_actions action where action.id = pg_temp.v203_id('owner_action')
  returning id
)
select id from inserted;

create temporary table v203_session as
with inserted as (
  insert into public.esh_guest_sessions
    (organization_id, principal_id, session_hash, identity_version, grant_id,
     absolute_expires_at)
  select principal.organization_id, principal.id, repeat('b', 64), principal.identity_version,
         grant_row.id, now() + interval '2 hours'
    from public.esh_email_principals principal cross join v203_grant grant_row
   where principal.id = pg_temp.v203_id('old_principal')
  returning id
)
select id from inserted;

insert into public.esh_action_messages
  (organization_id, action_id, author_kind, author_principal_id, author_email, body, client_key)
select action.organization_id, action.id, 'owner', pg_temp.v203_id('old_principal'),
       'wrong.v203@example.com', 'Historical author text', 'v203-old-author'
  from public.esh_finding_actions action where action.id = pg_temp.v203_id('owner_action');

select pg_temp.act_as('f0c05000-0000-4000-a000-000000000001');
select is((public.esh_admin_correct_contact_email(
  pg_temp.v203_id('old_principal'), 'another.v203@example.com', true, true,
  'Would merge identities')->>'code'), 'email_in_use',
  'correction never silently merges with another contact');

with corrected as (
  select public.esh_admin_correct_contact_email(
    pg_temp.v203_id('old_principal'), 'correct.v203@example.com', true, true,
    'Address was entered incorrectly') value
)
insert into v203_ids select 'new_principal', (value->>'new_principal_id')::uuid from corrected;
select pg_temp.reset_role();

select is((select owner_principal_id from public.esh_finding_actions
            where id = pg_temp.v203_id('owner_action')), pg_temp.v203_id('new_principal'),
          'selected live action ownership moves to the corrected identity');
select is((select principal_id from public.esh_action_escalation_recipients
            where action_id = pg_temp.v203_id('route_action') and removed_at is null),
          pg_temp.v203_id('new_principal'),
          'selected live escalation routes move to the corrected identity');
select ok(exists(select 1 from public.esh_action_assignments
                  where action_id = pg_temp.v203_id('owner_action')
                    and principal_id = pg_temp.v203_id('old_principal') and ended_at is not null),
          'the old ownership interval is ended, not rewritten');
select ok(exists(select 1 from public.esh_action_assignments
                  where action_id = pg_temp.v203_id('owner_action')
                    and principal_id = pg_temp.v203_id('new_principal') and ended_at is null),
          'a fresh ownership interval records the corrected identity');
select is((select author_principal_id from public.esh_action_messages
            where client_key = 'v203-old-author'), pg_temp.v203_id('old_principal'),
          'historical message authorship remains on the old identity');
select ok((select revoked_at is not null from public.esh_access_grants
            where id = (select id from v203_grant)),
          'all old grants are revoked before the move');
select ok((select revoked_at is not null from public.esh_guest_sessions
            where id = (select id from v203_session)),
          'all old sessions are revoked before the move');
select is((select status from public.esh_email_principals
            where id = pg_temp.v203_id('old_principal')), 'disabled',
          'the exhausted old identity is disabled');
select is((select count(*) from public.esh_notification_outbox
            where recipient_principal_id = pg_temp.v203_id('new_principal')
              and state_reason = 'email_corrected'), 2::bigint,
          'fresh access is issued only to the corrected identity');
select ok(exists(select 1 from public.esh_audit_events
                  where event_type = 'contact_email_corrected'
                    and subject_principal_id = pg_temp.v203_id('old_principal')),
          'the correction and its reason are audited');

select * from finish();
rollback;
