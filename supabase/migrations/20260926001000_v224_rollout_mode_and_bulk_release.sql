-- ============================================================================
-- v224 — The rollout has a second setting, and held mail can be let go at once
--
-- Two things made the restricted rollout (§43) feel like a tax on ordinary
-- work rather than the safety gate it is.
--
-- The first: `mode` could only ever be 'restricted', so §43.2's "a future
-- broad launch requires an explicit authorized decision" had nowhere to be
-- recorded. The decision existed only as a migration somebody would one day
-- write. It is now a value an administrator sets, with a reason, audited in
-- both the ESH record and the administrator's security log. It is still not
-- automatic and there is still no date on which it opens by itself: §43.2's
-- prohibition is on a *fallback*, and a switch a named administrator throws
-- and signs for is the opposite of a fallback. 'restricted' remains the
-- default and the value every new deployment starts at.
--
-- In 'live' mode a contact is usable without being named individually — except
-- one an administrator deliberately switched off, who stays off (§43.5: a
-- routine change must never re-enable somebody who was revoked on purpose).
--
-- The second: held mail was released one notification at a time, by design
-- (FM106, and it is a good design for one finding). For an imported backlog of
-- ninety-four it is not a design, it is an afternoon. Releasing in bulk here
-- does not loosen a single rule: it calls the very same
-- `esh_release_notification` for each one, so the contact must be usable, the
-- owner must still hold the action, and an assignment still goes before the
-- replies it would otherwise repeat.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The mode, and who set it (§43.2, §43.6)
-- ---------------------------------------------------------------------------

alter table public.esh_rollout_settings
  drop constraint esh_rollout_settings_mode_check;
alter table public.esh_rollout_settings
  add constraint esh_rollout_settings_mode_check check (mode in ('restricted', 'live'));

alter table public.esh_rollout_settings
  add column mode_changed_by uuid references public.user_profiles (id),
  add column mode_changed_at timestamptz,
  add column mode_reason text,
  -- §43.6 asks the rollout settings to carry a version, as the per-identity
  -- entitlements already do. A mode change moves it, so anything holding an
  -- older authorisation is stale by inspection.
  add column authorization_version integer not null default 1;

/*
 * Whether a contact may use email-link access at all right now (§43.3).
 *
 * Restricted: an administrator switched this contact on, one at a time.
 * Live: every active contact may be written to, apart from anyone an
 * administrator deliberately switched off — `access_disabled_by` is the record
 * of a person having made that decision, and a broad launch does not overrule
 * it (§43.5).
 */
create or replace function focus.esh_contact_usable(p_principal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.esh_email_principals p
      join public.esh_rollout_settings r on r.organization_id = p.organization_id
     where p.id = p_principal_id
       and p.status = 'active'
       and (p.access_enabled
            or (r.mode = 'live' and p.access_disabled_by is null))
  );
$$;

/*
 * Switching one contact off has to keep meaning it (§31.3, §43.2, FM107).
 *
 * Unchanged from v198 but for the shortcut below. "Off already" used to be the
 * same question as "the flag is already false", and in live mode it is not: a
 * contact who was never named individually is reachable all the same, so an
 * administrator switching them off was told "nothing to change" while the
 * person stayed reachable. The flag is now read against what it actually
 * means — and switching somebody off deliberately is what live mode is
 * required to respect (§43.5), so it has to be possible to do.
 */
create or replace function public.esh_set_contact_access(
  p_principal_id uuid,
  p_enabled boolean,
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
  p public.esh_email_principals;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_sessions integer := 0;
  v_held integer := 0;
begin
  if not focus.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into p from public.esh_email_principals where id = p_principal_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'contact_not_found');
  end if;
  if not exists (select 1 from public.esh_rollout_settings r where r.organization_id = p.organization_id) then
    return jsonb_build_object('ok', false, 'code', 'rollout_not_configured');
  end if;
  if p_enabled and p.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'contact_disabled');
  end if;
  -- Asking for off while the flag is off is a real change unless somebody has
  -- already made it: without the record of a person's decision, live mode
  -- would leave this contact reachable.
  if p.access_enabled = p_enabled
     and (p_enabled or p.access_disabled_by is not null) then
    return jsonb_build_object('ok', true, 'unchanged', true, 'enabled', p_enabled);
  end if;

  update public.esh_email_principals set
    access_enabled = p_enabled,
    access_enabled_by = case when p_enabled then actor else access_enabled_by end,
    access_enabled_at = case when p_enabled then now() else access_enabled_at end,
    access_disabled_by = case when p_enabled then access_disabled_by else actor end,
    access_disabled_at = case when p_enabled then access_disabled_at else now() end,
    access_reason = v_reason,
    authorization_version = authorization_version + 1,
    updated_at = now()
   where id = p.id;

  if not p_enabled then
    update public.esh_guest_sessions set revoked_at = now(), revoked_reason = 'access_disabled'
     where principal_id = p.id and revoked_at is null;
    get diagnostics v_sessions = row_count;
    update public.esh_access_grants set revoked_at = now(), revoked_reason = 'access_disabled'
     where principal_id = p.id and consumed_at is null and revoked_at is null;
    update public.esh_notification_outbox set
      state = case when event_type = 'access_link' then 'suppressed' else 'held_rollout' end,
      state_reason = 'access_disabled',
      next_attempt_at = null,
      updated_at = now()
     where recipient_principal_id = p.id and state in ('queued', 'failed');
    get diagnostics v_held = row_count;
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, subject_principal_id, detail)
  values
    (p.organization_id, 'staff', actor,
     case when p_enabled then 'contact_access_enabled' else 'contact_access_disabled' end,
     p.id,
     jsonb_build_object('email', p.display_email, 'reason', v_reason,
                        'sessions_ended', v_sessions, 'notifications_held', v_held));

  return jsonb_build_object('ok', true, 'enabled', p_enabled);
end;
$$;

/*
 * Set the rollout mode (§43.2). Administrators only, a reason in words, and
 * recorded in both audit trails because this is the widest access decision in
 * the module.
 *
 * Going live sends nothing. Enabling and releasing stay two deliberate acts
 * (FM106): what was held before this moment is still held afterwards, and
 * `esh_release_held_notifications` below is the second act.
 *
 * Coming back to restricted takes effect at once, exactly as revoking one
 * contact does (FM107): whoever was reachable only because of live mode loses
 * their sessions and unspent links, and anything queued for them goes back to
 * held. The work itself is untouched.
 */
create or replace function public.esh_set_rollout_mode(p_mode text, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  r public.esh_rollout_settings;
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_sessions integer := 0;
  v_grants integer := 0;
  v_held integer := 0;
  v_actor_name text;
  v_detail jsonb;
begin
  if actor is null or not focus.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if v_mode not in ('restricted', 'live') then
    return jsonb_build_object('ok', false, 'code', 'mode_invalid');
  end if;
  -- Ten characters, not three: this one is read back later by somebody asking
  -- why every contact in the company became reachable on a Thursday.
  if length(v_reason) < 10 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;

  -- One organisation, one rollout. Anything else fails closed rather than
  -- guessing which one the administrator meant (§43.6).
  if (select count(*) from public.esh_rollout_settings) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'rollout_not_configured');
  end if;
  select * into r from public.esh_rollout_settings for update;

  if r.mode = v_mode then
    return jsonb_build_object('ok', true, 'unchanged', true, 'mode', v_mode);
  end if;

  update public.esh_rollout_settings set
    mode = v_mode,
    mode_changed_by = actor,
    mode_changed_at = now(),
    mode_reason = left(v_reason, 400),
    authorization_version = authorization_version + 1,
    updated_at = now()
   where organization_id = r.organization_id;

  if v_mode = 'restricted' then
    /*
     * Everyone who was usable only because the mode was live is now not, and
     * `esh_contact_usable` above already says so. These three statements make
     * that effective rather than merely true: a live session is not a fresh
     * authorisation check.
     */
    update public.esh_guest_sessions set
      revoked_at = now(), revoked_reason = 'rollout_restricted'
     where organization_id = r.organization_id
       and revoked_at is null
       and not focus.esh_contact_usable(principal_id);
    get diagnostics v_sessions = row_count;

    update public.esh_access_grants set
      revoked_at = now(), revoked_reason = 'rollout_restricted'
     where organization_id = r.organization_id
       and consumed_at is null
       and revoked_at is null
       and not focus.esh_contact_usable(principal_id);
    get diagnostics v_grants = row_count;

    update public.esh_notification_outbox set
      state = case when event_type = 'access_link' then 'suppressed' else 'held_rollout' end,
      state_reason = 'rollout_restricted',
      next_attempt_at = null,
      updated_at = now()
     where organization_id = r.organization_id
       and state in ('queued', 'failed')
       and recipient_principal_id is not null
       and not focus.esh_contact_usable(recipient_principal_id);
    get diagnostics v_held = row_count;
  end if;

  select full_name into v_actor_name from public.user_profiles where id = actor;
  v_detail := jsonb_build_object(
    'action', 'esh_rollout_mode_changed',
    'from', r.mode, 'to', v_mode, 'reason', left(v_reason, 400),
    'sessions_ended', v_sessions, 'links_revoked', v_grants,
    'notifications_held', v_held);

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (r.organization_id, 'staff', actor, 'rollout_mode_changed', v_detail);

  insert into public.admin_security_log
    (event_type, actor_user_id, summary, detail)
  values ('settings_changed', actor,
          format('Finding Management rollout set to %s by %s',
                 v_mode, coalesce(v_actor_name, 'an administrator')),
          v_detail);

  return jsonb_build_object('ok', true, 'mode', v_mode, 'sessions_ended', v_sessions,
                            'links_revoked', v_grants, 'notifications_held', v_held);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Releasing what is held, in one act (§43.4)
-- ---------------------------------------------------------------------------

/*
 * Release every held notification the caller can act on, oldest assignment
 * first. Optionally only one import batch's, which is how a released backlog
 * tells its own owners.
 *
 * Every rule is the single-notification procedure's, because this calls it:
 * nothing here decides who may be written to, whether the owner still holds
 * the action, or which letter must go first. What it adds is one press instead
 * of ninety-four, and a tally of what would not go and why.
 */
create or replace function public.esh_release_held_notifications(
  p_import_batch_id uuid default null,
  p_limit integer default 500
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
  held record;
  one jsonb;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
  v_released integer := 0;
  v_covered integer := 0;
  v_skipped integer := 0;
  v_code text;
  v_reasons jsonb := '{}'::jsonb;
  v_remaining integer := 0;
begin
  if actor is null or org is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if p_import_batch_id is not null
     and not exists (select 1 from public.esh_import_batches
                      where id = p_import_batch_id and organization_id = org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  for held in
    select o.id, o.event_type
      from public.esh_notification_outbox o
     where o.organization_id = org
       and o.state = 'held_rollout'
       and (p_import_batch_id is null or o.import_batch_id = p_import_batch_id)
     -- An assignment before the replies to it: released the other way round,
     -- the single-notification procedure refuses the reply as premature.
     order by case when o.event_type in ('owner_assignment', 'import_assignment') then 0 else 1 end,
              o.created_at
     limit v_limit
  loop
    /*
     * The list was taken before anything was released, and releasing an
     * assignment settles that owner's held replies as covered by it. By the
     * time the loop reaches one it is no longer held — which is a letter
     * accounted for, not a letter refused, and counting it as a refusal would
     * report a problem that does not exist.
     */
    if not exists (select 1 from public.esh_notification_outbox
                    where id = held.id and state = 'held_rollout') then
      v_covered := v_covered + 1;
      continue;
    end if;

    one := public.esh_release_notification(held.id);
    if coalesce((one->>'ok')::boolean, false) then
      v_released := v_released + 1;
    else
      v_code := coalesce(one->>'code', 'unknown');
      v_skipped := v_skipped + 1;
      v_reasons := jsonb_set(v_reasons, array[v_code],
                             to_jsonb(coalesce((v_reasons->>v_code)::integer, 0) + 1));
    end if;
  end loop;

  select count(*) into v_remaining
    from public.esh_notification_outbox o
   where o.organization_id = org
     and o.state = 'held_rollout'
     and (p_import_batch_id is null or o.import_batch_id = p_import_batch_id);

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'notifications_released_bulk',
          jsonb_build_object('import_batch_id', p_import_batch_id,
                             'released', v_released, 'covered', v_covered,
                             'skipped', v_skipped, 'reasons', v_reasons,
                             'still_held', v_remaining));

  return jsonb_build_object('ok', true, 'released', v_released, 'covered', v_covered,
                            'skipped', v_skipped, 'reasons', v_reasons,
                            'still_held', v_remaining);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. How much is waiting, for the screen that offers to release it
-- ---------------------------------------------------------------------------

/*
 * The rollout as the administrator's screen needs to show it. Counts and the
 * mode only: looking after who may be written to is not a view of the
 * findings themselves (§43.1).
 */
create or replace function public.esh_rollout_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r public.esh_rollout_settings;
  v_changed_by text;
begin
  if not (focus.is_admin() or focus.esh_can('coordinate')) then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if (select count(*) from public.esh_rollout_settings) <> 1 then
    return jsonb_build_object('ok', false, 'code', 'rollout_not_configured');
  end if;
  select * into r from public.esh_rollout_settings;
  select full_name into v_changed_by from public.user_profiles where id = r.mode_changed_by;

  return jsonb_build_object(
    'ok', true,
    'mode', r.mode,
    'mode_changed_at', r.mode_changed_at,
    'mode_changed_by', v_changed_by,
    'mode_reason', r.mode_reason,
    'authorization_version', r.authorization_version,
    'contacts_total', (select count(*) from public.esh_email_principals
                        where organization_id = r.organization_id and status = 'active'),
    'contacts_enabled', (select count(*) from public.esh_email_principals
                          where organization_id = r.organization_id and status = 'active'
                            and access_enabled),
    'contacts_revoked', (select count(*) from public.esh_email_principals
                          where organization_id = r.organization_id and status = 'active'
                            and not access_enabled and access_disabled_by is not null),
    'held', (select count(*) from public.esh_notification_outbox
              where organization_id = r.organization_id and state = 'held_rollout'),
    /*
     * Not simply "held and reachable": what this caller could release if they
     * pressed the button, which is the number the button is labelled with. A
     * coordinator scoped to one department cannot release another's, and an
     * administrator who is not in ESH cannot release anything — so both are told
     * nothing is releasable rather than offered a count they cannot act on.
     */
    'held_releasable', (select count(*) from public.esh_notification_outbox o
                         left join public.esh_findings f on f.id = o.finding_id
                         where o.organization_id = r.organization_id
                           and o.state = 'held_rollout'
                           and focus.esh_contact_usable(o.recipient_principal_id)
                           and focus.esh_can('coordinate')
                           and (focus.esh_scope_all()
                                or (o.finding_id is null and o.import_batch_id is not null)
                                or f.accountable_department_id
                                     = any (focus.esh_visible_department_ids()))));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The same question, asked in one place (§43.3)
--
-- `esh_contact_usable` was never the only copy of "may this contact be written
-- to". Four places asked it themselves, as `status = 'active' and
-- access_enabled` — which was the whole rule right up until this migration
-- added a second way to be reachable, and is now a rule that agrees with the
-- real one only while the rollout is restricted.
--
-- Two of the four decide whether a letter is queued or held, so with the
-- rollout open they went on holding mail for contacts it could reach: not a
-- cosmetic disagreement but the entire feature not working, and the e2e spec
-- caught it on its first run. The other two describe a contact on screen, and
-- would have described them wrongly.
--
-- Each is re-emitted below exactly as it stands, with that one expression
-- replaced by the function. Nothing else about any of them changes. The
-- assignment now asks about `owner_principal` rather than a record it had
-- loaded: a record field read inside an untaken CASE branch is a trap of its
-- own, and the id is what the question is really about.
-- ---------------------------------------------------------------------------

/* The assignment letter (v197, last rewritten v205). */
CREATE OR REPLACE FUNCTION public.esh_save_finding(p_finding_id uuid, p_payload jsonb, p_assign boolean DEFAULT false, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  prior jsonb;
  existing public.esh_findings%rowtype;
  existing_action public.esh_finding_actions%rowtype;
  v_finding_id uuid;
  v_action_id uuid;
  v_reference text;
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_description text := nullif(btrim(coalesce(p_payload->>'description', '')), '');
  v_source text := coalesce(nullif(p_payload->>'source', ''), 'esh_inspection');
  v_source_reference text := nullif(btrim(coalesce(p_payload->>'source_reference', '')), '');
  v_location text := nullif(btrim(coalesce(p_payload->>'location', '')), '');
  v_department uuid;
  v_risk text := coalesce(nullif(p_payload->>'risk_level', ''), 'not_assessed');
  v_restricted boolean := coalesce((p_payload->>'is_restricted')::boolean, false);
  -- v205: where this came from, and when following it up starts.
  v_source_register text := nullif(btrim(coalesce(p_payload->>'source_register', '')), '');
  v_import_batch uuid := nullif(p_payload->>'import_batch_id', '')::uuid;
  v_import_row uuid := nullif(p_payload->>'import_row_id', '')::uuid;
  v_followup_from timestamptz := nullif(p_payload->>'followup_active_from', '')::timestamptz;
  v_action_title text := nullif(btrim(coalesce(p_payload->>'action_title', '')), '');
  v_outcome text := nullif(btrim(coalesce(p_payload->>'required_outcome', '')), '');
  v_instruction text := nullif(btrim(coalesce(p_payload->>'evidence_instruction', '')), '');
  v_priority text := nullif(p_payload->>'priority', '');
  v_owner_email text := nullif(btrim(coalesce(p_payload->>'owner_email', '')), '');
  v_reviewer uuid;
  v_no_escalation text := nullif(btrim(coalesce(p_payload->>'no_further_escalation_reason', '')), '');
  v_escalation jsonb := coalesce(p_payload->'escalation', '[]'::jsonb);
  v_reported_on date;
  v_due_date date;
  v_due_time time;
  v_due timestamptz;
  owner_principal uuid;
  owner_contact public.esh_email_principals%rowtype;
  problems text[] := '{}';
  warnings text[] := '{}';
  entry jsonb;
  seen text[] := '{}';
  entry_key text;
  levels int[] := '{}';
  level_no int;
  esc_principal uuid;
  reviewer_profile public.user_profiles%rowtype;
  outbox_state text;
  v_result jsonb;
begin
  if actor is null then
    return jsonb_build_object('ok', false, 'code', 'not_authenticated');
  end if;
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  if p_idempotency_key is not null then
    select l.result into prior from public.operation_log l
     where l.actor_id = actor and l.idempotency_key = p_idempotency_key;
    if found then
      return prior;
    end if;
  end if;

  -- Parse what arrived, recording what did not parse rather than raising.
  begin
    v_department := nullif(p_payload->>'accountable_department_id', '')::uuid;
  exception when others then
    problems := array_append(problems, 'department_invalid');
  end;
  begin
    v_reviewer := nullif(p_payload->>'reviewer_user_id', '')::uuid;
  exception when others then
    problems := array_append(problems, 'reviewer_invalid');
  end;
  begin
    v_reported_on := nullif(p_payload->>'reported_on', '')::date;
  exception when others then
    problems := array_append(problems, 'reported_on_invalid');
  end;
  begin
    v_due_date := nullif(p_payload->>'due_date', '')::date;
  exception when others then
    problems := array_append(problems, 'due_date_invalid');
  end;
  begin
    v_due_time := nullif(p_payload->>'due_time', '')::time;
  exception when others then
    problems := array_append(problems, 'due_time_invalid');
  end;

  if length(v_title) = 0 then
    problems := array_append(problems, 'title_required');
  end if;
  -- v205: 'import' is a source the import creates, and only the import: a
  -- finding typed in by hand cannot claim to have come out of a register.
  if v_source not in ('esh_inspection', 'audit', 'incident', 'observation', 'other')
     and not (v_source = 'import' and v_import_batch is not null) then
    problems := array_append(problems, 'source_invalid');
  end if;
  if v_risk not in ('not_assessed', 'low', 'medium', 'high', 'critical') then
    problems := array_append(problems, 'risk_invalid');
  end if;
  if v_priority is not null and v_priority not in ('urgent', 'high', 'normal') then
    problems := array_append(problems, 'priority_invalid');
  end if;
  if v_owner_email is not null and not focus.esh_email_is_valid(v_owner_email) then
    problems := array_append(problems, 'owner_email_invalid');
  end if;
  if jsonb_typeof(v_escalation) <> 'array' then
    problems := array_append(problems, 'escalation_invalid');
    v_escalation := '[]'::jsonb;
  end if;

  -- Scope: a coordinator files work only in departments they may read.
  if v_department is not null then
    if not exists (select 1 from public.departments d where d.id = v_department) then
      problems := array_append(problems, 'department_not_found');
    elsif not (v_department = any (focus.esh_visible_department_ids())) then
      problems := array_append(problems, 'department_out_of_scope');
    end if;
  end if;

  -- The escalation route: valid addresses, levels from 1 without gaps,
  -- duplicates at one level dropped.
  for entry in select value from jsonb_array_elements(v_escalation) loop
    begin
      level_no := (entry->>'level')::int;
    exception when others then
      level_no := null;
    end;
    if level_no is null or level_no < 1 or level_no > 9 then
      problems := array_append(problems, 'escalation_level_invalid');
      continue;
    end if;
    if not focus.esh_email_is_valid(entry->>'email') then
      problems := array_append(problems, 'escalation_email_invalid');
      continue;
    end if;
    entry_key := level_no::text || ':' || focus.esh_canonical_email(entry->>'email');
    if entry_key = any (seen) then
      continue;
    end if;
    seen := seen || entry_key;
    if not (level_no = any (levels)) then
      levels := levels || level_no;
    end if;
    if v_owner_email is not null
       and focus.esh_canonical_email(entry->>'email') = focus.esh_canonical_email(v_owner_email) then
      warnings := array_append(warnings, 'owner_is_escalation_recipient');
    end if;
  end loop;
  if cardinality(levels) > 0 and (select max(l) from unnest(levels) l) <> cardinality(levels) then
    problems := array_append(problems, 'escalation_levels_have_gaps');
  end if;

  if v_reviewer is not null then
    select p.* into reviewer_profile
      from public.user_profiles p
      join public.esh_staff_access a on a.user_id = p.id and a.organization_id = org
     where p.id = v_reviewer and p.status = 'active' and a.enabled and a.preset = 'verifier';
    if not found then
      problems := array_append(problems, 'reviewer_not_verifier');
    elsif v_owner_email is not null
          and focus.esh_canonical_email(reviewer_profile.email) = focus.esh_canonical_email(v_owner_email) then
      -- An owner never verifies their own correction (§5).
      problems := array_append(problems, 'reviewer_is_owner');
    end if;
  end if;

  if p_assign then
    if v_description is null then problems := array_append(problems, 'description_required'); end if;
    if v_department is null then problems := array_append(problems, 'department_required'); end if;
    if v_reported_on is null then problems := array_append(problems, 'reported_on_required'); end if;
    if v_outcome is null then problems := array_append(problems, 'required_outcome_required'); end if;
    if v_priority is null then problems := array_append(problems, 'priority_required'); end if;
    if v_owner_email is null then problems := array_append(problems, 'owner_email_required'); end if;
    if v_due_date is null then problems := array_append(problems, 'due_date_required'); end if;
    if cardinality(levels) = 0 and v_no_escalation is null then
      problems := array_append(problems, 'escalation_decision_required');
    end if;
    if v_due_date is not null and v_reported_on is not null and v_due_date < v_reported_on then
      problems := array_append(problems, 'due_before_reported');
    end if;
  end if;

  if cardinality(problems) > 0 then
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid',
      'problems', to_jsonb((select array_agg(distinct x) from unnest(problems) x)));
  end if;

  -- An existing draft: only a draft is edited here, and only by someone who
  -- can see it.
  if p_finding_id is not null then
    select * into existing from public.esh_findings
     where id = p_finding_id and organization_id = org
     for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    if existing.status <> 'draft' then
      return jsonb_build_object('ok', false, 'code', 'not_a_draft');
    end if;
    if not (existing.created_by = actor or focus.esh_scope_all()
            or existing.accountable_department_id = any (focus.esh_visible_department_ids())) then
      return jsonb_build_object('ok', false, 'code', 'finding_not_found');
    end if;
    select * into existing_action from public.esh_finding_actions
     where finding_id = existing.id and sequence = 1
     for update;
  end if;

  if v_due_date is not null then
    v_due := focus.esh_due_instant(org, v_due_date, v_due_time);
  end if;

  if existing.id is null then
    v_reference := focus.esh_next_reference(org);
    insert into public.esh_findings
      (organization_id, reference, title, description, source, source_reference, reported_on,
       location, accountable_department_id, risk_level, is_restricted, status, created_by,
       risk_assessed_by, risk_assessed_at, source_register, import_batch_id, import_row_id)
    values
      (org, v_reference, v_title, v_description, v_source, v_source_reference, v_reported_on,
       v_location, v_department, v_risk, v_restricted, 'draft', actor,
       case when v_risk <> 'not_assessed' then actor end,
       case when v_risk <> 'not_assessed' then now() end,
       v_source_register, v_import_batch, v_import_row)
    returning id into v_finding_id;

    insert into public.esh_finding_actions
      (organization_id, finding_id, sequence, title, required_outcome, evidence_instruction,
       priority, due_at, due_is_date_only, reviewer_user_id, no_further_escalation_reason,
       draft_owner_email, draft_escalation, created_by, followup_active_from)
    values
      (org, v_finding_id, 1, coalesce(v_action_title, v_title), v_outcome, v_instruction,
       v_priority, v_due, v_due_time is null, v_reviewer, v_no_escalation,
       v_owner_email, v_escalation, actor, v_followup_from)
    returning id into v_action_id;

    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
    values
      (org, 'staff', actor, 'finding_created', v_finding_id, v_action_id,
       jsonb_build_object('reference', v_reference, 'title', v_title));
  else
    v_finding_id := existing.id;
    v_reference := existing.reference;
    update public.esh_findings set
      title = v_title,
      description = v_description,
      source = v_source,
      source_reference = v_source_reference,
      reported_on = v_reported_on,
      location = v_location,
      accountable_department_id = v_department,
      risk_level = v_risk,
      risk_assessed_by = case when v_risk <> risk_level then
                           case when v_risk = 'not_assessed' then null else actor end
                         else risk_assessed_by end,
      risk_assessed_at = case when v_risk <> risk_level then
                           case when v_risk = 'not_assessed' then null else now() end
                         else risk_assessed_at end,
      is_restricted = v_restricted,
      updated_at = now(),
      row_version = row_version + 1
     where id = existing.id;

    update public.esh_finding_actions set
      title = coalesce(v_action_title, v_title),
      required_outcome = v_outcome,
      evidence_instruction = v_instruction,
      priority = v_priority,
      due_at = v_due,
      due_is_date_only = v_due_time is null,
      reviewer_user_id = v_reviewer,
      no_further_escalation_reason = v_no_escalation,
      draft_owner_email = v_owner_email,
      draft_escalation = v_escalation,
      updated_at = now(),
      row_version = row_version + 1
     where id = existing_action.id
    returning id into v_action_id;

    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
    values
      (org, 'staff', actor, 'finding_draft_saved', v_finding_id, v_action_id, '{}'::jsonb);
  end if;

  if not p_assign then
    v_result := jsonb_build_object(
      'ok', true, 'finding_id', v_finding_id, 'action_id', v_action_id,
      'reference', v_reference, 'status', 'draft',
      'warnings', to_jsonb((select coalesce(array_agg(distinct x), '{}') from unnest(warnings) x)));
    return focus.remember_operation(actor, p_idempotency_key, 'esh_save_finding', v_result);
  end if;

  -- Assign: the contact, the ownership interval, the route, the promise to
  -- notify — together, or not at all.
  owner_principal := focus.esh_principal_for(org, v_owner_email, actor);
  select * into owner_contact from public.esh_email_principals where id = owner_principal;

  update public.esh_findings set status = 'open', updated_at = now(), row_version = row_version + 1
   where id = v_finding_id;

  update public.esh_finding_actions set
    state = 'assigned',
    owner_principal_id = owner_principal,
    assignment_version = 1,
    baseline_due_at = v_due,
    due_at = v_due,
    assigned_at = now(),
    draft_owner_email = null,
    draft_escalation = '[]'::jsonb,
    updated_at = now(),
    row_version = row_version + 1
   where id = v_action_id;

  insert into public.esh_action_assignments
    (organization_id, action_id, principal_id, version, assigned_by)
  values (org, v_action_id, owner_principal, 1, actor);

  for entry in select value from jsonb_array_elements(v_escalation) loop
    esc_principal := focus.esh_principal_for(org, entry->>'email', actor);
    insert into public.esh_action_escalation_recipients
      (organization_id, action_id, level, principal_id, added_by)
    values (org, v_action_id, (entry->>'level')::smallint, esc_principal, actor)
    on conflict (action_id, level, principal_id) where removed_at is null do nothing;
  end loop;

  -- Held while this contact's access is off (§43.4): the rollout, not the
  -- owner, is why nothing was sent.
  outbox_state := case
                    when v_import_batch is not null then 'import_summary'
                    when focus.esh_contact_usable(owner_principal) then 'queued'
                    else 'held_rollout'
                  end;
  -- A backlog release writes one summary per owner instead (§41), so this
  -- assignment queues nothing of its own.
  if v_import_batch is null then
  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
     link_intents, idempotency_key, next_attempt_at)
  values
    (org, 'owner_assignment', owner_principal, v_finding_id, v_action_id, outbox_state,
     '["owner_action", "owner_inbox"]'::jsonb,
     'owner_assignment:' || v_action_id || ':1',
     case when outbox_state = 'queued' then now() end);
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id,
     subject_principal_id, detail)
  values
    (org, 'staff', actor, 'action_assigned', v_finding_id, v_action_id, owner_principal,
     jsonb_build_object(
       'owner_email', owner_contact.display_email,
       'due_at', v_due,
       'priority', v_priority,
       'escalation_levels', to_jsonb(levels),
       'no_further_escalation_reason', v_no_escalation,
       'notification', outbox_state));

  v_result := jsonb_build_object(
    'ok', true, 'finding_id', v_finding_id, 'action_id', v_action_id,
    'reference', v_reference, 'status', 'open', 'notification', outbox_state,
    'warnings', to_jsonb((select coalesce(array_agg(distinct x), '{}') from unnest(warnings) x)));
  return focus.remember_operation(actor, p_idempotency_key, 'esh_save_finding', v_result);
end;
$function$;

/* An owner whose address was corrected, and their escalation route (v203). */
CREATE OR REPLACE FUNCTION public.esh_admin_correct_contact_email(p_principal_id uuid, p_new_email text, p_transfer_actions boolean, p_transfer_escalations boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
         case when focus.esh_contact_usable(new_principal.id) then 'queued' else 'held_rollout' end,
         'email_corrected', '["owner_action", "owner_inbox"]'::jsonb,
         'email-corrected:' || action.id || ':v' || action.assignment_version,
         case when focus.esh_contact_usable(new_principal.id) then now() end);
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
           case when focus.esh_contact_usable(new_principal.id) then 'queued' else 'held_rollout' end,
           'email_corrected', '["escalation_action"]'::jsonb,
           'email-corrected-escalation:' || action.id || ':v' || action.assignment_version
             || ':l' || route.level,
           case when focus.esh_contact_usable(new_principal.id) then now() end, route.level);
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
$function$;

/* What the weekly letter preview says about each recipient (v204). */
CREATE OR REPLACE FUNCTION public.esh_preview_report(p_definition_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  definition public.esh_report_definitions;
  org uuid := focus.esh_organization_id();
  v_departments uuid[];
  v_week_start timestamptz;
begin
  if auth.uid() is null or not focus.esh_can('manage_reports') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into definition from public.esh_report_definitions
   where id = p_definition_id and organization_id = org;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;

  v_departments := focus.esh_report_scope_departments(definition.id);
  v_week_start := (date_trunc('week', now() at time zone definition.timezone))
                    at time zone definition.timezone;

  return jsonb_build_object(
    'ok', true,
    'name', definition.name,
    'state', definition.state,
    'timezone', definition.timezone,
    'as_of', now(),
    'closed_from', v_week_start - interval '7 days',
    'closed_to', v_week_start,
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'email', principal.display_email,
               'enabled', recipient.enabled,
               'access_enabled', focus.esh_contact_usable(principal.id)) order by principal.display_email)
        from public.esh_report_recipients recipient
        join public.esh_email_principals principal on principal.id = recipient.principal_id
       where recipient.report_definition_id = definition.id), '[]'::jsonb),
    'departments', coalesce((
      select jsonb_agg(department.name order by department.name)
        from public.departments department
       where department.id = any(v_departments)), '[]'::jsonb),
    'open_count', (select count(*) from public.esh_findings f
                    where f.organization_id = org and f.status = 'open'
                      and not f.is_restricted
                      and f.accountable_department_id = any(v_departments)),
    'overdue_count', (select count(*) from public.esh_finding_actions action
                       join public.esh_findings f on f.id = action.finding_id
                      where f.organization_id = org and f.status = 'open'
                        and not f.is_restricted
                        and f.accountable_department_id = any(v_departments)
                        and action.state in ('assigned', 'in_progress')
                        and action.due_at < now()),
    'awaiting_count', (select count(*) from public.esh_finding_actions action
                        join public.esh_findings f on f.id = action.finding_id
                       where f.organization_id = org and f.status = 'open'
                         and not f.is_restricted
                         and f.accountable_department_id = any(v_departments)
                         and action.state = 'awaiting_verification'),
    'closed_count', (select count(*) from public.esh_findings f
                      where f.organization_id = org and f.status = 'closed'
                        and not f.is_restricted
                        and f.accountable_department_id = any(v_departments)
                        and f.closed_at >= v_week_start - interval '7 days'
                        and f.closed_at < v_week_start),
    -- Said out loud on the screen: this is a look, not a send (§34.1).
    'sends_nothing', true);
end;
$function$;

/*
 * The register loses a column that was quietly wrong (§24, §43.3).
 *
 * `owner_access_enabled` read the flag directly, so with the rollout open it
 * would have said no about an owner the module was writing to that morning. It
 * has no reader — not in SQL, not in the application — which leaves two ways to
 * make it honest: have it call `esh_contact_usable`, which would mean granting
 * every signed-in caller execute on a SECURITY DEFINER predicate and paying for
 * it once per register row; or take out a column nobody asked for. The second
 * costs nothing and removes a copy of the rule instead of correcting it.
 *
 * The application reads this view directly, and with `select *`, so the column
 * has to go rather than be replaced — which `create or replace view` cannot do.
 * Nothing depends on the view, and its grants are re-made below exactly as
 * v198, v199 and v201 made them.
 */
drop view public.esh_register_rows;
-- `security_invoker` is the whole of this view's protection: without it the view
-- runs as its owner, every RLS policy on the findings underneath is bypassed,
-- and anybody signed in reads the entire register. `create or replace view`
-- keeps the option; a drop and create does not, and leaving it off cost a leak
-- that v197's own test caught within the hour.
create view public.esh_register_rows
with (security_invoker = true)
as
SELECT f.id AS finding_id,
    f.organization_id,
    f.reference,
    f.title,
    f.location,
    f.status,
    f.is_restricted,
    f.risk_level,
    f.accountable_department_id,
    d.name AS department_name,
    f.created_at,
    f.closed_at,
    a.id AS action_id,
    a.state AS action_state,
    a.priority,
    a.due_at,
    a.due_is_date_only,
    ( SELECT count(*) AS count
           FROM esh_finding_actions x
          WHERE x.finding_id = f.id) AS action_count,
    p.display_email AS owner_email,
    COALESCE(held.any_held, false) AS notification_held,
    COALESCE((a.state = ANY (ARRAY['assigned'::text, 'in_progress'::text])) AND a.due_at < now(), false) AS is_overdue,
    (f.status = ANY (ARRAY['draft'::text, 'new'::text])) OR f.status = 'open'::text AND (COALESCE((a.state = ANY (ARRAY['assigned'::text, 'in_progress'::text])) AND a.due_at < now(), false) OR COALESCE(a.state = 'awaiting_verification'::text, false) OR COALESCE(held.any_held, false) OR COALESCE(failed.any_failed, false)) AS needs_attention,
    COALESCE(latest.occurred_at, f.created_at) AS last_update_at,
    COALESCE(latest.event_type, 'finding_created'::text) AS last_update_type,
    COALESCE(failed.any_failed, false) AS notification_failed,
    escalated.level AS escalation_level
   FROM esh_findings f
     LEFT JOIN departments d ON d.id = f.accountable_department_id
     LEFT JOIN LATERAL ( SELECT x.id,
            x.organization_id,
            x.finding_id,
            x.sequence,
            x.title,
            x.required_outcome,
            x.evidence_instruction,
            x.evidence_rule,
            x.evidence_exception_reason,
            x.priority,
            x.state,
            x.owner_principal_id,
            x.assignment_version,
            x.baseline_due_at,
            x.due_at,
            x.due_is_date_only,
            x.reviewer_user_id,
            x.no_further_escalation_reason,
            x.draft_owner_email,
            x.draft_escalation,
            x.created_by,
            x.created_at,
            x.updated_at,
            x.assigned_at,
            x.accepted_at,
            x.row_version,
            x.current_submission_id,
            x.followup_active_from
           FROM esh_finding_actions x
          WHERE x.finding_id = f.id
          ORDER BY x.sequence
         LIMIT 1) a ON true
     LEFT JOIN esh_email_principals p ON p.id = a.owner_principal_id
     LEFT JOIN LATERAL ( SELECT true AS any_held
           FROM esh_notification_outbox o
          WHERE o.action_id = a.id AND o.state = 'held_rollout'::text
         LIMIT 1) held ON true
     LEFT JOIN LATERAL ( SELECT max(e.level) AS level
           FROM esh_escalation_entitlements e
          WHERE e.action_id = a.id AND e.revoked_at IS NULL AND e.assignment_version = a.assignment_version) escalated ON true
     LEFT JOIN LATERAL ( SELECT true AS any_failed
           FROM esh_notification_outbox o
          WHERE o.action_id = a.id AND (o.state = 'bounced'::text OR o.state = 'failed'::text AND o.next_attempt_at IS NULL)
         LIMIT 1) failed ON true
     LEFT JOIN LATERAL ( SELECT e.occurred_at,
            e.event_type
           FROM esh_audit_events e
          WHERE e.finding_id = f.id AND (e.event_type = ANY (ARRAY['finding_created'::text, 'action_assigned'::text, 'action_started'::text, 'owner_message'::text, 'esh_message'::text, 'escalation_message'::text, 'submission_created'::text, 'submission_withdrawn'::text]))
          ORDER BY e.occurred_at DESC, (array_position(ARRAY['submission_created'::text, 'submission_withdrawn'::text, 'owner_message'::text, 'esh_message'::text, 'escalation_message'::text, 'action_started'::text, 'action_assigned'::text, 'finding_created'::text], e.event_type))
         LIMIT 1) latest ON true;;

revoke all on public.esh_register_rows from anon, authenticated;
grant select on public.esh_register_rows to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Function privileges
-- ---------------------------------------------------------------------------

revoke all on function public.esh_set_rollout_mode(text, text) from public, anon;
revoke all on function public.esh_release_held_notifications(uuid, integer) from public, anon;
revoke all on function public.esh_rollout_status() from public, anon;

grant execute on function public.esh_set_rollout_mode(text, text) to authenticated;
grant execute on function public.esh_release_held_notifications(uuid, integer) to authenticated;
grant execute on function public.esh_rollout_status() to authenticated;

comment on function public.esh_set_rollout_mode is
  'Administrator-only rollout mode (§43.2). Restricted names contacts one at a time; live reaches every active contact except one deliberately switched off. Sends nothing.';
comment on function public.esh_release_held_notifications is
  'Release held notifications in bulk (§43.4) by calling esh_release_notification for each, so every rule is unchanged.';
comment on function public.esh_rollout_status is
  'Rollout mode and access counts for the administration screen. No finding data (§43.1).';

-- ---------------------------------------------------------------------------
-- 6. Releasing a backlog's own letters (§41, §43.4)
-- ---------------------------------------------------------------------------

/* Unchanged from v198 but for the scope of a batch's summary, below. */
CREATE OR REPLACE FUNCTION public.esh_release_notification(p_outbox_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  org uuid := focus.esh_organization_id();
  o public.esh_notification_outbox;
  f public.esh_findings;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into o from public.esh_notification_outbox
   where id = p_outbox_id and organization_id = org
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'notification_not_found');
  end if;
  /*
   * v224 — a released backlog's summary belongs to a batch, not to one finding.
   *
   * `esh_import_release` writes one `import_assignment` per owner, covering
   * however many of that batch's findings they were given, so the row has no
   * `finding_id` at all. Asking this rule for its finding's department therefore
   * refused every one of them: the letters the import had queued could not be
   * released by the only procedure that releases letters. A batch is the
   * organisation's own import and the caller already holds Coordinator, so the
   * organisation is the scope that applies to it.
   */
  if o.finding_id is null then
    if o.import_batch_id is null
       or not exists (select 1 from public.esh_import_batches b
                       where b.id = o.import_batch_id and b.organization_id = org) then
      return jsonb_build_object('ok', false, 'code', 'notification_not_found');
    end if;
  else
    select * into f from public.esh_findings where id = o.finding_id;
    if f.id is null or not (focus.esh_scope_all()
                            or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
      return jsonb_build_object('ok', false, 'code', 'notification_not_found');
    end if;
  end if;
  if o.state <> 'held_rollout' then
    return jsonb_build_object('ok', false, 'code', 'not_held');
  end if;
  if not focus.esh_contact_usable(o.recipient_principal_id) then
    return jsonb_build_object('ok', false, 'code', 'contact_access_off');
  end if;
  if o.action_id is not null and not focus.esh_owner_holds(o.action_id, o.recipient_principal_id, null) then
    return jsonb_build_object('ok', false, 'code', 'no_longer_the_owner');
  end if;
  if o.event_type = 'esh_reply' and exists (
       select 1 from public.esh_notification_outbox held
        where held.action_id = o.action_id
          and held.recipient_principal_id = o.recipient_principal_id
          and held.event_type = 'owner_assignment'
          and held.state = 'held_rollout') then
    return jsonb_build_object('ok', false, 'code', 'assignment_first');
  end if;

  update public.esh_notification_outbox set
    state = 'queued',
    state_reason = null,
    next_attempt_at = now(),
    released_by = actor,
    released_at = now(),
    updated_at = now()
   where id = o.id;

  if o.event_type = 'owner_assignment' then
    update public.esh_notification_outbox set
      state = 'suppressed',
      state_reason = 'covered_by_assignment_email',
      updated_at = now()
     where action_id = o.action_id
       and recipient_principal_id = o.recipient_principal_id
       and event_type = 'esh_reply'
       and state = 'held_rollout';
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id,
     subject_principal_id, detail)
  values
    (o.organization_id, 'staff', actor, 'notification_released', o.finding_id, o.action_id,
     o.recipient_principal_id, jsonb_build_object('event_type', o.event_type, 'outbox_id', o.id));

  return jsonb_build_object('ok', true);
end;
$function$;
