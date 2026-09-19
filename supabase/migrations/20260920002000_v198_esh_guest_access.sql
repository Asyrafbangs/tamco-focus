-- ============================================================================
-- v198 ESH Finding Management: email-link access for Action Owners.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §8-§12,
-- §17-§20, §22, §31.3, §43. An Action Owner has no account: possession of a
-- link delivered to their mailbox is the credential, exchanged once for a
-- short guest session. This migration adds:
--
--   * contact access that an administrator switches on and off (§43.2);
--   * single-use access grants, minted at dispatch, stored only as hashes;
--   * guest sessions with explicit scope — one action, or the owner's inbox;
--   * the action conversation between the owner and ESH (§11);
--   * the dispatch procedures the email worker drives, which re-check the
--     rollout, the contact and the live assignment before anything is sent.
--
-- Guests never reach a table. Their only way in is the `esh_guest_*`
-- procedures, executable by the server's service role alone, and each one
-- re-derives the session, the contact's access and the live assignment from
-- the database on every call (§20). A guest session and a staff login share
-- nothing: no procedure here reads `auth.uid()` for a guest.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Contacts: who switched access on or off, and why (§43.2)
-- ---------------------------------------------------------------------------

alter table public.esh_email_principals
  add column access_disabled_by uuid references public.user_profiles (id),
  add column access_disabled_at timestamptz,
  add column access_reason text,
  add column authorization_version integer not null default 1;

-- ---------------------------------------------------------------------------
-- 2. The outbox learns two more messages, and why a row stopped
-- ---------------------------------------------------------------------------

alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_event_type_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_event_type_check
  check (event_type in ('owner_assignment', 'esh_reply', 'access_link'));

alter table public.esh_notification_outbox
  add column state_reason text,
  add column released_by uuid references public.user_profiles (id),
  add column released_at timestamptz;

create index esh_outbox_recipient_idx
  on public.esh_notification_outbox (recipient_principal_id, event_type, created_at);
create index esh_outbox_action_idx on public.esh_notification_outbox (action_id);

-- ---------------------------------------------------------------------------
-- 3. Access grants (§9, §18, §22)
--
-- One row per link sent. The link carries a 256-bit random secret; this table
-- keeps its SHA-256 only, so a copy of the database opens nothing. A grant is
-- spent once. `receipt_hash` lets the same browser tab that spent it ask
-- again for two minutes if the answer was lost on the way (§19), and no
-- other browser can.
-- ---------------------------------------------------------------------------

create table public.esh_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  principal_id uuid not null,
  purpose text not null check (purpose in ('owner_action', 'owner_inbox')),
  action_id uuid,
  assignment_version integer,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  issued_reason text not null check (issued_reason in ('notification', 'recovery')),
  outbox_id uuid references public.esh_notification_outbox (id),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_session_id uuid,
  receipt_hash text,
  receipt_expires_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  foreign key (organization_id, principal_id)
    references public.esh_email_principals (organization_id, id),
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  -- An action link names its action and the assignment it was sent for; an
  -- inbox link names neither (§9: separate scopes, not one token twice).
  check ((purpose = 'owner_action') = (action_id is not null and assignment_version is not null)),
  check (expires_at > issued_at)
);

create index esh_grants_principal_idx on public.esh_access_grants (principal_id, issued_at);
create index esh_grants_outbox_idx on public.esh_access_grants (outbox_id);

-- ---------------------------------------------------------------------------
-- 4. Guest sessions (§18)
--
-- Twelve hours at most, two hours idle. `inbox_scope` is the owner's own
-- inbox; the action rows are the single actions a link opened, each bound to
-- the assignment it was sent for, so a reassignment ends it (§14).
-- ---------------------------------------------------------------------------

create table public.esh_guest_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  principal_id uuid not null,
  session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  inbox_scope boolean not null default false,
  identity_version integer not null,
  grant_id uuid references public.esh_access_grants (id),
  issued_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text,
  foreign key (organization_id, principal_id)
    references public.esh_email_principals (organization_id, id)
);

create index esh_guest_sessions_principal_idx on public.esh_guest_sessions (principal_id);

create table public.esh_guest_session_actions (
  session_id uuid not null references public.esh_guest_sessions (id) on delete cascade,
  action_id uuid not null references public.esh_finding_actions (id),
  assignment_version integer not null,
  primary key (session_id, action_id)
);

alter table public.esh_access_grants
  add constraint esh_grants_consumed_session_fk
  foreign key (consumed_session_id) references public.esh_guest_sessions (id);

-- ---------------------------------------------------------------------------
-- 5. The action conversation (§11, §21)
--
-- Author details are snapshots: a later owner does not inherit what an
-- earlier one said (§14), and a renamed colleague's words keep the name they
-- were sent under.
-- ---------------------------------------------------------------------------

create table public.esh_action_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  author_kind text not null check (author_kind in ('owner', 'staff')),
  author_principal_id uuid,
  author_user_id uuid references public.user_profiles (id),
  author_email text not null,
  author_name text,
  body text not null check (length(btrim(body)) between 1 and 4000),
  client_key text not null check (length(client_key) between 8 and 80),
  sent_at timestamptz not null default now(),
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  foreign key (organization_id, author_principal_id)
    references public.esh_email_principals (organization_id, id),
  check ((author_kind = 'owner') = (author_principal_id is not null and author_user_id is null)),
  unique (action_id, client_key)
);

create index esh_messages_action_idx on public.esh_action_messages (action_id, sent_at);

alter table public.esh_access_grants enable row level security;
alter table public.esh_guest_sessions enable row level security;
alter table public.esh_guest_session_actions enable row level security;
alter table public.esh_action_messages enable row level security;

-- Staff read the conversation of any action they can read. Grants and
-- sessions have no policy at all: no signed-in person reads them.
create policy esh_action_messages_select on public.esh_action_messages
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));

revoke all on public.esh_access_grants, public.esh_guest_sessions,
  public.esh_guest_session_actions, public.esh_action_messages
  from anon, authenticated;
grant select on public.esh_action_messages to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The register, with the conversation and delivery problems in it
--
-- Same definition as v197 plus: a message is a meaningful update (§24), a
-- delivery that has stopped retrying needs attention (§17), and an open
-- action whose owner's access is off is flagged rather than looking like the
-- owner ignoring it (§43.4). New columns go at the end.
-- ---------------------------------------------------------------------------

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
       (f.status in ('draft', 'new')
        or (f.status = 'open'
            and (coalesce(a.state in ('assigned', 'in_progress') and a.due_at < now(), false)
                 or coalesce(held.any_held, false)
                 or coalesce(failed.any_failed, false)))) as needs_attention,
       coalesce(latest.occurred_at, f.created_at) as last_update_at,
       coalesce(latest.event_type, 'finding_created') as last_update_type,
       coalesce(failed.any_failed, false) as notification_failed,
       coalesce(p.status = 'active' and p.access_enabled, false) as owner_access_enabled
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
    select true as any_failed
      from public.esh_notification_outbox o
     where o.action_id = a.id and o.state = 'failed' and o.next_attempt_at is null
     limit 1
  ) failed on true
  left join lateral (
    select e.occurred_at, e.event_type
      from public.esh_audit_events e
     where e.finding_id = f.id
       and e.event_type in ('finding_created', 'action_assigned', 'action_started',
                            'owner_message', 'esh_message')
     -- Events in one transaction share a timestamp; the later step wins.
     order by e.occurred_at desc,
              array_position(array['owner_message', 'esh_message', 'action_started',
                                   'action_assigned', 'finding_created'], e.event_type)
     limit 1
  ) latest on true;

revoke all on public.esh_register_rows from anon, authenticated;
grant select on public.esh_register_rows to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Helpers
-- ---------------------------------------------------------------------------

-- The one hashing rule for link and session secrets.
create or replace function focus.esh_secret_hash(p_secret text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
$$;

/*
 * Whether a contact may use email-link access at all right now: the rollout
 * is configured for their organisation, the contact is active, and an
 * administrator has switched their access on (§43.3). Every guest call and
 * every dispatch asks this afresh.
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
       and p.access_enabled
  );
$$;

/*
 * Whether this contact owns this action now, and it is still open work. A
 * version, when given, must match too: a link sent for one assignment does
 * not survive a reassignment, even back to the same address (§14).
 */
create or replace function focus.esh_owner_holds(
  p_action_id uuid,
  p_principal_id uuid,
  p_version integer
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.esh_finding_actions a
      join public.esh_findings f on f.id = a.finding_id
     where a.id = p_action_id
       and a.owner_principal_id = p_principal_id
       and (p_version is null or a.assignment_version = p_version)
       and a.state in ('assigned', 'in_progress', 'awaiting_verification')
       and f.status = 'open'
  );
$$;

/*
 * The live session behind a secret, or null. Expired, idle, revoked, a
 * contact switched off or an identity since changed all read as no session.
 */
create or replace function focus.esh_guest_resolve(p_session text, p_touch boolean)
returns public.esh_guest_sessions
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  v_identity integer;
begin
  if p_session is null or length(p_session) < 40 then
    return null;
  end if;
  select * into s from public.esh_guest_sessions
   where session_hash = focus.esh_secret_hash(p_session);
  if not found or s.revoked_at is not null
     or s.absolute_expires_at <= now()
     or s.last_used_at <= now() - interval '2 hours'
     or not focus.esh_contact_usable(s.principal_id) then
    return null;
  end if;
  select identity_version into v_identity from public.esh_email_principals where id = s.principal_id;
  if v_identity is distinct from s.identity_version then
    return null;
  end if;
  if p_touch and s.last_used_at < now() - interval '1 minute' then
    update public.esh_guest_sessions set last_used_at = now() where id = s.id;
    s.last_used_at := now();
  end if;
  return s;
end;
$$;

/*
 * Whether a session reaches an action: the contact owns it now, and the
 * session is the owner's inbox or was opened by a link for this assignment.
 */
create or replace function focus.esh_guest_covers(
  p_session_id uuid,
  p_principal_id uuid,
  p_inbox boolean,
  p_action_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.esh_owner_holds(p_action_id, p_principal_id, null)
     and (p_inbox or exists (
       select 1
         from public.esh_guest_session_actions s
         join public.esh_finding_actions a on a.id = s.action_id
        where s.session_id = p_session_id
          and s.action_id = p_action_id
          and s.assignment_version = a.assignment_version));
$$;

-- ---------------------------------------------------------------------------
-- 8. Dispatch (§17, §22): driven by the email worker, service role only
-- ---------------------------------------------------------------------------

/*
 * Claim one outbox row for sending and mint its links.
 *
 * Re-checks everything at send time, because the world may have moved since
 * the row was written: a contact switched off goes back to held (and a
 * requested link is simply not sent); an action reassigned, accepted or
 * closed is no longer the recipient's to be told about. The worker passes
 * one fresh secret per link; only their hashes are kept, and they expire from
 * now, the moment of sending — 24 hours for a notification, 30 minutes for a
 * requested link (§18).
 */
create or replace function public.esh_dispatch_claim(p_outbox_id uuid, p_secrets jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o public.esh_notification_outbox;
  v_principal public.esh_email_principals;
  v_action public.esh_finding_actions;
  v_finding public.esh_findings;
  v_creator public.user_profiles;
  v_timezone text;
  v_ttl interval;
  v_intent text;
  v_secret text;
  v_version integer;
begin
  select * into o from public.esh_notification_outbox
   where id = p_outbox_id
   for update skip locked;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;
  if not (o.state = 'queued'
          or (o.state = 'failed' and o.next_attempt_at is not null and o.next_attempt_at <= now())
          or (o.state = 'processing' and o.updated_at < now() - interval '15 minutes')) then
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;

  if not focus.esh_contact_usable(o.recipient_principal_id) then
    update public.esh_notification_outbox set
      state = case when o.event_type = 'access_link' then 'suppressed' else 'held_rollout' end,
      state_reason = 'access_not_enabled',
      next_attempt_at = null,
      updated_at = now()
     where id = o.id;
    return jsonb_build_object('ok', false, 'code', 'held');
  end if;

  -- A reply notice waits for the assignment email it follows.
  if o.event_type = 'esh_reply' and exists (
       select 1 from public.esh_notification_outbox held
        where held.action_id = o.action_id
          and held.recipient_principal_id = o.recipient_principal_id
          and held.event_type = 'owner_assignment'
          and held.state = 'held_rollout') then
    update public.esh_notification_outbox set
      state = 'held_rollout',
      state_reason = 'assignment_not_released',
      next_attempt_at = null,
      updated_at = now()
     where id = o.id;
    return jsonb_build_object('ok', false, 'code', 'held');
  end if;

  if o.action_id is not null then
    select * into v_action from public.esh_finding_actions where id = o.action_id;
    select * into v_finding from public.esh_findings where id = v_action.finding_id;
    if not focus.esh_owner_holds(o.action_id, o.recipient_principal_id, null) then
      update public.esh_notification_outbox set
        state = 'suppressed',
        state_reason = 'no_longer_the_owner',
        next_attempt_at = null,
        updated_at = now()
       where id = o.id;
      return jsonb_build_object('ok', false, 'code', 'suppressed');
    end if;
    select * into v_creator from public.user_profiles where id = v_finding.created_by;
  end if;

  select * into v_principal from public.esh_email_principals where id = o.recipient_principal_id;
  select timezone into v_timezone from public.organizations where id = o.organization_id;
  v_version := v_action.assignment_version;

  update public.esh_notification_outbox set
    state = 'processing',
    attempts = attempts + 1,
    updated_at = now()
   where id = o.id;

  v_ttl := case when o.event_type = 'access_link' then interval '30 minutes'
                else interval '24 hours' end;

  for v_intent in select jsonb_array_elements_text(o.link_intents) loop
    v_secret := p_secrets ->> v_intent;
    if v_secret is null or length(v_secret) < 40 then
      raise exception 'esh_dispatch_claim: no secret for %', v_intent;
    end if;
    insert into public.esh_access_grants
      (organization_id, principal_id, purpose, action_id, assignment_version, token_hash,
       issued_reason, outbox_id, expires_at)
    values
      (o.organization_id, o.recipient_principal_id, v_intent,
       case when v_intent = 'owner_action' then o.action_id end,
       case when v_intent = 'owner_action' then v_version end,
       focus.esh_secret_hash(v_secret),
       case when o.event_type = 'access_link' then 'recovery' else 'notification' end,
       o.id, now() + v_ttl);
  end loop;

  return jsonb_build_object(
    'ok', true,
    'event_type', o.event_type,
    'to', v_principal.display_email,
    'intents', o.link_intents,
    'action_id', o.action_id,
    'reference', v_finding.reference,
    'finding_title', v_finding.title,
    'action_title', v_action.title,
    'location', v_finding.location,
    'required_outcome', v_action.required_outcome,
    'due_at', v_action.due_at,
    'due_is_date_only', v_action.due_is_date_only,
    'priority', v_action.priority,
    'timezone', coalesce(v_timezone, 'Asia/Kuala_Lumpur'),
    'esh_contact_name', v_creator.full_name,
    'esh_contact_email', v_creator.email,
    'expires_minutes', (extract(epoch from v_ttl) / 60)::int);
end;
$$;

/*
 * Record what the mail server said. Acceptance by the provider is all SMTP
 * can tell us, and it is recorded as exactly that (§17). A failed attempt
 * revokes the links it minted, so retries never leave a trail of live links
 * (§22); it retries with backoff, and after eight attempts or a permanent
 * refusal it stops and the register flags it for ESH.
 */
create or replace function public.esh_dispatch_complete(
  p_outbox_id uuid,
  p_ok boolean,
  p_error text default null,
  p_permanent boolean default false,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o public.esh_notification_outbox;
begin
  select * into o from public.esh_notification_outbox where id = p_outbox_id for update;
  if not found or o.state <> 'processing' then
    return jsonb_build_object('ok', false, 'code', 'not_processing');
  end if;

  if p_ok then
    update public.esh_notification_outbox set
      state = 'provider_accepted',
      state_reason = null,
      sent_at = now(),
      last_error = null,
      provider_message_id = left(p_provider_message_id, 200),
      next_attempt_at = null,
      updated_at = now()
     where id = o.id;
    insert into public.esh_audit_events
      (organization_id, actor_kind, event_type, finding_id, action_id, subject_principal_id, detail)
    values
      (o.organization_id, 'system', 'notification_sent', o.finding_id, o.action_id,
       o.recipient_principal_id, jsonb_build_object('event_type', o.event_type, 'outbox_id', o.id));
    return jsonb_build_object('ok', true, 'state', 'provider_accepted');
  end if;

  update public.esh_access_grants set
    revoked_at = now(),
    revoked_reason = 'send_failed'
   where outbox_id = o.id and consumed_at is null and revoked_at is null;

  update public.esh_notification_outbox set
    state = 'failed',
    last_error = left(coalesce(p_error, 'unknown error'), 500),
    next_attempt_at = case
                        when p_permanent or o.attempts >= 8 then null
                        else now() + make_interval(mins => least(1440, power(2, o.attempts)::int))
                      end,
    updated_at = now()
   where id = o.id;
  return jsonb_build_object('ok', true, 'state', 'failed');
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The guest boundary (§18-§20): service role only
-- ---------------------------------------------------------------------------

/*
 * Exchange a link for a session (§19).
 *
 * Never on a GET: the page a link opens only shows a button, and this runs
 * when it is pressed. With `p_consume` false it spends nothing and succeeds
 * only if this browser's session already reaches the destination — the
 * returning recipient who needs no tap.
 *
 * Spending is atomic (the grant row is locked). A new session is minted every
 * time, never the browser's old cookie reused (fixation); a session of the
 * same contact is folded into it and ended, and one belonging to another
 * contact is ended outright, so two people never share a browser's identity.
 */
create or replace function public.esh_guest_exchange(
  p_token text,
  p_new_session text,
  p_existing_session text,
  p_challenge text,
  p_consume boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  g public.esh_access_grants;
  v_existing public.esh_guest_sessions;
  v_eligible boolean;
  v_destination text;
  v_covered boolean;
  v_session_id uuid;
  v_inbox boolean;
  v_identity integer;
  v_expires timestamptz;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{40,64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select * into g from public.esh_access_grants
   where token_hash = focus.esh_secret_hash(p_token)
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  v_eligible := focus.esh_contact_usable(g.principal_id)
    and (g.purpose = 'owner_inbox'
         or focus.esh_owner_holds(g.action_id, g.principal_id, g.assignment_version));
  v_destination := case when g.purpose = 'owner_inbox' then '/respond/my-actions'
                        else '/respond/actions/' || g.action_id end;

  if p_existing_session is not null then
    v_existing := focus.esh_guest_resolve(p_existing_session, false);
  end if;

  -- This browser can already go there: spend nothing (§19).
  v_covered := v_eligible
    and v_existing.id is not null
    and v_existing.principal_id = g.principal_id
    and (v_existing.inbox_scope
         or (g.purpose = 'owner_action'
             and focus.esh_guest_covers(v_existing.id, v_existing.principal_id, false, g.action_id)));
  if v_covered then
    return jsonb_build_object('ok', true, 'destination', v_destination, 'new_session', false);
  end if;
  if not p_consume then
    return jsonb_build_object('ok', false, 'code', 'needs_tap');
  end if;

  if g.revoked_at is not null then
    return jsonb_build_object('ok', false, 'code', 'revoked');
  end if;
  if g.consumed_at is not null then
    -- The same tab asking again because the first answer never arrived.
    if not (p_challenge is not null and v_eligible
            and g.receipt_hash = focus.esh_secret_hash(p_challenge)
            and g.receipt_expires_at > now()) then
      return jsonb_build_object('ok', false, 'code', 'used');
    end if;
    update public.esh_guest_sessions set revoked_at = now(), revoked_reason = 'reissued'
     where id = g.consumed_session_id and revoked_at is null;
  elsif g.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'expired');
  elsif not v_eligible then
    return jsonb_build_object('ok', false, 'code', 'unavailable');
  end if;

  if p_new_session is null or length(p_new_session) < 40 then
    raise exception 'esh_guest_exchange: no session secret';
  end if;

  select identity_version into v_identity from public.esh_email_principals where id = g.principal_id;
  v_inbox := g.purpose = 'owner_inbox'
             or coalesce(v_existing.principal_id = g.principal_id and v_existing.inbox_scope, false);
  v_expires := now() + interval '12 hours';

  insert into public.esh_guest_sessions
    (organization_id, principal_id, session_hash, inbox_scope, identity_version, grant_id,
     absolute_expires_at)
  values
    (g.organization_id, g.principal_id, focus.esh_secret_hash(p_new_session), v_inbox, v_identity,
     g.id, v_expires)
  returning id into v_session_id;

  if v_existing.id is not null and v_existing.principal_id = g.principal_id then
    insert into public.esh_guest_session_actions (session_id, action_id, assignment_version)
    select v_session_id, s.action_id, s.assignment_version
      from public.esh_guest_session_actions s
     where s.session_id = v_existing.id;
  end if;
  if g.purpose = 'owner_action' then
    insert into public.esh_guest_session_actions (session_id, action_id, assignment_version)
    values (v_session_id, g.action_id, g.assignment_version)
    on conflict (session_id, action_id) do update set assignment_version = excluded.assignment_version;
  end if;

  if v_existing.id is not null then
    update public.esh_guest_sessions set
      revoked_at = now(),
      revoked_reason = case when principal_id = g.principal_id then 'rotated' else 'another_contact' end
     where id = v_existing.id and revoked_at is null;
  end if;

  update public.esh_access_grants set
    consumed_at = coalesce(consumed_at, now()),
    consumed_session_id = v_session_id,
    receipt_hash = case when p_challenge is not null then focus.esh_secret_hash(p_challenge) end,
    receipt_expires_at = case when g.consumed_at is null then now() + interval '2 minutes'
                              else receipt_expires_at end
   where id = g.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_principal_id, event_type, action_id, subject_principal_id,
     finding_id, detail)
  values
    (g.organization_id, 'principal', g.principal_id, 'guest_link_redeemed', g.action_id,
     g.principal_id,
     (select a.finding_id from public.esh_finding_actions a where a.id = g.action_id),
     jsonb_build_object('purpose', g.purpose, 'grant_id', g.id));

  return jsonb_build_object(
    'ok', true, 'destination', v_destination, 'new_session', true,
    'session_expires_at', v_expires);
end;
$$;

/*
 * My Actions (§10): every open action this contact owns, in this
 * organisation, live — a new assignment appears and a reassigned one leaves
 * without the session changing (FM12, FM13). Needs my action sorts Urgent,
 * High, Normal, then the earliest due date, then the action; overdue is shown
 * but does not outrank priority. No date cutoff: an old open action is still
 * open (FM06).
 */
create or replace function public.esh_guest_my_actions(
  p_session text,
  p_filter text,
  p_search text,
  p_offset integer,
  p_limit integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  v_email text;
  v_needle text := lower(btrim(coalesce(p_search, '')));
  v_filter text := case when p_filter = 'review' then 'review' else 'needs' end;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_counts jsonb;
  v_rows jsonb;
  v_total integer;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  select display_email into v_email from public.esh_email_principals where id = s.principal_id;

  if not s.inbox_scope then
    -- An action link is not an inbox (§9, FM09). Say which actions it does
    -- open, so the owner can go back to them.
    return jsonb_build_object(
      'ok', false, 'code', 'no_inbox_scope', 'email', v_email,
      'actions', coalesce((
        select jsonb_agg(jsonb_build_object('id', a.id, 'reference', f.reference, 'title', a.title)
                         order by f.reference)
          from public.esh_guest_session_actions x
          join public.esh_finding_actions a on a.id = x.action_id
          join public.esh_findings f on f.id = a.finding_id
         where x.session_id = s.id
           and focus.esh_guest_covers(s.id, s.principal_id, false, a.id)), '[]'::jsonb));
  end if;

  with mine as (
    select a.id, a.title, a.state, a.priority, a.due_at, a.due_is_date_only, a.assigned_at,
           f.reference, f.title as finding_title, f.location, d.name as department_name,
           greatest(a.assigned_at, (select max(m.sent_at) from public.esh_action_messages m
                                     where m.action_id = a.id)) as last_update_at,
           case a.priority when 'urgent' then 1 when 'high' then 2 else 3 end as priority_rank
      from public.esh_finding_actions a
      join public.esh_findings f on f.id = a.finding_id
      left join public.departments d on d.id = f.accountable_department_id
     where a.owner_principal_id = s.principal_id
       and a.organization_id = s.organization_id
       and a.state in ('assigned', 'in_progress', 'awaiting_verification')
       and f.status = 'open'
  ),
  matched as (
    select * from mine
     where v_needle = ''
        or position(v_needle in lower(reference || ' ' || title || ' ' || finding_title || ' '
                                      || coalesce(location, ''))) > 0
  )
  select jsonb_build_object(
           'needs', count(*) filter (where state in ('assigned', 'in_progress')),
           'review', count(*) filter (where state = 'awaiting_verification'))
    into v_counts
    from matched;

  with mine as (
    select a.id, a.title, a.state, a.priority, a.due_at, a.due_is_date_only,
           f.reference, f.title as finding_title, f.location, d.name as department_name,
           greatest(a.assigned_at, (select max(m.sent_at) from public.esh_action_messages m
                                     where m.action_id = a.id)) as last_update_at,
           case a.priority when 'urgent' then 1 when 'high' then 2 else 3 end as priority_rank
      from public.esh_finding_actions a
      join public.esh_findings f on f.id = a.finding_id
      left join public.departments d on d.id = f.accountable_department_id
     where a.owner_principal_id = s.principal_id
       and a.organization_id = s.organization_id
       and a.state in ('assigned', 'in_progress', 'awaiting_verification')
       and f.status = 'open'
  ),
  chosen as (
    select * from mine
     where (v_needle = ''
            or position(v_needle in lower(reference || ' ' || title || ' ' || finding_title || ' '
                                          || coalesce(location, ''))) > 0)
       and case when v_filter = 'review' then state = 'awaiting_verification'
                else state in ('assigned', 'in_progress') end
  ),
  page as (
    select * from chosen
     order by priority_rank, due_at, id
     offset v_offset
     limit v_limit
  )
  select (select count(*) from chosen),
         coalesce(jsonb_agg(jsonb_build_object(
           'id', page.id,
           'reference', page.reference,
           'title', page.title,
           'finding_title', page.finding_title,
           'location', page.location,
           'department', page.department_name,
           'priority', page.priority,
           'state', page.state,
           'due_at', page.due_at,
           'due_is_date_only', page.due_is_date_only,
           'last_update_at', page.last_update_at)
           order by page.priority_rank, page.due_at, page.id), '[]'::jsonb)
    into v_total, v_rows
    from page;

  return jsonb_build_object(
    'ok', true, 'email', v_email, 'filter', v_filter, 'counts', v_counts,
    'total', v_total, 'rows', v_rows);
end;
$$;

/*
 * One action as its owner sees it (§11): the header, the ESH contact and the
 * conversation, newest fifty with a cursor for earlier ones. Anything the
 * session does not reach reads as not available, whatever the reason.
 */
create or replace function public.esh_guest_action(
  p_session text,
  p_action_id uuid,
  p_before timestamptz default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  a public.esh_finding_actions;
  f public.esh_findings;
  v_principal public.esh_email_principals;
  v_creator public.user_profiles;
  v_department text;
  v_messages jsonb;
  v_more boolean;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null
     or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available', 'inbox_scope', s.inbox_scope);
  end if;

  select * into a from public.esh_finding_actions where id = p_action_id;
  select * into f from public.esh_findings where id = a.finding_id;
  select * into v_principal from public.esh_email_principals where id = s.principal_id;
  select * into v_creator from public.user_profiles where id = f.created_by;
  select name into v_department from public.departments where id = f.accountable_department_id;

  with recent as (
    select m.id, m.author_kind, m.author_name, m.author_email, m.body, m.sent_at
      from public.esh_action_messages m
     where m.action_id = a.id
       and (p_before is null or m.sent_at < p_before)
     order by m.sent_at desc, m.id desc
     limit 51
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'author_kind', r.author_kind,
           -- Staff are named, never addressed: their email stays internal.
           'author_name', case when r.author_kind = 'staff' then r.author_name else null end,
           'author_email', case when r.author_kind = 'owner' then r.author_email else null end,
           'body', r.body,
           'sent_at', r.sent_at) order by r.sent_at, r.id)
           filter (where r.rn <= 50), '[]'::jsonb),
         count(*) > 50
    into v_messages, v_more
    from (select recent.*, row_number() over (order by sent_at desc, id desc) as rn from recent) r;

  return jsonb_build_object(
    'ok', true,
    'email', v_principal.display_email,
    'display_name', v_principal.display_name,
    'principal_id', v_principal.id,
    'inbox_scope', s.inbox_scope,
    'action', jsonb_build_object(
      'id', a.id,
      'title', a.title,
      'state', a.state,
      'priority', a.priority,
      'required_outcome', a.required_outcome,
      'evidence_instruction', a.evidence_instruction,
      'due_at', a.due_at,
      'due_is_date_only', a.due_is_date_only,
      'assigned_at', a.assigned_at),
    'finding', jsonb_build_object(
      'reference', f.reference,
      'title', f.title,
      'description', f.description,
      'location', f.location,
      'department', v_department,
      'reported_on', f.reported_on),
    'esh_contact', jsonb_build_object('name', v_creator.full_name, 'email', v_creator.email),
    'messages', v_messages,
    'has_more', v_more);
end;
$$;

/*
 * The owner sends an update (§11, §12). A message is not a submission and
 * never closes anything (FM16); the first one moves Assigned to In progress,
 * because an update is work beginning (§6). Idempotent on the client key, so
 * a double press is one message.
 */
create or replace function public.esh_guest_send_message(
  p_session text,
  p_action_id uuid,
  p_body text,
  p_client_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  a public.esh_finding_actions;
  v_principal public.esh_email_principals;
  v_body text := btrim(coalesce(p_body, ''));
  v_existing uuid;
  v_message_id uuid;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;

  select * into a from public.esh_finding_actions where id = p_action_id for update;
  if not found or not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  if p_client_key is null or length(p_client_key) not between 8 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select id into v_existing from public.esh_action_messages
   where action_id = a.id and client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'message_id', v_existing, 'duplicate', true, 'state', a.state);
  end if;

  if v_body = '' then
    return jsonb_build_object('ok', false, 'code', 'body_required');
  end if;
  if length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'body_too_long');
  end if;
  if (select count(*) from public.esh_action_messages m
       where m.action_id = a.id and m.author_principal_id = s.principal_id
         and m.sent_at > now() - interval '10 minutes') >= 20 then
    return jsonb_build_object('ok', false, 'code', 'slow_down');
  end if;

  select * into v_principal from public.esh_email_principals where id = s.principal_id;

  insert into public.esh_action_messages
    (organization_id, action_id, author_kind, author_principal_id, author_email, author_name,
     body, client_key)
  values
    (a.organization_id, a.id, 'owner', s.principal_id, v_principal.display_email,
     v_principal.display_name, v_body, p_client_key)
  returning id into v_message_id;

  if a.state = 'assigned' then
    update public.esh_finding_actions set
      state = 'in_progress',
      updated_at = now(),
      row_version = row_version + 1
     where id = a.id;
    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id, detail)
    values
      (a.organization_id, 'principal', s.principal_id, 'action_started', a.finding_id, a.id,
       jsonb_build_object('message_id', v_message_id));
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'principal', s.principal_id, 'owner_message', a.finding_id, a.id,
     jsonb_build_object('message_id', v_message_id));

  return jsonb_build_object(
    'ok', true, 'message_id', v_message_id,
    'state', case when a.state = 'assigned' then 'in_progress' else a.state end);
end;
$$;

/*
 * Ask for a new link (§9, §19). Three ways in: from a session (the owner's
 * My Actions link), from a link this browser holds that no longer opens
 * (identifies the destination without asking), or by typing an email.
 *
 * The answer is the same whatever happens — nothing says whether an address
 * is known or has work (FM44). A link goes only to the address on record,
 * never to one supplied alongside a token (§19), only if that contact's
 * access is on and there is something to open, and at most three an hour, so
 * nobody can flood a mailbox. Requesting a link revokes nothing else (§19).
 */
create or replace function public.esh_guest_request_link(
  p_session text,
  p_token text,
  p_email text,
  p_organization_slug text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  s public.esh_guest_sessions;
  g public.esh_access_grants;
  v_principal_id uuid;
  v_organization_id uuid;
  v_intent text := 'owner_inbox';
  v_action_id uuid;
  v_finding_id uuid;
  v_outbox_id uuid;
  v_source text;
begin
  if p_session is not null then
    s := focus.esh_guest_resolve(p_session, false);
    v_principal_id := s.principal_id;
    v_source := 'session';
  elsif p_token is not null and p_token ~ '^[A-Za-z0-9_-]{40,64}$' then
    select * into g from public.esh_access_grants where token_hash = focus.esh_secret_hash(p_token);
    if found then
      v_principal_id := g.principal_id;
      v_source := 'link';
      if g.purpose = 'owner_action'
         and focus.esh_owner_holds(g.action_id, g.principal_id, null) then
        v_intent := 'owner_action';
        v_action_id := g.action_id;
      end if;
    end if;
  elsif p_email is not null and focus.esh_email_is_valid(p_email) then
    select id into v_organization_id from public.organizations where slug = p_organization_slug;
    select id into v_principal_id from public.esh_email_principals
     where organization_id = v_organization_id
       and canonical_email = focus.esh_canonical_email(p_email);
    v_source := 'email';
  end if;

  if v_principal_id is null or not focus.esh_contact_usable(v_principal_id) then
    return jsonb_build_object('ok', true);
  end if;
  select organization_id into v_organization_id from public.esh_email_principals where id = v_principal_id;

  if v_intent = 'owner_inbox' and not exists (
       select 1 from public.esh_finding_actions a
         join public.esh_findings f on f.id = a.finding_id
        where a.owner_principal_id = v_principal_id
          and a.state in ('assigned', 'in_progress', 'awaiting_verification')
          and f.status = 'open') then
    return jsonb_build_object('ok', true);
  end if;

  if (select count(*) from public.esh_notification_outbox o
       where o.recipient_principal_id = v_principal_id
         and o.event_type = 'access_link'
         and o.created_at > now() - interval '1 hour') >= 3 then
    insert into public.esh_audit_events
      (organization_id, actor_kind, event_type, subject_principal_id, detail)
    values
      (v_organization_id, 'system', 'guest_link_throttled', v_principal_id,
       jsonb_build_object('source', v_source));
    return jsonb_build_object('ok', true);
  end if;

  if v_action_id is not null then
    select finding_id into v_finding_id from public.esh_finding_actions where id = v_action_id;
  end if;

  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
     link_intents, idempotency_key, next_attempt_at)
  values
    (v_organization_id, 'access_link', v_principal_id, v_finding_id, v_action_id, 'queued',
     jsonb_build_array(v_intent), 'access_link:' || gen_random_uuid(), now())
  returning id into v_outbox_id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id,
     subject_principal_id, detail)
  values
    (v_organization_id, case when v_source = 'session' then 'principal' else 'system' end,
     case when v_source = 'session' then v_principal_id end,
     'guest_link_requested', v_finding_id, v_action_id, v_principal_id,
     jsonb_build_object('source', v_source, 'purpose', v_intent));

  return jsonb_build_object('ok', true, 'outbox_id', v_outbox_id);
end;
$$;

-- End access on this device (§10): the session stops working at once.
create or replace function public.esh_guest_end_session(p_session text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if p_session is null or length(p_session) < 40 then
    return jsonb_build_object('ok', true);
  end if;
  update public.esh_guest_sessions set revoked_at = now(), revoked_reason = 'ended_by_guest'
   where session_hash = focus.esh_secret_hash(p_session) and revoked_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Staff procedures
-- ---------------------------------------------------------------------------

/*
 * ESH writes in an action's conversation (§13). The owner is told there is a
 * reply — one pending notice at a time, however many messages (§17) — and
 * the notice is held like any other while their access is off.
 */
create or replace function public.esh_post_message(
  p_action_id uuid,
  p_body text,
  p_client_key text
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
  a public.esh_finding_actions;
  f public.esh_findings;
  v_actor public.user_profiles;
  v_body text := btrim(coalesce(p_body, ''));
  v_existing uuid;
  v_message_id uuid;
  v_state text;
begin
  if not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into a from public.esh_finding_actions
   where id = p_action_id and organization_id = org
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'action_not_found');
  end if;
  select * into f from public.esh_findings where id = a.finding_id;
  if not (focus.esh_scope_all()
          or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'action_not_found');
  end if;
  if f.status <> 'open' or a.state not in ('assigned', 'in_progress', 'awaiting_verification') then
    return jsonb_build_object('ok', false, 'code', 'action_closed');
  end if;
  if p_client_key is null or length(p_client_key) not between 8 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select id into v_existing from public.esh_action_messages
   where action_id = a.id and client_key = p_client_key;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'message_id', v_existing, 'duplicate', true);
  end if;
  if v_body = '' then
    return jsonb_build_object('ok', false, 'code', 'body_required');
  end if;
  if length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'body_too_long');
  end if;

  select * into v_actor from public.user_profiles where id = actor;

  insert into public.esh_action_messages
    (organization_id, action_id, author_kind, author_user_id, author_email, author_name, body,
     client_key)
  values
    (a.organization_id, a.id, 'staff', actor, v_actor.email, v_actor.full_name, v_body,
     p_client_key)
  returning id into v_message_id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'staff', actor, 'esh_message', a.finding_id, a.id,
     jsonb_build_object('message_id', v_message_id));

  -- Held too while the assignment email itself is still held: a reply notice
  -- carries a link, and must not open the conversation before ESH releases
  -- the assignment (§43.4).
  v_state := case when focus.esh_contact_usable(a.owner_principal_id)
                       and not exists (
                         select 1 from public.esh_notification_outbox held
                          where held.action_id = a.id
                            and held.recipient_principal_id = a.owner_principal_id
                            and held.event_type = 'owner_assignment'
                            and held.state = 'held_rollout')
                  then 'queued' else 'held_rollout' end;
  if not exists (
       select 1 from public.esh_notification_outbox o
        where o.action_id = a.id
          and o.recipient_principal_id = a.owner_principal_id
          and o.event_type = 'esh_reply'
          and o.state in ('queued', 'held_rollout')) then
    insert into public.esh_notification_outbox
      (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
       link_intents, idempotency_key, next_attempt_at)
    values
      (a.organization_id, 'esh_reply', a.owner_principal_id, a.finding_id, a.id, v_state,
       '["owner_action"]'::jsonb, 'esh_reply:' || v_message_id,
       case when v_state = 'queued' then now() end);
  end if;

  return jsonb_build_object('ok', true, 'message_id', v_message_id, 'notification', v_state);
end;
$$;

/*
 * Release a held notification (§43.4). Enabling a contact and releasing what
 * was held for them are separate, deliberate acts (FM106): this is the second,
 * by ESH, one notification at a time, and it refuses while the contact's
 * access is still off. Releasing an assignment email also settles any held
 * reply notices for that action — the assignment email opens the same
 * conversation, so they would only repeat it.
 */
create or replace function public.esh_release_notification(p_outbox_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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
  select * into f from public.esh_findings where id = o.finding_id;
  if f.id is null or not (focus.esh_scope_all()
                          or f.accountable_department_id = any (focus.esh_visible_department_ids())) then
    return jsonb_build_object('ok', false, 'code', 'notification_not_found');
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
$$;

/*
 * Switch an email contact's access on or off (§31.3, §43.2). Administrators
 * only; audited; the authorisation version moves.
 *
 * On does nothing else: nothing held is sent (FM106). Off takes effect at
 * once (FM107): every session and unspent link ends, anything waiting to be
 * sent goes back to held, and the work itself is untouched — the register
 * shows ESH the open actions whose owner can no longer be reached.
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
  if p.access_enabled = p_enabled then
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
 * Email contacts, for an administrator maintaining access (§31.3). Counts
 * only: looking after who may use the links is not a view of the findings
 * themselves (§43.1), so no titles or references appear here.
 */
create or replace function public.esh_admin_contacts(p_search text)
returns table (
  id uuid,
  display_email text,
  display_name text,
  status text,
  access_enabled boolean,
  access_changed_at timestamptz,
  access_changed_by text,
  access_reason text,
  open_actions integer,
  escalation_routes integer,
  held_notifications integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.display_email, p.display_name, p.status, p.access_enabled,
         case when p.access_enabled then p.access_enabled_at else p.access_disabled_at end,
         (select u.full_name from public.user_profiles u
           where u.id = case when p.access_enabled then p.access_enabled_by else p.access_disabled_by end),
         p.access_reason,
         (select count(*)::int from public.esh_finding_actions a
            join public.esh_findings f on f.id = a.finding_id
           where a.owner_principal_id = p.id
             and a.state in ('assigned', 'in_progress', 'awaiting_verification')
             and f.status = 'open'),
         (select count(distinct r.action_id)::int from public.esh_action_escalation_recipients r
           where r.principal_id = p.id and r.removed_at is null),
         (select count(*)::int from public.esh_notification_outbox o
           where o.recipient_principal_id = p.id and o.state = 'held_rollout'),
         p.created_at
    from public.esh_email_principals p
   where focus.is_admin()
     and (coalesce(btrim(p_search), '') = ''
          or position(lower(btrim(p_search)) in p.canonical_email) > 0
          or position(lower(btrim(p_search)) in lower(coalesce(p.display_name, ''))) > 0)
   order by p.canonical_email
   limit 200;
$$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_secret_hash(text) from public, anon, authenticated;
revoke all on function focus.esh_contact_usable(uuid) from public, anon, authenticated;
revoke all on function focus.esh_owner_holds(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function focus.esh_guest_resolve(text, boolean) from public, anon, authenticated;
revoke all on function focus.esh_guest_covers(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke all on function public.esh_dispatch_claim(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.esh_dispatch_complete(uuid, boolean, text, boolean, text)
  from public, anon, authenticated;
revoke all on function public.esh_guest_exchange(text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.esh_guest_my_actions(text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.esh_guest_action(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.esh_guest_send_message(text, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.esh_guest_request_link(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.esh_guest_end_session(text) from public, anon, authenticated;
revoke all on function public.esh_post_message(uuid, text, text) from public, anon;
revoke all on function public.esh_release_notification(uuid) from public, anon;
revoke all on function public.esh_set_contact_access(uuid, boolean, text) from public, anon;
revoke all on function public.esh_admin_contacts(text) from public, anon;

grant execute on function focus.esh_secret_hash(text) to service_role;
grant execute on function focus.esh_contact_usable(uuid) to service_role;
grant execute on function focus.esh_owner_holds(uuid, uuid, integer) to service_role;
grant execute on function focus.esh_guest_resolve(text, boolean) to service_role;
grant execute on function focus.esh_guest_covers(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.esh_dispatch_claim(uuid, jsonb) to service_role;
grant execute on function public.esh_dispatch_complete(uuid, boolean, text, boolean, text) to service_role;
grant execute on function public.esh_guest_exchange(text, text, text, text, boolean) to service_role;
grant execute on function public.esh_guest_my_actions(text, text, text, integer, integer) to service_role;
grant execute on function public.esh_guest_action(text, uuid, timestamptz) to service_role;
grant execute on function public.esh_guest_send_message(text, uuid, text, text) to service_role;
grant execute on function public.esh_guest_request_link(text, text, text, text) to service_role;
grant execute on function public.esh_guest_end_session(text) to service_role;
grant execute on function public.esh_post_message(uuid, text, text) to authenticated;
grant execute on function public.esh_release_notification(uuid) to authenticated;
grant execute on function public.esh_set_contact_access(uuid, boolean, text) to authenticated;
grant execute on function public.esh_admin_contacts(text) to authenticated;
