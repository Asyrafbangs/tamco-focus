-- ============================================================================
-- v223 — The workflow keeps its machinery underneath
--
-- A design review of the working module asked for the interface to stop
-- exposing the rollout, the delivery log and the configuration it runs on.
-- Most of that is presentation. Six things need the database:
--
--   1. Owner email is a mode, not a per-finding act. Test mode holds email to
--      contacts nobody has cleared, as the restricted rollout always has. Live
--      clears a contact the moment work is assigned to them and sends at once.
--      An administrator chooses; a contact an administrator switched off stays
--      off in either mode.
--   2. Everything held can be released in one act, with one reason.
--   3. A department can be added where a finding is being recorded, and the
--      register cannot be split by a near-duplicate spelling of one.
--   4. A department carries its usual escalation route, so a finding (or an
--      imported backlog row) starts from it rather than from an empty form.
--   5. An open finding's wording and its risk can be corrected on the record.
--   6. "Raised in error" is its own administrative outcome; Withdraw is no
--      longer offered for new findings (existing ones keep what they were).
--
-- The register also learns "changes requested", and a held email stops
-- counting as a reason a row needs attention: it is reported once, for the
-- whole system, instead of once per finding.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Owner email mode
-- ---------------------------------------------------------------------------

alter table public.esh_rollout_settings
  add column owner_notices text not null default 'held'
    check (owner_notices in ('held', 'live')),
  add column owner_notices_changed_by uuid references public.user_profiles (id),
  add column owner_notices_changed_at timestamptz;

comment on column public.esh_rollout_settings.owner_notices is
  'v223 - held: email to contacts nobody has cleared waits (test mode). live: assigning work clears the contact and sends.';

/*
 * Whether a contact has been switched off on purpose, as opposed to never
 * having been switched on. Live mode clears the second kind and never the
 * first: an administrator's "off" outlasts any mode.
 */
create or replace function focus.esh_contact_undecided(p public.esh_email_principals)
returns boolean
language sql
immutable
as $$
  select p.status = 'active' and not p.access_enabled and p.access_disabled_at is null;
$$;

/*
 * Clears a contact because work reached them in Live mode, or because an
 * administrator released everything held. Audited as an enablement, marked
 * automatic, so Identity & access can tell the two apart.
 */
create or replace function focus.esh_clear_contact(
  p_principal_id uuid,
  p_actor uuid,
  p_reason text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  p public.esh_email_principals;
begin
  select * into p from public.esh_email_principals where id = p_principal_id for update;
  if not found or not focus.esh_contact_undecided(p) then
    return false;
  end if;
  update public.esh_email_principals set
    access_enabled = true,
    access_enabled_by = p_actor,
    access_enabled_at = now(),
    access_reason = p_reason,
    authorization_version = authorization_version + 1,
    updated_at = now()
   where id = p.id;
  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, subject_principal_id, detail)
  values
    (p.organization_id, case when p_actor is null then 'system' else 'staff' end, p_actor,
     'contact_access_enabled', p.id,
     jsonb_build_object('email', p.display_email, 'reason', p_reason, 'automatic', true));
  return true;
end;
$$;

/*
 * In Live mode a notice that would have been held only because its recipient
 * was never cleared is sent instead, and the recipient is cleared. Every
 * routine that raises a notice already decides held-or-queued by the
 * contact's access; this is the one place that decision is revisited, so no
 * routine has to know which mode is on.
 *
 * A notice held behind a still-held assignment for the same action stays
 * held: a reply never arrives before the assignment it belongs to.
 */
create or replace function focus.esh_live_outbox()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p public.esh_email_principals;
begin
  if new.state <> 'held_rollout' or new.event_type = 'access_link'
     or new.recipient_principal_id is null then
    return new;
  end if;
  if not exists (select 1 from public.esh_rollout_settings r
                  where r.organization_id = new.organization_id and r.owner_notices = 'live') then
    return new;
  end if;
  select * into p from public.esh_email_principals where id = new.recipient_principal_id;
  if not found or p.status <> 'active' then
    return new;
  end if;
  if not p.access_enabled then
    if not focus.esh_contact_undecided(p) then
      return new;
    end if;
    perform focus.esh_clear_contact(p.id, auth.uid(), 'Owner email is live');
  end if;
  if new.action_id is not null and exists (
       select 1 from public.esh_notification_outbox held
        where held.action_id = new.action_id
          and held.recipient_principal_id = new.recipient_principal_id
          and held.event_type = 'owner_assignment'
          and held.state = 'held_rollout') then
    return new;
  end if;
  new.state := 'queued';
  new.state_reason := null;
  new.next_attempt_at := coalesce(new.next_attempt_at, now());
  return new;
end;
$$;

create trigger esh_outbox_live_mode
  before insert on public.esh_notification_outbox
  for each row execute function focus.esh_live_outbox();

/*
 * The organisation an administrator acts for. Platform administration does
 * not come with Finding access (§43.1), so it cannot be read from the
 * caller's ESH access; there is one rollout row, and it names it.
 */
create or replace function focus.esh_admin_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(focus.esh_organization_id(),
                  (select r.organization_id from public.esh_rollout_settings r
                    order by r.initialized_at limit 1));
$$;

/** An administrator chooses the mode. Switching to Live releases nothing by itself. */
create or replace function public.esh_set_owner_notices(p_mode text, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_admin_organization_id();
  current_mode text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor is null or not focus.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if coalesce(p_mode, '') not in ('held', 'live') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  select owner_notices into current_mode from public.esh_rollout_settings
   where organization_id = org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'rollout_not_configured');
  end if;
  if current_mode = p_mode then
    return jsonb_build_object('ok', true, 'unchanged', true, 'mode', p_mode);
  end if;
  update public.esh_rollout_settings set
    owner_notices = p_mode,
    owner_notices_changed_by = actor,
    owner_notices_changed_at = now(),
    updated_at = now()
   where organization_id = org;
  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'owner_notices_changed',
          jsonb_build_object('from', current_mode, 'to', p_mode, 'reason', v_reason));
  return jsonb_build_object('ok', true, 'mode', p_mode);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. What is held, and releasing all of it
-- ---------------------------------------------------------------------------

/*
 * Counts only, for the one line that replaces a "not told yet" row per
 * finding. Any ESH member may read it; nothing here names a finding.
 */
create or replace function public.esh_held_summary()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when not focus.esh_enabled() and not focus.is_admin() then
    jsonb_build_object('ok', false, 'code', 'not_permitted')
  else jsonb_build_object(
    'ok', true,
    'mode', (select r.owner_notices from public.esh_rollout_settings r
              where r.organization_id = focus.esh_admin_organization_id()),
    'held', (select count(*) from public.esh_notification_outbox o
              where o.organization_id = focus.esh_admin_organization_id()
                and o.state = 'held_rollout' and o.event_type <> 'access_link'),
    'assignments', (select count(*) from public.esh_notification_outbox o
                     where o.organization_id = focus.esh_admin_organization_id()
                       and o.state = 'held_rollout'
                       and o.event_type in ('owner_assignment', 'import_assignment')),
    'recipients', (select count(distinct o.recipient_principal_id)
                     from public.esh_notification_outbox o
                    where o.organization_id = focus.esh_admin_organization_id()
                      and o.state = 'held_rollout' and o.event_type <> 'access_link'),
    -- Held because an administrator switched the contact off: Release all
    -- leaves these alone, and says so.
    'switched_off', (select count(distinct o.recipient_principal_id)
                       from public.esh_notification_outbox o
                       join public.esh_email_principals p on p.id = o.recipient_principal_id
                      where o.organization_id = focus.esh_admin_organization_id()
                        and o.state = 'held_rollout' and o.event_type <> 'access_link'
                        and not p.access_enabled and not focus.esh_contact_undecided(p)))
  end;
$$;

/*
 * Release everything held, in one act (§43.4 kept: it is still a deliberate
 * release, made once for the system instead of once per finding).
 *
 * Contacts nobody decided about are cleared; contacts an administrator
 * switched off are left off and their notices stay held. An assignment goes
 * before the replies behind it, which it then covers. A held assignment for
 * work its recipient no longer owns is cancelled, because it announces
 * something that is no longer true.
 */
create or replace function public.esh_release_all_held(p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_admin_organization_id();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_cleared integer := 0;
  v_released integer := 0;
  v_covered integer := 0;
  v_stale integer := 0;
  v_count integer;
  principal_id uuid;
begin
  if actor is null or not focus.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if org is null then
    return jsonb_build_object('ok', false, 'code', 'rollout_not_configured');
  end if;

  for principal_id in
    select distinct o.recipient_principal_id
      from public.esh_notification_outbox o
     where o.organization_id = org and o.state = 'held_rollout'
       and o.event_type <> 'access_link' and o.recipient_principal_id is not null
  loop
    if focus.esh_clear_contact(principal_id, actor, v_reason) then
      v_cleared := v_cleared + 1;
    end if;
  end loop;

  -- Stale assignments: the recipient no longer owns the work.
  update public.esh_notification_outbox o set
    state = 'cancelled', state_reason = 'no_longer_the_owner',
    next_attempt_at = null, updated_at = now()
   where o.organization_id = org and o.state = 'held_rollout'
     and o.event_type = 'owner_assignment'
     and not focus.esh_owner_holds(o.action_id, o.recipient_principal_id, null);
  get diagnostics v_stale = row_count;

  -- Assignments first.
  update public.esh_notification_outbox o set
    state = 'queued', state_reason = null, next_attempt_at = now(),
    released_by = actor, released_at = now(), updated_at = now()
   where o.organization_id = org and o.state = 'held_rollout'
     and o.event_type in ('owner_assignment', 'import_assignment')
     and focus.esh_contact_usable(o.recipient_principal_id);
  get diagnostics v_released = row_count;

  -- A reply held behind an assignment just released is covered by it.
  update public.esh_notification_outbox o set
    state = 'suppressed', state_reason = 'covered_by_assignment_email', updated_at = now()
   where o.organization_id = org and o.state = 'held_rollout' and o.event_type = 'esh_reply'
     and exists (select 1 from public.esh_notification_outbox a
                  where a.action_id = o.action_id
                    and a.recipient_principal_id = o.recipient_principal_id
                    and a.event_type = 'owner_assignment'
                    and a.released_at is not null and a.released_by = actor
                    and a.released_at = now());
  get diagnostics v_covered = row_count;

  -- Everything else whose recipient can now be reached. Dispatch re-checks
  -- each one, so a reminder for work already moved on is dropped there.
  update public.esh_notification_outbox o set
    state = 'queued', state_reason = null, next_attempt_at = now(),
    released_by = actor, released_at = now(), updated_at = now()
   where o.organization_id = org and o.state = 'held_rollout'
     and o.event_type not in ('access_link', 'owner_assignment', 'import_assignment')
     and focus.esh_contact_usable(o.recipient_principal_id)
     and not exists (select 1 from public.esh_notification_outbox a
                      where a.action_id = o.action_id
                        and a.recipient_principal_id = o.recipient_principal_id
                        and a.event_type = 'owner_assignment'
                        and a.state = 'held_rollout');
  get diagnostics v_count = row_count;
  v_released := v_released + v_count;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'notifications_released_all',
          jsonb_build_object('reason', v_reason, 'contacts_cleared', v_cleared,
                             'released', v_released, 'covered', v_covered,
                             'stale_cancelled', v_stale));

  return jsonb_build_object(
    'ok', true, 'contacts_cleared', v_cleared, 'released', v_released,
    'covered', v_covered, 'stale_cancelled', v_stale,
    'still_held', (select count(*) from public.esh_notification_outbox o
                    where o.organization_id = org and o.state = 'held_rollout'
                      and o.event_type <> 'access_link'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Adding a department where a finding is recorded
-- ---------------------------------------------------------------------------

/*
 * The comparison key for department names: case, spacing, punctuation and
 * "&" versus "and" do not make two departments. "Ware House", "warehouse"
 * and "WAREHOUSE." are one name.
 */
create or replace function focus.esh_department_key(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(replace(lower(coalesce(p_name, '')), '&', 'and'), '[^a-z0-9]', '', 'g');
$$;

/*
 * Creates a department from the finding form. ESH coordinators with
 * organisation-wide scope only: a department-scoped coordinator could create
 * one they are then unable to see. A name that matches an existing active
 * department by key is refused with that department, which the form selects
 * instead.
 */
create or replace function public.esh_create_department(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_key text := focus.esh_department_key(p_name);
  v_base text;
  v_code text;
  v_suffix integer := 1;
  existing public.departments;
  created uuid;
begin
  if actor is null or not focus.esh_can('coordinate') or not focus.esh_scope_all() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if length(v_key) < 2 or length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'code', 'name_invalid');
  end if;
  select * into existing from public.departments d
   where d.status = 'active' and focus.esh_department_key(d.name) = v_key
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'code', 'exists',
                              'id', existing.id, 'name', existing.name);
  end if;

  v_base := left(upper(regexp_replace(v_name, '[^A-Za-z0-9]+', '_', 'g')), 28);
  v_base := btrim(v_base, '_');
  if length(v_base) < 2 then v_base := 'DEPT'; end if;
  v_code := v_base;
  while exists (select 1 from public.departments where code = v_code) loop
    v_suffix := v_suffix + 1;
    v_code := v_base || '_' || v_suffix;
  end loop;

  insert into public.departments (code, name) values (v_code, v_name)
  returning id into created;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'department_created',
          jsonb_build_object('department_id', created, 'name', v_name, 'code', v_code));
  perform focus.write_audit(
    p_event_type := 'settings_changed',
    p_actor_id := actor,
    p_detail := jsonb_build_object('action', 'department_created', 'department_id', created,
                                   'code', v_code, 'name', v_name, 'via', 'finding_management'));

  return jsonb_build_object('ok', true, 'id', created, 'name', v_name, 'code', v_code);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A department's usual escalation route
-- ---------------------------------------------------------------------------

create table public.esh_department_routes (
  organization_id uuid not null references public.organizations (id),
  department_id uuid not null references public.departments (id) on delete cascade,
  level smallint not null check (level between 1 and 9),
  email text not null check (focus.esh_email_is_valid(email)),
  canonical_email text not null,
  updated_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  primary key (department_id, level, canonical_email),
  check (canonical_email = focus.esh_canonical_email(email))
);

alter table public.esh_department_routes enable row level security;

create policy esh_department_routes_select on public.esh_department_routes
  as permissive for select to authenticated
  using ((select focus.esh_enabled())
         and organization_id = (select focus.esh_organization_id()));

revoke all on public.esh_department_routes from anon, authenticated;
grant select on public.esh_department_routes to authenticated;

/** The route as the finding form and the import send it: [{level, email}]. */
create or replace function focus.esh_department_route(p_department_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('level', r.level, 'email', r.email)
                            order by r.level, r.email), '[]'::jsonb)
    from public.esh_department_routes r
   where r.department_id = p_department_id;
$$;

/*
 * Replaces a department's route. Verifiers, as for the rest of follow-up
 * policy. Levels start at 1 without gaps; an empty route clears it. Live
 * actions keep the route they were assigned with — this only changes what
 * the next finding starts from.
 */
create or replace function public.esh_set_department_route(p_department_id uuid, p_route jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  entry jsonb;
  level_no integer;
  levels integer[] := '{}';
  before jsonb;
begin
  if actor is null or not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if not exists (select 1 from public.departments where id = p_department_id) then
    return jsonb_build_object('ok', false, 'code', 'department_not_found');
  end if;
  if jsonb_typeof(coalesce(p_route, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  for entry in select value from jsonb_array_elements(coalesce(p_route, '[]'::jsonb)) loop
    begin
      level_no := (entry->>'level')::int;
    exception when others then
      level_no := null;
    end;
    if level_no is null or level_no < 1 or level_no > 9 then
      return jsonb_build_object('ok', false, 'code', 'escalation_level_invalid');
    end if;
    if not focus.esh_email_is_valid(entry->>'email') then
      return jsonb_build_object('ok', false, 'code', 'escalation_email_invalid');
    end if;
    if not (level_no = any (levels)) then levels := levels || level_no; end if;
  end loop;
  if cardinality(levels) > 0 and (select max(l) from unnest(levels) l) <> cardinality(levels) then
    return jsonb_build_object('ok', false, 'code', 'escalation_levels_have_gaps');
  end if;

  before := focus.esh_department_route(p_department_id);
  delete from public.esh_department_routes where department_id = p_department_id;
  insert into public.esh_department_routes
    (organization_id, department_id, level, email, canonical_email, updated_by)
  select distinct on (level, focus.esh_canonical_email(email))
         org, p_department_id, level, email, focus.esh_canonical_email(email), actor
    from (select (value->>'level')::smallint as level, btrim(value->>'email') as email
            from jsonb_array_elements(coalesce(p_route, '[]'::jsonb))) given;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'department_route_changed',
          jsonb_build_object('department_id', p_department_id, 'from', before,
                             'to', focus.esh_department_route(p_department_id)));
  return jsonb_build_object('ok', true, 'route', focus.esh_department_route(p_department_id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Correcting an open finding
-- ---------------------------------------------------------------------------

/*
 * The wording and place of an open finding, and its department, corrected
 * with the before and after on the record. The owner, the deadline and the
 * follow-up schedule are untouched; a department move stays inside the
 * coordinator's own scope at both ends.
 */
create or replace function public.esh_edit_finding(
  p_finding_id uuid,
  p_title text,
  p_description text,
  p_location text,
  p_department_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  f public.esh_findings;
  v_title text := btrim(coalesce(p_title, ''));
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
  v_location text := nullif(btrim(coalesce(p_location, '')), '');
  changed jsonb := '{}'::jsonb;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into f from public.esh_findings
   where id = p_finding_id and organization_id = org for update;
  if not found or not (focus.esh_scope_all()
                       or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if f.status not in ('new', 'open') then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  if length(v_title) = 0 or length(v_title) > 200 then
    return jsonb_build_object('ok', false, 'code', 'title_required');
  end if;
  if v_description is null then
    return jsonb_build_object('ok', false, 'code', 'description_required');
  end if;
  if p_department_id is null then
    return jsonb_build_object('ok', false, 'code', 'department_required');
  end if;
  if p_department_id is distinct from f.accountable_department_id and not (
       focus.esh_scope_all() or p_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'department_out_of_scope');
  end if;
  if not exists (select 1 from public.departments where id = p_department_id) then
    return jsonb_build_object('ok', false, 'code', 'department_not_found');
  end if;

  if v_title is distinct from f.title then
    changed := changed || jsonb_build_object('title', jsonb_build_array(f.title, v_title));
  end if;
  if v_description is distinct from f.description then
    changed := changed || jsonb_build_object('description',
                                             jsonb_build_array(f.description, v_description));
  end if;
  if v_location is distinct from f.location then
    changed := changed || jsonb_build_object('location', jsonb_build_array(f.location, v_location));
  end if;
  if p_department_id is distinct from f.accountable_department_id then
    changed := changed || jsonb_build_object('department',
                                             jsonb_build_array(f.accountable_department_id,
                                                               p_department_id));
  end if;
  if changed = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'code', 'unchanged');
  end if;

  update public.esh_findings set
    title = v_title,
    description = v_description,
    location = v_location,
    accountable_department_id = p_department_id,
    updated_at = now(),
    row_version = row_version + 1
   where id = f.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'finding_edited', f.id, jsonb_build_object('changed', changed));

  return jsonb_build_object('ok', true, 'changed', changed);
end;
$$;

/*
 * Risk, reassessed. Like priority (v208) it moves nothing else: the follow-up
 * rule an action was assigned under stays the one it runs by.
 */
create or replace function public.esh_set_risk(p_finding_id uuid, p_risk text, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  f public.esh_findings;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if coalesce(p_risk, '') not in ('not_assessed', 'low', 'medium', 'high', 'critical') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  select * into f from public.esh_findings
   where id = p_finding_id and organization_id = org for update;
  if not found or not (focus.esh_scope_all()
                       or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if f.status not in ('new', 'open') then
    return jsonb_build_object('ok', false, 'code', 'not_open');
  end if;
  if f.risk_level = p_risk then
    return jsonb_build_object('ok', false, 'code', 'unchanged');
  end if;

  update public.esh_findings set
    risk_level = p_risk,
    risk_assessed_by = case when p_risk = 'not_assessed' then null else actor end,
    risk_assessed_at = case when p_risk = 'not_assessed' then null else now() end,
    updated_at = now(),
    row_version = row_version + 1
   where id = f.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'risk_changed', f.id,
          jsonb_build_object('from', f.risk_level, 'to', p_risk, 'reason', v_reason,
                             'followup_unchanged', true));

  return jsonb_build_object('ok', true, 'risk', p_risk, 'followup_unchanged', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Raised in error, and no new Withdraw
-- ---------------------------------------------------------------------------

alter table public.esh_findings
  drop constraint if exists esh_findings_resolved_outcome_check;
alter table public.esh_findings
  add constraint esh_findings_resolved_outcome_check
  check (resolved_outcome in ('cancelled', 'duplicate', 'withdrawn', 'raised_in_error'));

/*
 * v209's routine with its outcomes changed: Cancel, Duplicate, Raised in
 * error. A finding raised in error is recorded with status Cancelled — it is
 * no longer anybody's work — and the outcome says why. Withdraw stays
 * readable on findings that already carry it and is refused for new ones.
 */
create or replace function public.esh_resolve_finding(
  p_finding_id uuid,
  p_outcome text,
  p_reason text,
  p_duplicate_of uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  f public.esh_findings;
  other public.esh_findings;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actions uuid[];
  v_status text;
begin
  if actor is null or not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if coalesce(p_outcome, '') not in ('cancelled', 'duplicate', 'raised_in_error') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  v_status := case when p_outcome = 'raised_in_error' then 'cancelled' else p_outcome end;
  if length(v_reason) not between 3 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  select * into f from public.esh_findings
   where id = p_finding_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if not (focus.esh_scope_all()
          or f.accountable_department_id = any (focus.esh_visible_department_ids())
          or f.accountable_department_id is null) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if f.status = 'closed' then
    return jsonb_build_object('ok', false, 'code', 'already_closed');
  end if;
  if f.resolved_outcome is not null then
    return jsonb_build_object('ok', false, 'code', 'already_resolved',
                              'outcome', f.resolved_outcome);
  end if;

  if p_outcome = 'duplicate' then
    if p_duplicate_of is null then
      return jsonb_build_object('ok', false, 'code', 'duplicate_of_required');
    end if;
    select * into other from public.esh_findings
     where id = p_duplicate_of and organization_id = org;
    if not found or other.id = f.id then
      return jsonb_build_object('ok', false, 'code', 'duplicate_not_found');
    end if;
    if other.resolved_outcome is not null then
      return jsonb_build_object('ok', false, 'code', 'duplicate_not_live');
    end if;
  elsif p_duplicate_of is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select coalesce(array_agg(id), '{}') into v_actions
    from public.esh_finding_actions
   where finding_id = f.id and state in ('assigned', 'in_progress', 'awaiting_verification');

  update public.esh_finding_actions set
    state = 'cancelled',
    updated_at = now(),
    row_version = row_version + 1
   where id = any(v_actions);

  update public.esh_findings set
    status = v_status,
    status_reason = v_reason,
    resolved_outcome = p_outcome,
    resolved_at = now(),
    resolved_by = actor,
    duplicate_of_finding_id = case when p_outcome = 'duplicate' then p_duplicate_of end,
    updated_at = now(),
    row_version = row_version + 1
   where id = f.id;

  update public.esh_access_grants set
    revoked_at = now(),
    revoked_reason = 'finding_resolved'
   where action_id = any(v_actions) and revoked_at is null and consumed_at is null;
  update public.esh_guest_sessions session set
    revoked_at = now(),
    revoked_reason = 'finding_resolved'
   where session.revoked_at is null
     and session.inbox_scope is not true
     and exists (select 1 from public.esh_access_grants g
                  where g.id = session.grant_id and g.action_id = any(v_actions));
  update public.esh_notification_outbox set
    state = 'cancelled',
    state_reason = 'finding_' || v_status,
    next_attempt_at = null,
    updated_at = now()
   where finding_id = f.id and state in ('queued', 'failed', 'held_rollout', 'digested');
  update public.esh_digest_members set state = 'removed', removed_reason = 'finding_resolved'
   where action_id = any(v_actions) and state = 'included';

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values
    (org, 'staff', actor, 'finding_resolved', f.id,
     jsonb_build_object('outcome', p_outcome, 'reason', v_reason,
                        'duplicate_of', p_duplicate_of,
                        'actions_cancelled', coalesce(cardinality(v_actions), 0)));

  return jsonb_build_object('ok', true, 'outcome', p_outcome,
                            'actions_cancelled', coalesce(cardinality(v_actions), 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The register: changes requested, and held stops being per-row attention
-- ---------------------------------------------------------------------------

/*
 * The last decision on this assignment sent the correction back, and the
 * owner has not submitted again. The owner still has the action; what they
 * owe is different, so the register says so.
 */
create or replace function focus.esh_changes_requested(p_action_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce((
    select s.state = 'changes_requested'
      from public.esh_action_submissions s
      join public.esh_finding_actions a on a.id = s.action_id
     where s.action_id = p_action_id
       and s.assignment_version = a.assignment_version
       and a.state in ('assigned', 'in_progress')
       and s.state in ('changes_requested', 'pending', 'accepted')
     order by s.version desc
     limit 1), false);
$$;

create or replace view public.esh_register_rows
with (security_invoker = true)
as
select f.id as finding_id,
       f.organization_id,
       f.reference,
       f.title,
       f.location,
       f.status,
       f.is_restricted,
       f.risk_level,
       f.accountable_department_id,
       d.name as department_name,
       f.created_at,
       f.closed_at,
       a.id as action_id,
       a.state as action_state,
       a.priority,
       a.due_at,
       a.due_is_date_only,
       (select count(*) from public.esh_finding_actions x where x.finding_id = f.id) as action_count,
       p.display_email as owner_email,
       coalesce(held.any_held, false) as notification_held,
       coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false) as is_overdue,
       -- v223: a held email is reported once for the whole system, not as a
       -- reason each row needs attention.
       (f.status in ('draft', 'new')
        or (f.status = 'open'
            and (coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false)
                 or coalesce(a.state = 'awaiting_verification', false)
                 or coalesce(failed.any_failed, false)))) as needs_attention,
       coalesce(latest.occurred_at, f.created_at) as last_update_at,
       coalesce(latest.event_type, 'finding_created') as last_update_type,
       coalesce(failed.any_failed, false) as notification_failed,
       coalesce(p.status = 'active' and p.access_enabled, false) as owner_access_enabled,
       escalated.level as escalation_level,
       coalesce(focus.esh_changes_requested(a.id), false) as changes_requested
  from public.esh_findings f
  left join public.departments d on d.id = f.accountable_department_id
  left join lateral (
    select * from public.esh_finding_actions x
     where x.finding_id = f.id
     order by x.sequence
     limit 1
  ) a on true
  left join public.esh_email_principals p on p.id = a.owner_principal_id
  left join lateral (
    select true as any_held
      from public.esh_notification_outbox o
     where o.action_id = a.id and o.state = 'held_rollout'
     limit 1
  ) held on true
  left join lateral (
    select max(e.level) as level
      from public.esh_escalation_entitlements e
     where e.action_id = a.id
       and e.revoked_at is null
       and e.assignment_version = a.assignment_version
  ) escalated on true
  left join lateral (
    select true as any_failed
      from public.esh_notification_outbox o
     where o.action_id = a.id
       and (o.state = 'bounced' or (o.state = 'failed' and o.next_attempt_at is null))
     limit 1
  ) failed on true
  left join lateral (
    select e.occurred_at, e.event_type
      from public.esh_audit_events e
     where e.finding_id = f.id
       and e.event_type in ('finding_created', 'action_assigned', 'action_started',
                            'owner_message', 'esh_message', 'escalation_message',
                            'submission_created', 'submission_withdrawn')
     order by e.occurred_at desc,
              array_position(array['submission_created', 'submission_withdrawn',
                                   'owner_message', 'esh_message', 'escalation_message',
                                   'action_started', 'action_assigned', 'finding_created'],
                             e.event_type)
     limit 1
  ) latest on true;

create or replace view public.esh_action_register_rows
with (security_invoker = true)
as
select f.id as finding_id,
       f.organization_id,
       f.reference,
       f.title,
       f.location,
       f.status,
       f.is_restricted,
       f.risk_level,
       f.accountable_department_id,
       d.name as department_name,
       f.created_at,
       f.closed_at,
       a.id as action_id,
       a.sequence as action_sequence,
       a.title as action_title,
       a.state as action_state,
       a.priority,
       a.baseline_due_at,
       a.due_at,
       a.due_is_date_only,
       (select count(*) from public.esh_finding_actions x where x.finding_id = f.id) as action_count,
       p.display_email as owner_email,
       coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false) as is_overdue,
       coalesce(held.any_held, false) as notification_held,
       coalesce(failed.any_failed, false) as notification_failed,
       (coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false)
        or coalesce(a.state = 'awaiting_verification', false)
        or coalesce(failed.any_failed, false)) as needs_attention,
       coalesce(latest.occurred_at, a.assigned_at, a.created_at) as last_update_at,
       coalesce(latest.event_type, 'action_assigned') as last_update_type,
       coalesce(focus.esh_changes_requested(a.id), false) as changes_requested
  from public.esh_findings f
  join public.esh_finding_actions a on a.finding_id = f.id
  left join public.departments d on d.id = f.accountable_department_id
  left join public.esh_email_principals p on p.id = a.owner_principal_id
  left join lateral (
    select true as any_held
      from public.esh_notification_outbox o
     where o.action_id = a.id and o.state = 'held_rollout'
     limit 1
  ) held on true
  left join lateral (
    select true as any_failed
      from public.esh_notification_outbox o
     where o.action_id = a.id
       and (o.state = 'bounced' or (o.state = 'failed' and o.next_attempt_at is null))
     limit 1
  ) failed on true
  left join lateral (
    select e.occurred_at, e.event_type
      from public.esh_audit_events e
     where e.action_id = a.id
       and e.event_type in ('action_assigned', 'action_started', 'owner_message', 'esh_message',
                            'escalation_message', 'submission_created', 'submission_withdrawn')
     order by e.occurred_at desc,
              array_position(array['submission_created', 'submission_withdrawn',
                                   'owner_message', 'esh_message', 'escalation_message',
                                   'action_started', 'action_assigned'],
                             e.event_type)
     limit 1
  ) latest on true;

-- ---------------------------------------------------------------------------
-- 8. An imported backlog starts from its department's route
-- ---------------------------------------------------------------------------

/*
 * v205's release, with one change: a released row is assigned with its
 * department's usual escalation route when the department has one, and says
 * "set on review" only when it does not. Everything else is as it was.
 */
create or replace function public.esh_import_release(
  p_batch_id uuid,
  p_row_ids uuid[],
  p_followup_from timestamptz,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  replay jsonb;
  batch public.esh_import_batches;
  row_record public.esh_import_rows;
  saved jsonb;
  v_payload jsonb;
  v_department uuid;
  v_route jsonb;
  v_created integer := 0;
  v_owners integer := 0;
  v_followup timestamptz := coalesce(p_followup_from, now());
  v_result jsonb;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  replay := focus.replay_operation(actor, p_idempotency_key);
  if replay is not null then return replay; end if;

  select * into batch from public.esh_import_batches
   where id = p_batch_id and organization_id = org for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if batch.state <> 'staged' then
    return jsonb_build_object('ok', false, 'code', 'not_staging', 'state', batch.state);
  end if;
  if coalesce(cardinality(p_row_ids), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_selected');
  end if;
  if v_followup > now() + interval '30 days' then
    return jsonb_build_object('ok', false, 'code', 'followup_too_far');
  end if;

  if exists (select 1 from public.esh_import_rows
              where batch_id = batch.id and id = any(p_row_ids) and outcome <> 'ready') then
    return jsonb_build_object('ok', false, 'code', 'row_not_ready');
  end if;
  if exists (select 1 from public.esh_import_evidence_refs
              where batch_id = batch.id and state = 'unresolved'
                and (row_id is null or row_id = any(p_row_ids))) then
    return jsonb_build_object('ok', false, 'code', 'evidence_unresolved');
  end if;

  for row_record in
    select * from public.esh_import_rows
     where batch_id = batch.id and id = any(p_row_ids) and outcome = 'ready'
     order by source_line
     for update
  loop
    v_department := focus.esh_import_department(row_record.mapped->>'department');
    v_route := case when v_department is null then '[]'::jsonb
                    else focus.esh_department_route(v_department) end;
    v_payload := jsonb_build_object(
      'title', left(coalesce(nullif(btrim(coalesce(row_record.mapped->>'title', '')), ''),
                             btrim(row_record.mapped->>'description')), 200),
      'description', row_record.mapped->>'description',
      'reported_on', nullif(btrim(coalesce(row_record.mapped->>'reported_on', '')), ''),
      'location', nullif(btrim(coalesce(row_record.mapped->>'location', '')), ''),
      'accountable_department_id', v_department,
      'risk_level', case
                      when lower(coalesce(row_record.mapped->>'risk', ''))
                           in ('low', 'medium', 'high', 'critical')
                      then lower(row_record.mapped->>'risk') else 'not_assessed' end,
      'source', 'import',
      'source_reference', row_record.source_reference,
      'source_register', batch.source_register,
      'import_batch_id', batch.id,
      'import_row_id', row_record.id,
      'followup_active_from', v_followup,
      'required_outcome', row_record.mapped->>'action',
      'action_title', left(coalesce(nullif(btrim(coalesce(row_record.mapped->>'title', '')), ''),
                                    btrim(row_record.mapped->>'description')), 200),
      'priority', lower(row_record.mapped->>'priority'),
      'owner_email', coalesce(
        (select canonical_email from public.esh_import_owner_emails
          where batch_id = batch.id
            and lower(source_name) = lower(btrim(coalesce(row_record.mapped->>'owner_name', '')))),
        lower(btrim(row_record.mapped->>'owner_email'))),
      'due_date', row_record.mapped->>'due_on',
      'escalation', v_route,
      'no_further_escalation_reason',
        case when jsonb_array_length(v_route) = 0
             then 'Imported backlog: the escalation route is set on review.' end);

    saved := public.esh_save_finding(null, v_payload, true,
                                     'import:' || batch.id || ':' || row_record.id);
    if not coalesce((saved->>'ok')::boolean, false) then
      raise exception 'import row % could not be released: %', row_record.source_line, saved
        using errcode = 'data_exception';
    end if;

    update public.esh_import_rows set
      outcome = 'released',
      finding_id = (saved->>'finding_id')::uuid,
      action_id = (saved->>'action_id')::uuid,
      released_at = now(),
      updated_at = now()
     where id = row_record.id;

    if nullif(btrim(coalesce(row_record.mapped->>'remarks', '')), '') is not null then
      insert into public.esh_audit_events
        (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
      values
        (org, 'staff', actor, 'import_note', (saved->>'finding_id')::uuid,
         (saved->>'action_id')::uuid,
         jsonb_build_object('batch_id', batch.id, 'source_line', row_record.source_line,
                            'source_status', row_record.mapped->>'status',
                            'remarks', left(btrim(row_record.mapped->>'remarks'), 4000)));
    end if;

    v_created := v_created + 1;
  end loop;

  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, import_batch_id, state,
     link_intents, idempotency_key, next_attempt_at)
  select org, 'import_assignment', action.owner_principal_id, batch.id,
         case when focus.esh_contact_usable(action.owner_principal_id)
              then 'queued' else 'held_rollout' end,
         '["owner_inbox"]'::jsonb,
         'import_assignment:' || batch.id || ':' || action.owner_principal_id,
         case when focus.esh_contact_usable(action.owner_principal_id) then now() end
    from public.esh_import_rows imported
    join public.esh_finding_actions action on action.id = imported.action_id
   where imported.batch_id = batch.id and imported.id = any(p_row_ids)
     and imported.outcome = 'released'
   group by action.owner_principal_id
  on conflict (idempotency_key) do nothing;
  get diagnostics v_owners = row_count;

  update public.esh_import_batches set
    state = case when exists (select 1 from public.esh_import_rows
                               where batch_id = batch.id and outcome in ('ready', 'blocked'))
                 then 'staged' else 'released' end,
    released_at = coalesce(released_at, now()),
    released_by = coalesce(released_by, actor)
   where id = batch.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'import_released',
          jsonb_build_object('batch_id', batch.id, 'findings', v_created,
                             'owners_notified', v_owners,
                             'followup_from', v_followup));

  v_result := jsonb_build_object('ok', true, 'released', v_created, 'owners', v_owners,
                                 'followup_from', v_followup);
  return focus.remember_operation(actor, p_idempotency_key, 'esh_import_release', v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_contact_undecided(public.esh_email_principals)
  from public, anon, authenticated;
revoke all on function focus.esh_clear_contact(uuid, uuid, text) from public, anon, authenticated;
revoke all on function focus.esh_live_outbox() from public, anon, authenticated;
revoke all on function focus.esh_department_route(uuid) from public, anon, authenticated;
revoke all on function focus.esh_admin_organization_id() from public, anon, authenticated;
grant execute on function focus.esh_department_key(text) to authenticated;
grant execute on function focus.esh_changes_requested(uuid) to authenticated;

revoke all on function public.esh_set_owner_notices(text, text) from public, anon;
revoke all on function public.esh_held_summary() from public, anon;
revoke all on function public.esh_release_all_held(text) from public, anon;
revoke all on function public.esh_create_department(text) from public, anon;
revoke all on function public.esh_set_department_route(uuid, jsonb) from public, anon;
revoke all on function public.esh_edit_finding(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.esh_set_risk(uuid, text, text) from public, anon;

grant execute on function public.esh_set_owner_notices(text, text) to authenticated;
grant execute on function public.esh_held_summary() to authenticated;
grant execute on function public.esh_release_all_held(text) to authenticated;
grant execute on function public.esh_create_department(text) to authenticated;
grant execute on function public.esh_set_department_route(uuid, jsonb) to authenticated;
grant execute on function public.esh_edit_finding(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.esh_set_risk(uuid, text, text) to authenticated;
