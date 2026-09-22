-- ============================================================================
-- v203 — one People & access directory, separate module permissions, and
-- controlled email-contact identity operations (§31, FM56-FM63).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Record the deliberate migration away from the overloaded legacy role.
--
-- `role` remains as a compatibility projection for the existing Focus
-- authorization surface. The two new fields are what the administration UI
-- edits: a Focus preset and a separate platform-administration capability.
-- Existing behavior is preserved exactly by the initial map.
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column focus_access_preset text not null default 'team_member'
    check (focus_access_preset in ('no_access', 'team_member', 'manager')),
  add column platform_administrator boolean not null default false;

update public.user_profiles
   set focus_access_preset = case role
         when 'manager' then 'manager'
         when 'administrator' then 'manager'
         else 'team_member'
       end,
       platform_administrator = role = 'administrator';

create table public.identity_module_access_migrations (
  user_id uuid primary key references public.user_profiles (id) on delete cascade,
  previous_role public.app_role not null,
  focus_access_preset text not null
    check (focus_access_preset in ('no_access', 'team_member', 'manager')),
  platform_administrator boolean not null,
  migration_version text not null default 'v203',
  reviewed boolean not null default true,
  migrated_at timestamptz not null default now()
);

insert into public.identity_module_access_migrations
  (user_id, previous_role, focus_access_preset, platform_administrator)
select id, role, focus_access_preset, platform_administrator
  from public.user_profiles;

-- Local fixtures and newly provisioned identities are inserted after this
-- migration has run. Record their reviewed starting point as well so the
-- separation has one complete, inspectable ledger in every environment.
create or replace function focus.record_module_access_baseline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.identity_module_access_migrations
    (user_id, previous_role, focus_access_preset, platform_administrator)
  values
    (new.id, new.role, new.focus_access_preset, new.platform_administrator)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger user_profiles_record_module_access_baseline
  after insert on public.user_profiles
  for each row execute function focus.record_module_access_baseline();

alter table public.identity_module_access_migrations enable row level security;

create policy identity_module_access_migrations_admin_select
  on public.identity_module_access_migrations
  for select to authenticated
  using (focus.is_admin());

-- Platform administration is no longer inferred from a manager-like business
-- role. Existing administrators remain administrators through the mapped bit.
create or replace function focus.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select p.platform_administrator
      from public.user_profiles p
     where p.id = auth.uid()
       and p.status = 'active'
  ), false);
$$;

create or replace function focus.guard_module_access_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Legacy callers still send `role`. Keep their meaning, while new callers
  -- set the explicit fields under the transaction-local flag below.
  if current_setting('focus.module_access_write', true) is distinct from 'on'
     and (tg_op = 'INSERT' or new.role is distinct from old.role) then
    new.platform_administrator := new.role = 'administrator';
    new.focus_access_preset := case new.role
      when 'manager' then 'manager'
      when 'administrator' then 'manager'
      else 'team_member'
    end;
  end if;

  -- Routine editing can never remove or deactivate the final recovery path.
  if tg_op = 'UPDATE'
     and old.platform_administrator
     and old.status = 'active'
     and (not new.platform_administrator or new.status <> 'active')
     and not exists (
       select 1
         from public.user_profiles p
        where p.id <> old.id
          and p.status = 'active'
          and p.platform_administrator
     ) then
    raise exception using
      errcode = 'P0001',
      message = 'last_platform_administrator';
  end if;

  return new;
end;
$$;

create trigger user_profiles_guard_module_access
  before insert or update of role, focus_access_preset, platform_administrator, status
  on public.user_profiles
  for each row execute function focus.guard_module_access_consistency();

create or replace function public.set_person_module_access(
  p_user_id uuid,
  p_focus_preset text,
  p_platform_administrator boolean,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target public.user_profiles;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  next_role public.app_role;
begin
  if not focus.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if p_focus_preset not in ('no_access', 'team_member', 'manager') then
    return jsonb_build_object('ok', false, 'code', 'focus_preset_invalid');
  end if;
  if coalesce(p_platform_administrator, false) and p_focus_preset = 'no_access' then
    return jsonb_build_object('ok', false, 'code', 'administrator_needs_focus_access');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  select * into target from public.user_profiles where id = p_user_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  if target.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'account_not_active');
  end if;
  if target.platform_administrator and not coalesce(p_platform_administrator, false)
     and not exists (
       select 1 from public.user_profiles p
        where p.id <> target.id and p.status = 'active' and p.platform_administrator
     ) then
    return jsonb_build_object('ok', false, 'code', 'last_administrator');
  end if;

  next_role := case
    when coalesce(p_platform_administrator, false) then 'administrator'::public.app_role
    when p_focus_preset = 'manager' then 'manager'::public.app_role
    else 'team_member'::public.app_role
  end;

  perform set_config('focus.privileged_write', 'on', true);
  perform set_config('focus.module_access_write', 'on', true);
  update public.user_profiles
     set focus_access_preset = p_focus_preset,
         platform_administrator = coalesce(p_platform_administrator, false),
         role = next_role,
         team_summary_mode = case when p_focus_preset = 'manager'
                                  then team_summary_mode
                                  else 'off'::public.team_summary_mode end,
         updated_at = now()
   where id = target.id;

  perform focus.write_audit(
    p_event_type := 'user_updated',
    p_actor_id := actor,
    p_subject_user_id := target.id,
    p_detail := jsonb_build_object(
      'reason', v_reason,
      'module_access', jsonb_build_object(
        'before', jsonb_build_object(
          'focus', target.focus_access_preset,
          'platform_administrator', target.platform_administrator),
        'after', jsonb_build_object(
          'focus', p_focus_preset,
          'platform_administrator', coalesce(p_platform_administrator, false)))));

  insert into public.admin_security_log
    (event_type, actor_user_id, subject_user_id, subject_employee_id,
     subject_email, summary, detail)
  values
    ('user_updated', actor, target.id, target.employee_id, target.email::text,
     format('Changed module access for %s (%s)', target.full_name, target.employee_id),
     jsonb_build_object(
       'reason', v_reason,
       'focus', p_focus_preset,
       'platform_administrator', coalesce(p_platform_administrator, false)));

  return jsonb_build_object(
    'ok', true,
    'focus_preset', p_focus_preset,
    'platform_administrator', coalesce(p_platform_administrator, false));
end;
$$;

-- Exact staff/contact association is directory metadata only. It never turns
-- a guest grant into a staff session or imports staff permissions.
update public.esh_email_principals principal
   set staff_user_id = (
     select profile.id
       from public.user_profiles profile
      where lower(profile.email::text) = principal.canonical_email
      limit 1)
 where principal.staff_user_id is null
   and exists (
     select 1
       from public.user_profiles profile
      where lower(profile.email::text) = principal.canonical_email);

create unique index esh_principal_one_staff_identity
  on public.esh_email_principals (organization_id, staff_user_id)
  where staff_user_id is not null;

create or replace function focus.esh_principal_for(
  p_organization_id uuid,
  p_email text,
  p_actor uuid
)
returns uuid
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  insert into public.esh_email_principals as principal
    (organization_id, display_email, canonical_email, staff_user_id, created_by)
  values
    (p_organization_id, btrim(p_email), focus.esh_canonical_email(p_email),
     (select profile.id
        from public.user_profiles profile
       where lower(profile.email::text) = focus.esh_canonical_email(p_email)
       limit 1),
     p_actor)
  on conflict (organization_id, canonical_email) do update set
    staff_user_id = coalesce(principal.staff_user_id, excluded.staff_user_id),
    updated_at = principal.updated_at
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- 2. A contact directory whose labels come from live relationships.
-- ---------------------------------------------------------------------------

drop function public.esh_admin_contacts(text);

create function public.esh_admin_contacts(p_search text)
returns table (
  id uuid,
  staff_user_id uuid,
  display_email text,
  display_name text,
  status text,
  access_enabled boolean,
  access_changed_at timestamptz,
  access_changed_by text,
  access_reason text,
  open_actions integer,
  configured_escalations integer,
  active_escalations integer,
  report_subscriptions integer,
  held_notifications integer,
  failed_notifications integer,
  last_access_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select principal.id,
         principal.staff_user_id,
         principal.display_email,
         principal.display_name,
         principal.status,
         principal.access_enabled,
         case when principal.access_enabled
              then principal.access_enabled_at else principal.access_disabled_at end,
         (select profile.full_name
            from public.user_profiles profile
           where profile.id = case when principal.access_enabled
                                   then principal.access_enabled_by
                                   else principal.access_disabled_by end),
         principal.access_reason,
         (select count(*)::int
            from public.esh_finding_actions action
            join public.esh_findings finding on finding.id = action.finding_id
           where action.owner_principal_id = principal.id
             and action.state in ('assigned', 'in_progress', 'awaiting_verification')
             and finding.status = 'open'),
         (select count(*)::int
            from public.esh_action_escalation_recipients route
           where route.principal_id = principal.id and route.removed_at is null),
         (select count(*)::int
            from public.esh_escalation_entitlements entitlement
            join public.esh_finding_actions action on action.id = entitlement.action_id
           where entitlement.principal_id = principal.id
             and entitlement.revoked_at is null
             and entitlement.assignment_version = action.assignment_version),
         0::int,
         (select count(*)::int
            from public.esh_notification_outbox outbox
           where outbox.recipient_principal_id = principal.id
             and outbox.state = 'held_rollout'),
         (select count(*)::int
            from public.esh_notification_outbox outbox
           where outbox.recipient_principal_id = principal.id
             and outbox.state = 'failed'),
         (select max(session.last_used_at)
            from public.esh_guest_sessions session
           where session.principal_id = principal.id),
         principal.created_at
    from public.esh_email_principals principal
   where focus.is_admin()
     and (coalesce(btrim(p_search), '') = ''
          or position(lower(btrim(p_search)) in principal.canonical_email) > 0
          or position(lower(btrim(p_search)) in lower(coalesce(principal.display_name, ''))) > 0)
   order by coalesce(principal.display_name, principal.display_email), principal.canonical_email
   limit 500;
$$;

-- Relationship detail is security-invoker on purpose: an administrator who
-- also has scoped Finding access sees the safe row labels their Finding scope
-- permits; administration alone receives the counts above, never content.
create view public.esh_admin_contact_relationships
with (security_invoker = true)
as
select principal.id as principal_id,
       'owner'::text as participation,
       action.id as action_id,
       finding.reference,
       finding.title,
       action.title as action_title,
       action.state,
       action.due_at,
       null::smallint as escalation_level,
       true as activated
  from public.esh_email_principals principal
  join public.esh_finding_actions action on action.owner_principal_id = principal.id
  join public.esh_findings finding on finding.id = action.finding_id
 where action.state in ('assigned', 'in_progress', 'awaiting_verification')
   and finding.status = 'open'
union all
select principal.id,
       'escalation'::text,
       action.id,
       finding.reference,
       finding.title,
       action.title,
       action.state,
       action.due_at,
       route.level,
       exists (
         select 1
           from public.esh_escalation_entitlements entitlement
          where entitlement.action_id = action.id
            and entitlement.principal_id = principal.id
            and entitlement.level = route.level
            and entitlement.assignment_version = action.assignment_version
            and entitlement.revoked_at is null)
  from public.esh_email_principals principal
  join public.esh_action_escalation_recipients route
    on route.principal_id = principal.id and route.removed_at is null
  join public.esh_finding_actions action on action.id = route.action_id
  join public.esh_findings finding on finding.id = action.finding_id
 where finding.status = 'open';

create or replace function public.esh_admin_contact_access_items(p_principal_id uuid)
returns table (
  id uuid,
  kind text,
  purpose text,
  action_id uuid,
  started_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select grant_row.id, 'grant'::text, grant_row.purpose, grant_row.action_id,
         grant_row.issued_at, grant_row.expires_at
    from public.esh_access_grants grant_row
   where focus.is_admin()
     and grant_row.principal_id = p_principal_id
     and grant_row.revoked_at is null
     and grant_row.expires_at > now()
     and (grant_row.consumed_at is null or grant_row.receipt_expires_at > now())
  union all
  select session.id, 'session',
         case when session.inbox_scope then 'owner_inbox' else 'action_session' end,
         null::uuid, session.last_used_at, session.absolute_expires_at
    from public.esh_guest_sessions session
   where focus.is_admin()
     and session.principal_id = p_principal_id
     and session.revoked_at is null
     and session.absolute_expires_at > now()
  union all
  select entitlement.id, 'entitlement', 'escalation_action', entitlement.action_id,
         entitlement.activated_at, null::timestamptz
    from public.esh_escalation_entitlements entitlement
    join public.esh_finding_actions action on action.id = entitlement.action_id
   where focus.is_admin()
     and entitlement.principal_id = p_principal_id
     and entitlement.revoked_at is null
     and entitlement.assignment_version = action.assignment_version
  order by 5 desc;
$$;

-- ---------------------------------------------------------------------------
-- 3. Audited contact controls.
-- ---------------------------------------------------------------------------

create or replace function public.esh_admin_resend_contact_access(
  p_principal_id uuid,
  p_purpose text,
  p_action_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  principal public.esh_email_principals;
  action public.esh_finding_actions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_outbox_id uuid;
  v_event text;
  v_level smallint;
begin
  if not focus.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if v_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  select * into principal from public.esh_email_principals where id = p_principal_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'contact_not_found'); end if;
  if not focus.esh_contact_usable(principal.id) then
    return jsonb_build_object('ok', false, 'code', 'access_not_enabled');
  end if;

  if p_purpose = 'owner_inbox' then
    if not exists (
      select 1 from public.esh_finding_actions a
      join public.esh_findings f on f.id = a.finding_id
       where a.owner_principal_id = principal.id
         and a.state in ('assigned', 'in_progress', 'awaiting_verification')
         and f.status = 'open') then
      return jsonb_build_object('ok', false, 'code', 'no_live_participation');
    end if;
    v_event := 'access_link';
  elsif p_purpose = 'owner_action' then
    select * into action from public.esh_finding_actions where id = p_action_id;
    if not found or not focus.esh_owner_holds(action.id, principal.id, null) then
      return jsonb_build_object('ok', false, 'code', 'no_live_participation');
    end if;
    v_event := 'access_link';
  elsif p_purpose = 'escalation_action' then
    select * into action from public.esh_finding_actions where id = p_action_id;
    select entitlement.level into v_level
      from public.esh_escalation_entitlements entitlement
     where entitlement.action_id = p_action_id
       and entitlement.principal_id = principal.id
       and entitlement.assignment_version = action.assignment_version
       and entitlement.revoked_at is null
     order by entitlement.level desc limit 1;
    if action.id is null or v_level is null then
      return jsonb_build_object('ok', false, 'code', 'no_live_participation');
    end if;
    v_event := 'escalation';
  else
    return jsonb_build_object('ok', false, 'code', 'purpose_invalid');
  end if;

  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, finding_id, action_id,
     state, state_reason, link_intents, idempotency_key, next_attempt_at,
     escalation_level)
  values
    (principal.organization_id, v_event, principal.id, action.finding_id, action.id,
     'queued', 'administrator_resend', jsonb_build_array(p_purpose),
     'admin-resend:' || gen_random_uuid(), now(), v_level)
  returning id into v_outbox_id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id,
     subject_principal_id, detail)
  values
    (principal.organization_id, 'staff', actor, 'contact_access_resent', action.finding_id,
     action.id, principal.id,
     jsonb_build_object('purpose', p_purpose, 'reason', v_reason, 'outbox_id', v_outbox_id));

  return jsonb_build_object('ok', true, 'outbox_id', v_outbox_id);
end;
$$;

create or replace function public.esh_admin_revoke_contact_access(
  p_principal_id uuid,
  p_kind text,
  p_access_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  principal public.esh_email_principals;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  affected integer := 0;
begin
  if not focus.is_admin() then return jsonb_build_object('ok', false, 'code', 'not_permitted'); end if;
  if v_reason is null then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  select * into principal from public.esh_email_principals where id = p_principal_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'contact_not_found'); end if;

  if p_kind = 'grant' then
    update public.esh_access_grants
       set revoked_at = now(), revoked_reason = 'administrator_revoke'
     where id = p_access_id and principal_id = principal.id and revoked_at is null;
    get diagnostics affected = row_count;
    update public.esh_guest_sessions
       set revoked_at = now(), revoked_reason = 'grant_revoked'
     where principal_id = principal.id and grant_id = p_access_id and revoked_at is null;
  elsif p_kind = 'session' then
    update public.esh_guest_sessions
       set revoked_at = now(), revoked_reason = 'administrator_revoke'
     where id = p_access_id and principal_id = principal.id and revoked_at is null;
    get diagnostics affected = row_count;
  elsif p_kind = 'entitlement' then
    update public.esh_escalation_entitlements
       set revoked_at = now(), revoked_reason = 'administrator_revoke'
     where id = p_access_id and principal_id = principal.id and revoked_at is null;
    get diagnostics affected = row_count;
    update public.esh_access_grants
       set revoked_at = now(), revoked_reason = 'entitlement_revoked'
     where principal_id = principal.id and purpose = 'escalation_action'
       and action_id = (select action_id from public.esh_escalation_entitlements where id = p_access_id)
       and revoked_at is null;
  else
    return jsonb_build_object('ok', false, 'code', 'access_kind_invalid');
  end if;

  if affected = 0 then return jsonb_build_object('ok', false, 'code', 'access_not_found'); end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, subject_principal_id, detail)
  values
    (principal.organization_id, 'staff', actor, 'contact_access_revoked', principal.id,
     jsonb_build_object('kind', p_kind, 'access_id', p_access_id, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.esh_admin_disable_contact(
  p_principal_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  principal public.esh_email_principals;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actions integer;
  v_routes integer;
begin
  if not focus.is_admin() then return jsonb_build_object('ok', false, 'code', 'not_permitted'); end if;
  if v_reason is null then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  select * into principal from public.esh_email_principals where id = p_principal_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'contact_not_found'); end if;

  select count(*)::int into v_actions from public.esh_finding_actions a
   where a.owner_principal_id = principal.id
     and a.state in ('assigned', 'in_progress', 'awaiting_verification');
  select count(*)::int into v_routes from public.esh_action_escalation_recipients r
   where r.principal_id = principal.id and r.removed_at is null;

  update public.esh_email_principals
     set status = 'disabled', access_enabled = false,
         access_disabled_by = actor, access_disabled_at = now(), access_reason = v_reason,
         identity_version = identity_version + 1,
         authorization_version = authorization_version + 1,
         updated_at = now()
   where id = principal.id;
  update public.esh_guest_sessions set revoked_at = now(), revoked_reason = 'contact_disabled'
   where principal_id = principal.id and revoked_at is null;
  update public.esh_access_grants set revoked_at = now(), revoked_reason = 'contact_disabled'
   where principal_id = principal.id and revoked_at is null;
  update public.esh_escalation_entitlements
     set revoked_at = now(), revoked_reason = 'contact_disabled'
   where principal_id = principal.id and revoked_at is null;
  update public.esh_notification_outbox
     set state = case when event_type = 'access_link' then 'suppressed' else 'held_rollout' end,
         state_reason = 'contact_disabled', next_attempt_at = null, updated_at = now()
   where recipient_principal_id = principal.id
     and state in ('queued', 'failed', 'processing');

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, subject_principal_id, detail)
  values
    (principal.organization_id, 'staff', actor, 'contact_disabled', principal.id,
     jsonb_build_object('reason', v_reason, 'open_actions', v_actions,
                        'configured_escalations', v_routes));

  return jsonb_build_object('ok', true, 'open_actions', v_actions,
                            'configured_escalations', v_routes);
end;
$$;

create or replace function public.esh_admin_correct_contact_email(
  p_principal_id uuid,
  p_new_email text,
  p_transfer_actions boolean,
  p_transfer_escalations boolean,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  old_principal public.esh_email_principals;
  new_principal public.esh_email_principals;
  v_email text := btrim(coalesce(p_new_email, ''));
  v_canonical text := focus.esh_canonical_email(p_new_email);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  assignment public.esh_action_assignments;
  route public.esh_action_escalation_recipients;
  action public.esh_finding_actions;
  moved_actions integer := 0;
  moved_routes integer := 0;
  moved_entitlements integer := 0;
  disable_old boolean;
begin
  if not focus.is_admin() then return jsonb_build_object('ok', false, 'code', 'not_permitted'); end if;
  if v_reason is null then return jsonb_build_object('ok', false, 'code', 'reason_required'); end if;
  if not focus.esh_email_is_valid(v_email) then
    return jsonb_build_object('ok', false, 'code', 'email_invalid');
  end if;
  if not coalesce(p_transfer_actions, false) and not coalesce(p_transfer_escalations, false) then
    return jsonb_build_object('ok', false, 'code', 'relationship_required');
  end if;

  select * into old_principal from public.esh_email_principals
   where id = p_principal_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'contact_not_found'); end if;
  if old_principal.canonical_email = v_canonical then
    return jsonb_build_object('ok', false, 'code', 'email_unchanged');
  end if;
  if exists (
    select 1 from public.esh_email_principals p
     where p.organization_id = old_principal.organization_id and p.canonical_email = v_canonical
  ) then
    return jsonb_build_object('ok', false, 'code', 'email_in_use');
  end if;

  insert into public.esh_email_principals
    (organization_id, display_email, canonical_email, display_name, staff_user_id,
     status, access_enabled, access_enabled_by, access_enabled_at,
     access_reason, created_by)
  values
    (old_principal.organization_id, v_email, v_canonical, old_principal.display_name,
     (select profile.id from public.user_profiles profile
       where lower(profile.email::text) = v_canonical limit 1),
     'active', old_principal.access_enabled,
     case when old_principal.access_enabled then actor end,
     case when old_principal.access_enabled then now() end,
     v_reason, actor)
  returning * into new_principal;

  -- Every old capability is ended before any relationship is moved. Historical
  -- messages and ended ownership intervals retain the old principal forever.
  update public.esh_guest_sessions set revoked_at = now(), revoked_reason = 'email_corrected'
   where principal_id = old_principal.id and revoked_at is null;
  update public.esh_access_grants set revoked_at = now(), revoked_reason = 'email_corrected'
   where principal_id = old_principal.id and revoked_at is null;

  if coalesce(p_transfer_actions, false) then
    for assignment in
      select current_assignment.*
        from public.esh_action_assignments current_assignment
        join public.esh_finding_actions current_action on current_action.id = current_assignment.action_id
       where current_assignment.principal_id = old_principal.id
         and current_assignment.ended_at is null
         and current_action.state in ('assigned', 'in_progress', 'awaiting_verification')
       for update of current_assignment
    loop
      select * into action from public.esh_finding_actions where id = assignment.action_id for update;
      update public.esh_action_assignments
         set ended_at = now(), reason = coalesce(reason || ' · ', '') || 'Email corrected: ' || v_reason
       where id = assignment.id;
      update public.esh_finding_actions
         set owner_principal_id = new_principal.id,
             assignment_version = assignment_version + 1,
             row_version = row_version + 1,
             updated_at = now()
       where id = action.id
       returning * into action;
      insert into public.esh_action_assignments
        (organization_id, action_id, principal_id, version, assigned_by, reason)
      values
        (action.organization_id, action.id, new_principal.id, action.assignment_version,
         actor, 'Email corrected: ' || v_reason);
      insert into public.esh_notification_outbox
        (organization_id, event_type, recipient_principal_id, finding_id, action_id,
         state, state_reason, link_intents, idempotency_key, next_attempt_at)
      values
        (action.organization_id, 'owner_assignment', new_principal.id, action.finding_id, action.id,
         case when new_principal.access_enabled then 'queued' else 'held_rollout' end,
         'email_corrected', '["owner_action", "owner_inbox"]'::jsonb,
         'email-corrected:' || action.id || ':v' || action.assignment_version,
         case when new_principal.access_enabled then now() end);
      moved_actions := moved_actions + 1;
    end loop;
  end if;

  if coalesce(p_transfer_escalations, false) then
    for route in
      select configured.*
        from public.esh_action_escalation_recipients configured
       where configured.principal_id = old_principal.id and configured.removed_at is null
       for update
    loop
      update public.esh_action_escalation_recipients
         set removed_by = actor, removed_at = now()
       where id = route.id;
      insert into public.esh_action_escalation_recipients
        (organization_id, action_id, level, principal_id, added_by)
      values
        (route.organization_id, route.action_id, route.level, new_principal.id, actor);
      moved_routes := moved_routes + 1;

      update public.esh_escalation_entitlements entitlement
         set revoked_at = now(), revoked_reason = 'email_corrected'
       where entitlement.action_id = route.action_id
         and entitlement.level = route.level
         and entitlement.principal_id = old_principal.id
         and entitlement.revoked_at is null;
      if found then
        select * into action from public.esh_finding_actions where id = route.action_id;
        insert into public.esh_escalation_entitlements
          (organization_id, action_id, level, principal_id, assignment_version,
           activated_event_id, activated_at)
        select entitlement.organization_id, entitlement.action_id, entitlement.level,
               new_principal.id, entitlement.assignment_version,
               entitlement.activated_event_id, entitlement.activated_at
          from public.esh_escalation_entitlements entitlement
         where entitlement.action_id = route.action_id
           and entitlement.level = route.level
           and entitlement.principal_id = old_principal.id
           and entitlement.revoked_reason = 'email_corrected'
         order by entitlement.activated_at desc limit 1;
        insert into public.esh_notification_outbox
          (organization_id, event_type, recipient_principal_id, finding_id, action_id,
           state, state_reason, link_intents, idempotency_key, next_attempt_at, escalation_level)
        values
          (route.organization_id, 'escalation', new_principal.id, action.finding_id, action.id,
           case when new_principal.access_enabled then 'queued' else 'held_rollout' end,
           'email_corrected', '["escalation_action"]'::jsonb,
           'email-corrected-escalation:' || action.id || ':v' || action.assignment_version
             || ':l' || route.level,
           case when new_principal.access_enabled then now() end, route.level);
        moved_entitlements := moved_entitlements + 1;
      end if;
    end loop;
  end if;

  disable_old := not exists (
      select 1 from public.esh_action_assignments a
       where a.principal_id = old_principal.id and a.ended_at is null)
    and not exists (
      select 1 from public.esh_action_escalation_recipients r
       where r.principal_id = old_principal.id and r.removed_at is null);

  update public.esh_email_principals
     set identity_version = identity_version + 1,
         authorization_version = authorization_version + 1,
         status = case when disable_old then 'disabled' else status end,
         access_enabled = case when disable_old then false else access_enabled end,
         access_disabled_by = case when disable_old then actor else access_disabled_by end,
         access_disabled_at = case when disable_old then now() else access_disabled_at end,
         access_reason = v_reason,
         updated_at = now()
   where id = old_principal.id;

  update public.esh_notification_outbox
     set state = case when event_type = 'access_link' then 'suppressed' else 'held_rollout' end,
         state_reason = 'email_corrected', next_attempt_at = null, updated_at = now()
   where recipient_principal_id = old_principal.id
     and state in ('queued', 'failed', 'processing');

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, subject_principal_id, detail)
  values
    (old_principal.organization_id, 'staff', actor, 'contact_email_corrected',
     old_principal.id,
     jsonb_build_object(
       'reason', v_reason,
       'old_email', old_principal.display_email,
       'new_email', new_principal.display_email,
       'new_principal_id', new_principal.id,
       'moved_actions', moved_actions,
       'moved_escalation_routes', moved_routes,
       'moved_escalation_entitlements', moved_entitlements,
       'old_contact_disabled', disable_old));

  return jsonb_build_object(
    'ok', true,
    'new_principal_id', new_principal.id,
    'moved_actions', moved_actions,
    'moved_escalations', moved_routes,
    'old_contact_disabled', disable_old);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'email_in_use');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Grants.
-- ---------------------------------------------------------------------------

revoke all on table public.identity_module_access_migrations from public, anon;
revoke all on table public.esh_admin_contact_relationships from public, anon;
grant select on table public.identity_module_access_migrations to authenticated;
grant select on table public.esh_admin_contact_relationships to authenticated;

revoke all on function public.set_person_module_access(uuid, text, boolean, text)
  from public, anon;
revoke all on function public.esh_admin_contacts(text) from public, anon;
revoke all on function public.esh_admin_contact_access_items(uuid) from public, anon;
revoke all on function public.esh_admin_resend_contact_access(uuid, text, uuid, text)
  from public, anon;
revoke all on function public.esh_admin_revoke_contact_access(uuid, text, uuid, text)
  from public, anon;
revoke all on function public.esh_admin_disable_contact(uuid, text) from public, anon;
revoke all on function public.esh_admin_correct_contact_email(uuid, text, boolean, boolean, text)
  from public, anon;

grant execute on function public.set_person_module_access(uuid, text, boolean, text)
  to authenticated;
grant execute on function public.esh_admin_contacts(text) to authenticated;
grant execute on function public.esh_admin_contact_access_items(uuid) to authenticated;
grant execute on function public.esh_admin_resend_contact_access(uuid, text, uuid, text)
  to authenticated;
grant execute on function public.esh_admin_revoke_contact_access(uuid, text, uuid, text)
  to authenticated;
grant execute on function public.esh_admin_disable_contact(uuid, text) to authenticated;
grant execute on function public.esh_admin_correct_contact_email(uuid, text, boolean, boolean, text)
  to authenticated;
