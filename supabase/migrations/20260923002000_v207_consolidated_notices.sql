-- ============================================================================
-- v207 ESH Finding Management: one email instead of eleven.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §41;
-- FM97-FM99.
--
-- An owner with eleven overdue actions should receive one letter listing
-- eleven, not eleven letters. Consolidation changes the packaging and nothing
-- else: every action still has its own notification event, its own entitlement
-- and its own delivery outcome, so a digest that fails says which eleven
-- things failed, and a level that was activated stays activated whatever the
-- email did.
--
-- Three rules keep it honest. A digest is revalidated member by member at the
-- moment of sending, so work submitted or reassigned in between drops out and
-- an empty digest is not sent at all. Urgent work is never held for one: an
-- assignment goes when it is made and an escalation goes when it is due. And
-- one event belongs to exactly one delivery, so nothing is sent both on its
-- own and again inside a summary.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A delivery that covers several events
-- ---------------------------------------------------------------------------

alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_event_type_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_event_type_check
  check (event_type in ('owner_assignment', 'esh_reply', 'access_link',
                        'submission_received', 'submission_withdrawn',
                        'changes_requested', 'due_changed', 'finding_closed',
                        'finding_reopened', 'reassigned_away',
                        'owner_reminder', 'escalation', 'review_reminder',
                        'escalation_exhausted', 'owner_reply',
                        'escalation_reply', 'import_assignment',
                        'owner_digest', 'escalation_digest'));

alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_state_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_state_check
  check (state in ('held_rollout', 'queued', 'processing', 'provider_accepted',
                   'delivered', 'bounced', 'failed', 'suppressed', 'cancelled',
                   -- v207: carried inside a digest rather than sent alone.
                   'digested'));

create table public.esh_digest_members (
  digest_id uuid not null references public.esh_notification_outbox (id),
  action_id uuid not null,
  -- The notification event this line carries, where the action had one of its
  -- own. A released backlog's summary has no separate event per action: the
  -- release wrote one delivery and these are the actions it covers.
  member_id uuid references public.esh_notification_outbox (id),
  escalation_level smallint,
  state text not null default 'included'
    check (state in ('included', 'removed', 'sent', 'failed')),
  removed_reason text,
  created_at timestamptz not null default now(),
  primary key (digest_id, action_id),
  -- One event belongs to one delivery. Without this an action could be told
  -- about on its own and again inside a summary of itself.
  unique (member_id)
);

create index esh_digest_members_digest_idx
  on public.esh_digest_members (digest_id, state);

alter table public.esh_digest_members enable row level security;

create policy esh_digest_members_select on public.esh_digest_members
  as permissive for select to authenticated
  using (digest_id in (select o.id from public.esh_notification_outbox o));

revoke all on public.esh_digest_members from anon, authenticated;
grant select on public.esh_digest_members to authenticated;
-- ---------------------------------------------------------------------------
-- 2. Gathering what is due into one delivery per person
-- ---------------------------------------------------------------------------

/**
 * Collect the routine notices that are due into digests.
 *
 * Run by the scheduler after the follow-up pass and before the mail drain, so
 * the reminders raised this morning leave as one letter each rather than as
 * eleven. Only the routine kinds are gathered: an assignment, a reply, a
 * decision and anything else that somebody is waiting on goes on its own, at
 * once, exactly as before (§41).
 *
 * Each member keeps its own event row, moved to `digested` so nothing can send
 * it twice, and the digest carries the delivery. A person with one thing due
 * still receives a digest of one, which reads as the single notice it is.
 */
create or replace function public.esh_build_digests(p_now timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  group_row record;
  v_digest uuid;
  v_cycle text;
  v_created integer := 0;
  v_gathered integer := 0;
  v_count integer;
begin
  for group_row in
    select o.organization_id,
           o.recipient_principal_id as principal_id,
           case when o.event_type = 'escalation' then 'escalation_digest' else 'owner_digest' end
             as digest_type,
           (p_now at time zone coalesce(org.timezone, 'Asia/Kuala_Lumpur'))::date as cycle_date,
           count(*) as due
      from public.esh_notification_outbox o
      join public.organizations org on org.id = o.organization_id
     where o.state = 'queued'
       and o.recipient_principal_id is not null
       and o.event_type in ('owner_reminder', 'escalation')
       and (o.next_attempt_at is null or o.next_attempt_at <= p_now)
     group by 1, 2, 3, 4
  loop
    v_cycle := group_row.digest_type || ':' || group_row.principal_id || ':' || group_row.cycle_date;

    -- One digest per person, purpose and cycle. A second run of the same
    -- morning finds it and adds nothing (FM99).
    select id into v_digest from public.esh_notification_outbox
     where idempotency_key = v_cycle;
    if not found then
      insert into public.esh_notification_outbox
        (organization_id, event_type, recipient_principal_id, state, link_intents,
         idempotency_key, next_attempt_at)
      values
        (group_row.organization_id, group_row.digest_type, group_row.principal_id,
         case when focus.esh_contact_usable(group_row.principal_id)
              then 'queued' else 'held_rollout' end,
         case when group_row.digest_type = 'owner_digest'
              then '["owner_inbox"]'::jsonb else '[]'::jsonb end,
         v_cycle,
         case when focus.esh_contact_usable(group_row.principal_id) then p_now end)
      returning id into v_digest;
      v_created := v_created + 1;
    end if;

    with gathered as (
      update public.esh_notification_outbox member set
        state = 'digested',
        state_reason = 'in_digest',
        next_attempt_at = null,
        updated_at = now()
       where member.state = 'queued'
         and member.recipient_principal_id = group_row.principal_id
         and member.organization_id = group_row.organization_id
         and member.event_type = case when group_row.digest_type = 'escalation_digest'
                                      then 'escalation' else 'owner_reminder' end
         and (member.next_attempt_at is null or member.next_attempt_at <= p_now)
      returning member.id, member.action_id, member.escalation_level
    )
    insert into public.esh_digest_members (digest_id, action_id, member_id, escalation_level)
    select v_digest, gathered.action_id, gathered.id, gathered.escalation_level
      from gathered
     where gathered.action_id is not null
    on conflict (digest_id, action_id) do nothing;
    get diagnostics v_count = row_count;
    v_gathered := v_gathered + v_count;
  end loop;

  -- A released backlog is the same idea: one letter per owner covering the
  -- actions that release gave them (§41, v205).
  for group_row in
    select o.id as digest_id, o.import_batch_id
      from public.esh_notification_outbox o
     where o.event_type = 'import_assignment'
       and o.state in ('queued', 'held_rollout')
       and not exists (select 1 from public.esh_digest_members m where m.digest_id = o.id)
  loop
    insert into public.esh_digest_members (digest_id, action_id)
    select group_row.digest_id, imported.action_id
      from public.esh_import_rows imported
      join public.esh_finding_actions action on action.id = imported.action_id
      join public.esh_notification_outbox digest on digest.id = group_row.digest_id
     where imported.batch_id = group_row.import_batch_id
       and imported.outcome = 'released'
       and action.owner_principal_id = digest.recipient_principal_id
    on conflict (digest_id, action_id) do nothing;
  end loop;

  return jsonb_build_object('ok', true, 'digests', v_created, 'gathered', v_gathered);
end;
$$;

/**
 * The actions a digest still intends to carry, before its links are minted.
 *
 * The worker asks first, mints one secret per action for an escalation digest,
 * and then claims. Nothing here changes any state: a member that has since
 * been resolved is dropped by the claim, which is the moment that counts.
 */
create or replace function public.esh_digest_prepare(p_outbox_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ok', true,
    'event_type', o.event_type,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('action_id', m.action_id,
                                          'escalation_level', m.escalation_level)
               order by m.created_at)
        from public.esh_digest_members m
       where m.digest_id = o.id and m.state = 'included'), '[]'::jsonb))
    from public.esh_notification_outbox o
   where o.id = p_outbox_id
     and o.event_type in ('owner_digest', 'escalation_digest', 'import_assignment');
$$;

-- ---------------------------------------------------------------------------
-- 3. The dispatcher carries a digest
--
-- Both routines are their latest definitions, extended rather than rewritten:
-- the claim gains the branch below, and completion maps its answer onto every
-- member. Everything a single notice was checked for, a member is checked for.
-- ---------------------------------------------------------------------------

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
  v_staff public.user_profiles;
  v_submission public.esh_action_submissions;
  -- v207
  v_member record;
  v_items jsonb := '[]'::jsonb;
  v_drop text;
  v_kept integer := 0;
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


  -- v207: a digest carries several events. Each one is re-checked here, at the
  -- moment of sending, exactly as it would be on its own; what no longer
  -- applies is dropped from the summary and closed off in its own right, and a
  -- summary with nothing left in it is not sent (§41, FM99).
  if o.event_type in ('owner_digest', 'escalation_digest', 'import_assignment') then
    if not focus.esh_contact_usable(o.recipient_principal_id) then
      update public.esh_notification_outbox set
        state = 'held_rollout',
        state_reason = 'access_not_enabled',
        next_attempt_at = null,
        updated_at = now()
       where id = o.id;
      return jsonb_build_object('ok', false, 'code', 'held');
    end if;
    select * into v_principal from public.esh_email_principals
     where id = o.recipient_principal_id;

    for v_member in
      select m.*, a.finding_id, a.assignment_version, a.state as action_state,
             a.owner_principal_id, a.due_at, a.due_is_date_only, a.title as action_title,
             f.reference, f.title as finding_title, f.location, f.status as finding_status
        from public.esh_digest_members m
        join public.esh_finding_actions a on a.id = m.action_id
        join public.esh_findings f on f.id = a.finding_id
       where m.digest_id = o.id and m.state = 'included'
       order by m.created_at
    loop
      v_drop := null;
      if v_member.finding_status <> 'open' then
        v_drop := 'finding_closed';
      elsif o.event_type = 'escalation_digest' then
        if v_member.action_state not in ('assigned', 'in_progress')
           or not focus.esh_escalation_live(v_member.action_id, o.recipient_principal_id,
                                            v_member.escalation_level) then
          v_drop := 'no_longer_escalated';
        end if;
      else
        if v_member.owner_principal_id is distinct from o.recipient_principal_id then
          v_drop := 'reassigned';
        elsif v_member.action_state not in ('assigned', 'in_progress') then
          v_drop := 'already_answered';
        end if;
      end if;

      -- A reminder whose schedule moved under it is stale, the same way a
      -- single reminder would be (v201).
      if v_drop is null and v_member.member_id is not null then
        if exists (
          select 1
            from public.esh_notification_outbox member
            join public.esh_followup_events event on event.id = member.followup_event_id
           where member.id = v_member.member_id
             and (event.assignment_version is distinct from v_member.assignment_version
                  or event.due_at_snapshot is distinct from v_member.due_at)) then
          v_drop := 'schedule_changed';
        end if;
      end if;

      if v_drop is not null then
        update public.esh_digest_members set state = 'removed', removed_reason = v_drop
         where digest_id = o.id and action_id = v_member.action_id;
        if v_member.member_id is not null then
          update public.esh_notification_outbox set
            state = 'suppressed',
            state_reason = v_drop,
            next_attempt_at = null,
            updated_at = now()
           where id = v_member.member_id;
        end if;
        continue;
      end if;

      -- An escalation recipient gets a link of their own per action; the owner
      -- follows their own My Actions link instead (§41).
      if o.event_type = 'escalation_digest' then
        v_secret := p_secrets->>(v_member.action_id::text);
        if v_secret is null then
          raise exception 'esh_dispatch_claim: no secret for action %', v_member.action_id;
        end if;
        insert into public.esh_access_grants
          (organization_id, principal_id, purpose, action_id, assignment_version, outbox_id,
           token_hash, issued_reason, expires_at)
        values
          (o.organization_id, o.recipient_principal_id, 'escalation_action', v_member.action_id,
           v_member.assignment_version, o.id, focus.esh_secret_hash(v_secret), 'notification',
           now() + interval '24 hours');
      end if;

      v_items := v_items || jsonb_build_object(
        'action_id', v_member.action_id,
        'reference', v_member.reference,
        'finding_title', v_member.finding_title,
        'action_title', v_member.action_title,
        'location', v_member.location,
        'escalation_level', v_member.escalation_level,
        'due_at', v_member.due_at,
        'due_is_date_only', v_member.due_is_date_only);
      v_kept := v_kept + 1;
    end loop;

    if v_kept = 0 then
      update public.esh_notification_outbox set
        state = 'suppressed',
        state_reason = 'nothing_left_to_say',
        next_attempt_at = null,
        updated_at = now()
       where id = o.id;
      return jsonb_build_object('ok', false, 'code', 'suppressed');
    end if;

    if o.link_intents ? 'owner_inbox' then
      v_secret := p_secrets->>'owner_inbox';
      if v_secret is null then
        raise exception 'esh_dispatch_claim: no secret for owner_inbox';
      end if;
      insert into public.esh_access_grants
        (organization_id, principal_id, purpose, outbox_id, token_hash, issued_reason, expires_at)
      values
        (o.organization_id, o.recipient_principal_id, 'owner_inbox', o.id,
         focus.esh_secret_hash(v_secret), 'notification', now() + interval '24 hours');
    end if;

    select timezone into v_timezone from public.organizations where id = o.organization_id;
    select profile.* into v_creator
      from public.user_profiles profile
      join public.esh_findings finding on finding.created_by = profile.id
     where finding.id = (v_items->0->>'action_id')::uuid
     limit 1;
    update public.esh_notification_outbox set
      state = 'processing',
      attempts = attempts + 1,
      updated_at = now()
     where id = o.id;
    return jsonb_build_object(
      'ok', true,
      'event_type', o.event_type,
      'to', v_principal.display_email,
      'recipient_name', v_principal.display_name,
      'items', v_items,
      'timezone', coalesce(v_timezone, 'Asia/Kuala_Lumpur'),
      'expires_minutes', 1440);
  end if;

  -- v199: a staff member told of a submission. They sign in as usual, so no
  -- link is minted; they must still be able to review this finding, and the
  -- submission must still be the one it was about.
  if o.recipient_user_id is not null then
    select * into v_submission from public.esh_action_submissions where id = o.submission_id;
    if not focus.esh_user_can_coordinate(o.recipient_user_id, o.finding_id)
       or (o.event_type in ('submission_received', 'review_reminder')
           and v_submission.state is distinct from 'pending') then
      update public.esh_notification_outbox set
        state = 'suppressed',
        state_reason = case when v_submission.state is distinct from 'pending'
                                 and o.event_type = 'submission_received'
                            then 'no_longer_pending' else 'no_longer_esh' end,
        next_attempt_at = null,
        updated_at = now()
       where id = o.id;
      return jsonb_build_object('ok', false, 'code', 'suppressed');
    end if;
    select * into v_staff from public.user_profiles where id = o.recipient_user_id;
    select * into v_action from public.esh_finding_actions where id = o.action_id;
    select * into v_finding from public.esh_findings where id = o.finding_id;
    select timezone into v_timezone from public.organizations where id = o.organization_id;
    update public.esh_notification_outbox set
      state = 'processing',
      attempts = attempts + 1,
      updated_at = now()
     where id = o.id;
    return jsonb_build_object(
      'ok', true,
      'event_type', o.event_type,
      'to', v_staff.email,
      'recipient_name', v_staff.full_name,
      'intents', '[]'::jsonb,
      'finding_id', o.finding_id,
      'action_id', o.action_id,
      'reference', v_finding.reference,
      'finding_title', v_finding.title,
      'action_title', v_action.title,
      'location', v_finding.location,
      'owner_email', coalesce(
        v_submission.owner_email,
        (select principal.display_email
           from public.esh_email_principals principal
          where principal.id = v_action.owner_principal_id)),
      'submission_version', v_submission.version,
      'followup_kind', (select event.kind from public.esh_followup_events event
                         where event.id = o.followup_event_id),
      'days_overdue', (select (event.detail->>'days_overdue')::int
                         from public.esh_followup_events event
                        where event.id = o.followup_event_id),
      'escalation_level', o.escalation_level,
      'due_at', v_action.due_at,
      'due_is_date_only', v_action.due_is_date_only,
      'timezone', coalesce(v_timezone, 'Asia/Kuala_Lumpur'),
      'expires_minutes', 0);
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
  if o.event_type in ('esh_reply', 'changes_requested', 'due_changed', 'finding_reopened') and exists (
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
    -- v200: a closure or a reassignment note is news about work that is no
    -- longer theirs by design; it carries no link, so nothing is re-checked
    -- beyond the contact's own access.
    -- v201: every kind is re-checked against live state at the moment of
    -- sending (§16): a reminder for work already submitted, or an escalation
    -- whose level was revoked, is dropped rather than sent stale (FM35).
    if o.followup_event_id is not null and exists (
      select 1
        from public.esh_followup_events event
       where event.id = o.followup_event_id
         and (event.assignment_version is distinct from v_action.assignment_version
              or event.due_at_snapshot is distinct from v_action.due_at)
    ) then
      update public.esh_notification_outbox set
        state = 'suppressed',
        state_reason = 'schedule_changed',
        next_attempt_at = null,
        updated_at = now()
       where id = o.id;
      return jsonb_build_object('ok', false, 'code', 'suppressed');
    elsif o.event_type = 'escalation' then
      if v_action.state not in ('assigned', 'in_progress')
         or not focus.esh_escalation_live(o.action_id, o.recipient_principal_id, null) then
        update public.esh_notification_outbox set
          state = 'suppressed',
          state_reason = 'escalation_no_longer_live',
          next_attempt_at = null,
          updated_at = now()
         where id = o.id;
        return jsonb_build_object('ok', false, 'code', 'suppressed');
      end if;
    elsif o.event_type = 'owner_reminder'
          and (v_action.state not in ('assigned', 'in_progress')
               or not focus.esh_owner_holds(o.action_id, o.recipient_principal_id, null)) then
      update public.esh_notification_outbox set
        state = 'suppressed',
        state_reason = 'no_longer_due',
        next_attempt_at = null,
        updated_at = now()
       where id = o.id;
      return jsonb_build_object('ok', false, 'code', 'suppressed');
    elsif o.event_type not in ('finding_closed', 'reassigned_away', 'escalation', 'owner_reminder')
       and not focus.esh_owner_holds(o.action_id, o.recipient_principal_id, null) then
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
       case when v_intent in ('owner_action', 'escalation_action') then o.action_id end,
       case when v_intent in ('owner_action', 'escalation_action') then v_version end,
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
    'escalation_level', o.escalation_level,
    'owner_email', (select p.display_email from public.esh_email_principals p
                     where p.id = v_action.owner_principal_id),
    'followup_kind', (select e.kind from public.esh_followup_events e
                       where e.id = o.followup_event_id),
    'days_overdue', (select (e.detail->>'days_overdue')::int
                       from public.esh_followup_events e
                      where e.id = o.followup_event_id),
    'expires_minutes', (extract(epoch from v_ttl) / 60)::int);
end;
$$;

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
    -- v207: a digest's outcome is every member's outcome, recorded per action
    -- so the register can say which notices actually went (FM99).
    update public.esh_digest_members set state = 'sent'
     where digest_id = o.id and state = 'included';
    update public.esh_notification_outbox member set
      state = 'provider_accepted',
      state_reason = 'sent_in_digest',
      sent_at = now(),
      updated_at = now()
     where member.id in (select m.member_id from public.esh_digest_members m
                          where m.digest_id = o.id and m.state = 'sent' and m.member_id is not null)
       and member.state = 'digested';
    return jsonb_build_object('ok', true, 'state', 'provider_accepted');
  end if;

  update public.esh_access_grants set
    revoked_at = now(),
    revoked_reason = 'send_failed'
   where outbox_id = o.id and consumed_at is null and revoked_at is null;

  -- A failed digest is a failure of each thing it carried, and a retry sends
  -- one message again rather than manufacturing several (§41).
  update public.esh_digest_members set state = 'failed'
   where digest_id = o.id and state = 'included';

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
-- 4. Privileges
-- ---------------------------------------------------------------------------

revoke all on function public.esh_build_digests(timestamptz) from public, anon, authenticated;
revoke all on function public.esh_digest_prepare(uuid) from public, anon, authenticated;

grant execute on function public.esh_build_digests(timestamptz) to service_role;
grant execute on function public.esh_digest_prepare(uuid) to service_role;
