-- ============================================================================
-- v201 ESH Finding Management: follow-up, reminders and escalation.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §15,
-- §16, §17, §24; FM30-FM39.
--
--   * one configurable follow-up policy per organisation, versioned, with the
--     version an action was assigned under kept on its ownership interval;
--   * a scheduler that follows outstanding responsibility: it reminds the
--     owner before and after the due date, escalates level by level, and
--     stops the moment the work is submitted — then follows ESH instead;
--   * escalation recipients who are told their own level, with their own
--     scoped link, and can reply or acknowledge but never submit or close;
--   * every trigger recorded once, so a re-run, a catch-up after downtime or
--     a restart cannot send the same reminder twice (FM37).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The policy (§16)
-- ---------------------------------------------------------------------------

create table public.esh_followup_policies (
  organization_id uuid primary key references public.organizations (id),
  version integer not null default 1,
  -- Calendar days before the due date for the first reminder; 0 turns it off.
  pre_due_days smallint not null default 2 check (pre_due_days between 0 and 30),
  remind_on_due boolean not null default true,
  -- How often an overdue owner is reminded, in calendar days.
  overdue_every_days smallint not null default 2 check (overdue_every_days between 1 and 30),
  -- Days overdue at which each level is told. One entry per level, in order.
  level_days smallint[] not null default array[1, 3, 7]::smallint[],
  -- Days after a submission before ESH is reminded to review it.
  review_reminder_days smallint not null default 2 check (review_reminder_days between 1 and 30),
  updated_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  check (array_length(level_days, 1) between 1 and 9),
  check (array_position(level_days, null) is null)
);

insert into public.esh_followup_policies (organization_id)
select id from public.organizations where slug = 'tamco'
on conflict (organization_id) do nothing;

-- "Working day" is an organisation-maintained calendar, not a hidden claim
-- that Monday-Friday includes Malaysian public holidays (§16). The weekly
-- pattern is explicit and exceptions carry their own labels. Until ESH sets
-- confirmed_through, the UI says that holiday coverage is unconfirmed.
create table public.esh_working_calendars (
  organization_id uuid primary key references public.organizations (id),
  working_weekdays smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  confirmed_through date,
  updated_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  check (cardinality(working_weekdays) between 1 and 7),
  check (array_position(working_weekdays, null) is null)
);

create table public.esh_working_calendar_exceptions (
  organization_id uuid not null references public.organizations (id),
  calendar_date date not null,
  is_working_day boolean not null,
  label text not null check (length(btrim(label)) between 1 and 120),
  updated_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  primary key (organization_id, calendar_date)
);

insert into public.esh_working_calendars (organization_id)
select id from public.organizations where slug = 'tamco'
on conflict (organization_id) do nothing;

create or replace function focus.esh_is_working_day(p_organization_id uuid, p_day date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select exception.is_working_day
       from public.esh_working_calendar_exceptions exception
      where exception.organization_id = p_organization_id
        and exception.calendar_date = p_day),
    (select extract(isodow from p_day)::smallint = any (calendar.working_weekdays)
       from public.esh_working_calendars calendar
      where calendar.organization_id = p_organization_id),
    false);
$$;

create or replace function focus.esh_after_working_days(
  p_organization_id uuid,
  p_start date,
  p_days integer
)
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := p_start;
  v_left integer := greatest(coalesce(p_days, 0), 0);
  v_guard integer := 0;
begin
  while v_left > 0 loop
    v_day := v_day + 1;
    if focus.esh_is_working_day(p_organization_id, v_day) then
      v_left := v_left - 1;
    end if;
    v_guard := v_guard + 1;
    if v_guard > 370 then
      raise exception 'working calendar cannot resolve % days', p_days;
    end if;
  end loop;
  return v_day;
end;
$$;

-- The policy an ownership interval started under, so a later change never
-- rewrites what was promised for work already assigned (§16).
alter table public.esh_action_assignments
  add column policy_version integer,
  add column followup_pre_due_days smallint,
  add column followup_remind_on_due boolean,
  add column followup_overdue_every_days smallint,
  add column followup_level_days smallint[],
  add column followup_review_reminder_days smallint;

create or replace function focus.esh_stamp_policy_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.policy_version is null then
    select version,
           pre_due_days,
           remind_on_due,
           overdue_every_days,
           level_days,
           review_reminder_days
      into new.policy_version,
           new.followup_pre_due_days,
           new.followup_remind_on_due,
           new.followup_overdue_every_days,
           new.followup_level_days,
           new.followup_review_reminder_days
      from public.esh_followup_policies
     where organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

create trigger esh_action_assignments_policy_version
  before insert on public.esh_action_assignments
  for each row execute function focus.esh_stamp_policy_version();

-- Existing live assignments predate the trigger. Give them the rules that
-- were current when this feature was introduced. Future policy edits update
-- only the organisation row: each assignment keeps this complete snapshot.
update public.esh_action_assignments assignment set
  policy_version = policy.version,
  followup_pre_due_days = policy.pre_due_days,
  followup_remind_on_due = policy.remind_on_due,
  followup_overdue_every_days = policy.overdue_every_days,
  followup_level_days = policy.level_days,
  followup_review_reminder_days = policy.review_reminder_days
from public.esh_followup_policies policy
where policy.organization_id = assignment.organization_id
  and assignment.policy_version is null;

alter table public.esh_action_assignments
  alter column policy_version set not null,
  alter column followup_pre_due_days set not null,
  alter column followup_remind_on_due set not null,
  alter column followup_overdue_every_days set not null,
  alter column followup_level_days set not null,
  alter column followup_review_reminder_days set not null;

-- ---------------------------------------------------------------------------
-- 2. What the scheduler has already done (§16, §21 followup_events)
--
-- One row per thing that fired, keyed so a second run of the same day, a
-- catch-up after downtime or a restart adds nothing (FM37).
-- ---------------------------------------------------------------------------

create table public.esh_followup_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  kind text not null check (kind in ('owner_pre_due', 'owner_due', 'owner_overdue',
                                     'escalation', 'review_reminder')),
  stage smallint,
  -- What makes it once-only: the date it was for, or the level it reached.
  trigger_key text not null,
  policy_version integer,
  assignment_version integer,
  due_at_snapshot timestamptz,
  state text not null default 'triggered' check (state in ('triggered', 'suppressed')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  unique (action_id, kind, trigger_key)
);

create index esh_followup_action_idx on public.esh_followup_events (action_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Escalation entitlements (§15, §21 escalation_entitlements)
--
-- A configured recipient has nothing until their level is reached (FM32).
-- Activation is per assignment: a reassignment starts the route again.
-- ---------------------------------------------------------------------------

create table public.esh_escalation_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  action_id uuid not null,
  level smallint not null check (level between 1 and 9),
  principal_id uuid not null,
  assignment_version integer not null,
  activated_at timestamptz not null default now(),
  activated_event_id uuid references public.esh_followup_events (id),
  acknowledged_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  foreign key (organization_id, action_id) references public.esh_finding_actions (organization_id, id),
  foreign key (organization_id, principal_id)
    references public.esh_email_principals (organization_id, id),
  unique (action_id, level, principal_id, assignment_version)
);

create index esh_escalation_entitlement_idx
  on public.esh_escalation_entitlements (principal_id, action_id);

-- ---------------------------------------------------------------------------
-- 4. Links and sessions reach one more thing (§9, §15)
-- ---------------------------------------------------------------------------

alter table public.esh_access_grants drop constraint esh_access_grants_purpose_check;
alter table public.esh_access_grants
  add constraint esh_access_grants_purpose_check
  check (purpose in ('owner_action', 'owner_inbox', 'escalation_action'));
alter table public.esh_access_grants drop constraint esh_access_grants_check;
alter table public.esh_access_grants
  add constraint esh_access_grants_check
  check ((purpose in ('owner_action', 'escalation_action'))
         = (action_id is not null and assignment_version is not null));

create table public.esh_guest_session_escalations (
  session_id uuid not null references public.esh_guest_sessions (id) on delete cascade,
  action_id uuid not null references public.esh_finding_actions (id),
  level smallint not null,
  assignment_version integer not null,
  primary key (session_id, action_id)
);

-- An escalation recipient writes in the conversation too (§15).
alter table public.esh_action_messages drop constraint esh_action_messages_author_kind_check;
alter table public.esh_action_messages
  add constraint esh_action_messages_author_kind_check
  check (author_kind in ('owner', 'staff', 'escalation'));
alter table public.esh_action_messages drop constraint esh_action_messages_check;
alter table public.esh_action_messages
  add constraint esh_action_messages_check
  check ((author_kind in ('owner', 'escalation'))
         = (author_principal_id is not null and author_user_id is null));

-- ---------------------------------------------------------------------------
-- 5. More the outbox carries
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
                        'escalation_reply'));
alter table public.esh_notification_outbox
  add column followup_event_id uuid references public.esh_followup_events (id),
  add column escalation_level smallint;

alter table public.esh_notification_outbox
  drop constraint esh_notification_outbox_state_check;
alter table public.esh_notification_outbox
  add constraint esh_notification_outbox_state_check
  check (state in ('held_rollout', 'queued', 'processing', 'provider_accepted',
                   'delivered', 'bounced', 'failed', 'suppressed', 'cancelled'));

-- Provider callbacks are facts of their own. A later bounce must never erase
-- the earlier provider acceptance, and a repeated webhook must be harmless.
create table public.esh_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  outbox_id uuid not null references public.esh_notification_outbox (id),
  provider_event_id text not null unique,
  provider_message_id text,
  event_type text not null check (event_type in ('delivered', 'bounced', 'failed')),
  detail text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index esh_delivery_events_outbox_idx
  on public.esh_delivery_events (outbox_id, occurred_at);

alter table public.esh_followup_policies enable row level security;
alter table public.esh_working_calendars enable row level security;
alter table public.esh_working_calendar_exceptions enable row level security;
alter table public.esh_followup_events enable row level security;
alter table public.esh_escalation_entitlements enable row level security;
alter table public.esh_delivery_events enable row level security;

create policy esh_followup_policies_select on public.esh_followup_policies
  as permissive for select to authenticated
  using ((select focus.esh_enabled()) and organization_id = (select focus.esh_organization_id()));
create policy esh_working_calendars_select on public.esh_working_calendars
  as permissive for select to authenticated
  using ((select focus.esh_enabled()) and organization_id = (select focus.esh_organization_id()));
create policy esh_working_calendar_exceptions_select
  on public.esh_working_calendar_exceptions
  as permissive for select to authenticated
  using ((select focus.esh_enabled()) and organization_id = (select focus.esh_organization_id()));
create policy esh_followup_events_select on public.esh_followup_events
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));
create policy esh_escalation_entitlements_select on public.esh_escalation_entitlements
  as permissive for select to authenticated
  using (action_id in (select a.id from public.esh_finding_actions a));
create policy esh_delivery_events_select on public.esh_delivery_events
  as permissive for select to authenticated
  using (outbox_id in (select o.id from public.esh_notification_outbox o));

revoke all on public.esh_followup_policies, public.esh_working_calendars,
  public.esh_working_calendar_exceptions, public.esh_followup_events,
  public.esh_escalation_entitlements, public.esh_guest_session_escalations,
  public.esh_delivery_events
  from anon, authenticated;
grant select on public.esh_followup_policies, public.esh_working_calendars,
  public.esh_working_calendar_exceptions, public.esh_followup_events,
  public.esh_escalation_entitlements, public.esh_delivery_events to authenticated;

-- Bounces and terminal send failures are the same operational signal in the
-- register: the recipient was not reached. Provider acceptance alone is not
-- presented as delivery or acknowledgment.
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
                 or coalesce(a.state = 'awaiting_verification', false)
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

revoke all on public.esh_register_rows from anon, authenticated;
grant select on public.esh_register_rows to authenticated;

-- A meaningful reply belongs in the conversation, but the ESH person who
-- owns the review also needs to know it arrived. Prefer the named reviewer;
-- until there is one, notify the Verifiers whose scope covers the finding.
create or replace function focus.esh_notify_action_staff(
  p_action_id uuid,
  p_event text,
  p_message_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a public.esh_finding_actions;
  v_count integer := 0;
  v_user uuid;
begin
  if p_event not in ('owner_reply', 'escalation_reply') or p_message_id is null then
    raise exception 'esh_notify_action_staff: invalid event';
  end if;
  select * into a from public.esh_finding_actions where id = p_action_id;
  if not found then
    return 0;
  end if;
  for v_user in
    select candidate from (
      select a.reviewer_user_id as candidate, 0 as rank
       where a.reviewer_user_id is not null
         and focus.esh_user_can_coordinate(a.reviewer_user_id, a.finding_id)
      union all
      select access.user_id, 1
        from public.esh_staff_access access
       where a.reviewer_user_id is null
         and access.organization_id = a.organization_id
         and access.enabled
         and access.preset = 'verifier'
         and focus.esh_user_can_coordinate(access.user_id, a.finding_id)
    ) people
    order by rank
    limit 20
  loop
    insert into public.esh_notification_outbox
      (organization_id, event_type, recipient_user_id, finding_id, action_id,
       state, link_intents, idempotency_key, next_attempt_at)
    values
      (a.organization_id, p_event, v_user, a.finding_id, a.id,
       'queued', '[]'::jsonb, p_event || ':' || p_message_id || ':' || v_user, now())
    on conflict (idempotency_key) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. The scheduler (§16)
--
-- One pass a day, from the platform's cron. It follows outstanding
-- responsibility: while the work is the owner's it reminds them and, once
-- overdue, escalates; the moment they submit, owner follow-up stops and ESH's
-- own reminder starts. Every trigger is recorded once (unique on action, kind
-- and key), so a second run, a catch-up after downtime or a restart adds
-- nothing (FM37). Missed escalation levels are recorded as skipped and only
-- the highest due level is sent — a storm of back-dated email helps nobody.
-- ---------------------------------------------------------------------------

create or replace function public.esh_run_followups(p_now timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a record;
  r record;
  v_today date;
  v_due date;
  v_overdue integer;
  v_levels integer;
  v_target integer;
  v_level integer;
  v_key text;
  v_event uuid;
  v_kind text;
  v_owner integer := 0;
  v_escalations integer := 0;
  v_reviews integer := 0;
  v_submission public.esh_action_submissions;
begin
  for a in
    select act.id, act.organization_id, act.finding_id, act.state, act.due_at,
           act.due_is_date_only, act.owner_principal_id, act.assignment_version,
           act.current_submission_id, o.timezone,
           assignment.policy_version,
           assignment.followup_pre_due_days,
           assignment.followup_remind_on_due,
           assignment.followup_overdue_every_days,
           assignment.followup_level_days,
           assignment.followup_review_reminder_days
      from public.esh_finding_actions act
      join public.esh_findings f on f.id = act.finding_id
      join public.organizations o on o.id = act.organization_id
      join public.esh_action_assignments assignment
        on assignment.action_id = act.id
       and assignment.version = act.assignment_version
       and assignment.ended_at is null
     where f.status = 'open'
       and act.state in ('assigned', 'in_progress', 'awaiting_verification')
     order by act.id
  loop
    v_today := (p_now at time zone a.timezone)::date;

    -- ESH's turn: remind whoever reviews, once per submission (§16, FM36).
    if a.state = 'awaiting_verification' then
      select * into v_submission from public.esh_action_submissions
       where id = a.current_submission_id;
      v_event := null;
      if found and v_submission.state = 'pending'
         and v_today >= focus.esh_after_working_days(
           a.organization_id,
           (v_submission.submitted_at at time zone a.timezone)::date,
           a.followup_review_reminder_days) then
        insert into public.esh_followup_events
          (organization_id, action_id, kind, trigger_key, policy_version, assignment_version,
           due_at_snapshot, detail)
        values
          (a.organization_id, a.id, 'review_reminder', 'submission-' || v_submission.id,
           a.policy_version, a.assignment_version, a.due_at,
           jsonb_build_object('submission_id', v_submission.id))
        on conflict (action_id, kind, trigger_key) do nothing
        returning id into v_event;
        if v_event is not null then
          v_reviews := v_reviews + focus.esh_notify_reviewers(v_submission.id, 'review_reminder');
          v_event := null;
        end if;
      end if;
      continue;
    end if;

    if a.due_at is null then
      continue;
    end if;
    v_due := (a.due_at at time zone a.timezone)::date;

    -- The owner's reminders: before, on the day, then every so often (§16).
    v_kind := null;
    if a.followup_pre_due_days > 0 and v_today = v_due - a.followup_pre_due_days then
      v_kind := 'owner_pre_due';
    elsif a.followup_remind_on_due and v_today = v_due then
      v_kind := 'owner_due';
    elsif v_today > v_due and (v_today - v_due) % a.followup_overdue_every_days = 0 then
      v_kind := 'owner_overdue';
    end if;
    if v_kind is not null then
      v_event := null;
      insert into public.esh_followup_events
        (organization_id, action_id, kind, trigger_key, policy_version, assignment_version,
         due_at_snapshot, detail)
      values
        (a.organization_id, a.id, v_kind, v_today::text, a.policy_version,
         a.assignment_version, a.due_at,
         jsonb_build_object('days_overdue', greatest(v_today - v_due, 0)))
      on conflict (action_id, kind, trigger_key) do nothing
      returning id into v_event;
      if v_event is not null then
        perform focus.esh_tell_owner(a.id, a.owner_principal_id, 'owner_reminder',
                                     '["owner_action"]'::jsonb,
                                     'owner_reminder:' || a.id || ':' || v_kind || ':' || v_today);
        update public.esh_notification_outbox set followup_event_id = v_event
         where idempotency_key = 'owner_reminder:' || a.id || ':' || v_kind || ':' || v_today;
        v_owner := v_owner + 1;
        v_event := null;
      end if;
    end if;

    if v_today <= v_due then
      continue;
    end if;
    v_overdue := v_today - v_due;

    -- Escalation: the highest level now due, with the ones it passed recorded
    -- as skipped rather than sent late (§16).
    select coalesce(max(level), 0) into v_levels
      from public.esh_action_escalation_recipients
     where action_id = a.id and removed_at is null;
    v_target := 0;
    for v_level in 1 .. v_levels loop
      if v_overdue >= a.followup_level_days[v_level] then
        v_target := v_level;
      end if;
    end loop;
    if v_target = 0 then
      continue;
    end if;
    v_key := 'level-' || v_target || '-v' || a.assignment_version;
    if exists (select 1 from public.esh_followup_events e
                where e.action_id = a.id and e.kind = 'escalation' and e.trigger_key = v_key) then
      continue;
    end if;
    for v_level in 1 .. v_target - 1 loop
      insert into public.esh_followup_events
        (organization_id, action_id, kind, stage, trigger_key, policy_version, assignment_version,
         due_at_snapshot, state, detail)
      values
        (a.organization_id, a.id, 'escalation', v_level,
         'level-' || v_level || '-v' || a.assignment_version, a.policy_version,
         a.assignment_version,
         a.due_at, 'suppressed', jsonb_build_object('reason', 'coalesced', 'sent_level', v_target))
      on conflict (action_id, kind, trigger_key) do nothing;
    end loop;

    insert into public.esh_followup_events
      (organization_id, action_id, kind, stage, trigger_key, policy_version, assignment_version,
       due_at_snapshot, detail)
    values
      (a.organization_id, a.id, 'escalation', v_target, v_key, a.policy_version,
       a.assignment_version,
       a.due_at, jsonb_build_object('days_overdue', v_overdue))
    returning id into v_event;

    for r in
      select rec.principal_id
        from public.esh_action_escalation_recipients rec
       where rec.action_id = a.id and rec.level = v_target and rec.removed_at is null
    loop
      insert into public.esh_escalation_entitlements
        (organization_id, action_id, level, principal_id, assignment_version, activated_event_id)
      values
        (a.organization_id, a.id, v_target, r.principal_id, a.assignment_version, v_event)
      on conflict (action_id, level, principal_id, assignment_version) do nothing;
      insert into public.esh_notification_outbox
        (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
         link_intents, idempotency_key, next_attempt_at, followup_event_id, escalation_level)
      values
        (a.organization_id, 'escalation', r.principal_id, a.finding_id, a.id,
         case when focus.esh_contact_usable(r.principal_id) then 'queued' else 'held_rollout' end,
         '["escalation_action"]'::jsonb,
         'escalation:' || a.id || ':' || v_target || ':' || r.principal_id || ':v'
           || a.assignment_version,
         case when focus.esh_contact_usable(r.principal_id) then p_now end,
         v_event, v_target)
      on conflict (idempotency_key) do nothing;
      v_escalations := v_escalations + 1;
    end loop;

    insert into public.esh_audit_events
      (organization_id, actor_kind, event_type, finding_id, action_id, detail)
    values
      (a.organization_id, 'system', 'escalation_activated', a.finding_id, a.id,
       jsonb_build_object('level', v_target, 'days_overdue', v_overdue,
                          'skipped_levels', greatest(v_target - 1, 0)));

    -- The last configured level, reached and still not done: ESH is told, once
    -- per assignment. No level after the last one is invented (§16).
    if v_target = v_levels then
      v_event := null;
      insert into public.esh_followup_events
        (organization_id, action_id, kind, stage, trigger_key, policy_version, assignment_version,
         due_at_snapshot, detail)
      values
        (a.organization_id, a.id, 'escalation', v_target,
         'exhausted-v' || a.assignment_version, a.policy_version,
         a.assignment_version, a.due_at,
         jsonb_build_object('days_overdue', v_overdue))
      on conflict (action_id, kind, trigger_key) do nothing
      returning id into v_event;
      if v_event is not null then
        insert into public.esh_notification_outbox
          (organization_id, event_type, recipient_user_id, finding_id, action_id, state,
           link_intents, idempotency_key, next_attempt_at, followup_event_id, escalation_level)
        select a.organization_id, 'escalation_exhausted', people.user_id, a.finding_id, a.id,
               'queued', '[]'::jsonb,
               'escalation_exhausted:' || a.id || ':v' || a.assignment_version || ':'
                 || people.user_id,
               p_now, v_event, v_target
          from (
            select act.reviewer_user_id as user_id
              from public.esh_finding_actions act
             where act.id = a.id and act.reviewer_user_id is not null
               and focus.esh_user_can_coordinate(act.reviewer_user_id, a.finding_id)
            union
            select x.user_id
              from public.esh_staff_access x
             where x.organization_id = a.organization_id
               and x.enabled
               and x.preset = 'verifier'
               and not exists (select 1 from public.esh_finding_actions act
                                where act.id = a.id and act.reviewer_user_id is not null)
               and focus.esh_user_can_coordinate(x.user_id, a.finding_id)
            limit 20
          ) people
        on conflict (idempotency_key) do nothing;
        v_event := null;
      end if;
    end if;
  end loop;

  return jsonb_build_object('owner_reminders', v_owner, 'escalations', v_escalations,
                            'review_reminders', v_reviews);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The policy is ESH's to set (§16)
-- ---------------------------------------------------------------------------

create or replace function public.esh_set_followup_policy(
  p_pre_due_days integer,
  p_remind_on_due boolean,
  p_overdue_every_days integer,
  p_level_days integer[],
  p_review_reminder_days integer
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
  before public.esh_followup_policies;
  v_levels smallint[];
  v_problems text[] := '{}';
  v_previous integer;
begin
  if not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select * into before from public.esh_followup_policies where organization_id = org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_configured');
  end if;
  if p_pre_due_days is null or p_pre_due_days not between 0 and 30 then
    v_problems := array_append(v_problems, 'pre_due_days_invalid');
  end if;
  if p_overdue_every_days is null or p_overdue_every_days not between 1 and 30 then
    v_problems := array_append(v_problems, 'overdue_every_days_invalid');
  end if;
  if p_review_reminder_days is null or p_review_reminder_days not between 1 and 30 then
    v_problems := array_append(v_problems, 'review_reminder_days_invalid');
  end if;
  if p_level_days is null or array_length(p_level_days, 1) is null
     or array_length(p_level_days, 1) > 9 then
    v_problems := array_append(v_problems, 'levels_required');
  else
    v_previous := 0;
    foreach v_previous in array p_level_days loop
      if v_previous is null or v_previous < 0 or v_previous > 365 then
        v_problems := array_append(v_problems, 'level_days_invalid');
        exit;
      end if;
    end loop;
    -- Each level comes after the one before it, or a later level could fire first.
    if exists (
      select 1
        from unnest(p_level_days) with ordinality as levels(days, position)
        join unnest(p_level_days) with ordinality as earlier(days, position)
          on earlier.position = levels.position - 1
       where levels.days <= earlier.days
    ) then
      v_problems := array_append(v_problems, 'levels_out_of_order');
    end if;
  end if;
  if cardinality(v_problems) > 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid',
                              'problems', to_jsonb(array(select distinct x from unnest(v_problems) x)));
  end if;

  v_levels := p_level_days::smallint[];
  update public.esh_followup_policies set
    version = version + 1,
    pre_due_days = p_pre_due_days,
    remind_on_due = coalesce(p_remind_on_due, true),
    overdue_every_days = p_overdue_every_days,
    level_days = v_levels,
    review_reminder_days = p_review_reminder_days,
    updated_by = actor,
    updated_at = now()
   where organization_id = org;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values
    (org, 'staff', actor, 'followup_policy_changed',
     jsonb_build_object(
       'before', jsonb_build_object('pre_due_days', before.pre_due_days,
                                    'remind_on_due', before.remind_on_due,
                                    'overdue_every_days', before.overdue_every_days,
                                    'level_days', before.level_days,
                                    'review_reminder_days', before.review_reminder_days),
       'after', jsonb_build_object('pre_due_days', p_pre_due_days,
                                   'remind_on_due', coalesce(p_remind_on_due, true),
                                   'overdue_every_days', p_overdue_every_days,
                                   'level_days', v_levels,
                                   'review_reminder_days', p_review_reminder_days),
       'version', before.version + 1));
  return jsonb_build_object('ok', true, 'version', before.version + 1);
end;
$$;

create or replace function public.esh_set_working_calendar(
  p_working_weekdays integer[],
  p_confirmed_through date,
  p_exceptions jsonb
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
  v_days smallint[];
  v_exceptions jsonb := coalesce(p_exceptions, '[]'::jsonb);
  v_row record;
  v_count integer := 0;
begin
  if not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  select array_agg(distinct day::smallint order by day::smallint)
    into v_days
    from unnest(coalesce(p_working_weekdays, '{}')) day
   where day between 1 and 7;
  if p_working_weekdays is null
     or cardinality(v_days) is distinct from cardinality(p_working_weekdays)
     or cardinality(v_days) not between 1 and 7
     or jsonb_typeof(v_exceptions) <> 'array'
     or jsonb_array_length(v_exceptions) > 500 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  for v_row in
    select value
      from jsonb_array_elements(v_exceptions)
  loop
    begin
      if jsonb_typeof(v_row.value) <> 'object'
         or (v_row.value->>'date')::date is null
         or length(btrim(coalesce(v_row.value->>'label', ''))) not between 1 and 120
         or not (v_row.value ? 'is_working_day') then
        return jsonb_build_object('ok', false, 'code', 'invalid');
      end if;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid');
    end;
  end loop;
  if (select count(distinct item->>'date') from jsonb_array_elements(v_exceptions) item)
     <> jsonb_array_length(v_exceptions) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  update public.esh_working_calendars set
    working_weekdays = v_days,
    confirmed_through = p_confirmed_through,
    updated_by = actor,
    updated_at = now()
   where organization_id = org;
  delete from public.esh_working_calendar_exceptions where organization_id = org;
  insert into public.esh_working_calendar_exceptions
    (organization_id, calendar_date, is_working_day, label, updated_by)
  select org,
         (item->>'date')::date,
         (item->>'is_working_day')::boolean,
         btrim(item->>'label'),
         actor
    from jsonb_array_elements(v_exceptions) item
  on conflict (organization_id, calendar_date) do update set
    is_working_day = excluded.is_working_day,
    label = excluded.label,
    updated_by = excluded.updated_by,
    updated_at = now();
  get diagnostics v_count = row_count;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values
    (org, 'staff', actor, 'working_calendar_changed',
     jsonb_build_object('working_weekdays', v_days,
                        'confirmed_through', p_confirmed_through,
                        'exception_count', v_count));
  return jsonb_build_object('ok', true, 'exception_count', v_count);
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. An escalation recipient's own access (§15)
--
-- A configured recipient has nothing until their level fires; from then on
-- their link reaches that one action, at that assignment, to read the context
-- and the conversation and to reply or acknowledge. Never to submit the
-- owner's work, approve time, reassign or close (§5).
-- ---------------------------------------------------------------------------

create or replace function focus.esh_escalation_covers(
  p_session_id uuid,
  p_principal_id uuid,
  p_action_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.esh_escalation_entitlements e
      join public.esh_finding_actions a on a.id = e.action_id
      join public.esh_findings f on f.id = a.finding_id
      join public.esh_guest_session_escalations s
        on s.session_id = p_session_id and s.action_id = e.action_id
     where e.action_id = p_action_id
       and e.principal_id = p_principal_id
       and e.revoked_at is null
       and e.assignment_version = a.assignment_version
       and s.assignment_version = a.assignment_version
       and a.state in ('assigned', 'in_progress', 'awaiting_verification')
       and f.status = 'open');
$$;

/* Whether an escalation link may still be spent: the level is live for this
   contact, on this assignment, and the action is still open. */
create or replace function focus.esh_escalation_live(
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
      from public.esh_escalation_entitlements e
      join public.esh_finding_actions a on a.id = e.action_id
      join public.esh_findings f on f.id = a.finding_id
     where e.action_id = p_action_id
       and e.principal_id = p_principal_id
       and e.revoked_at is null
       and (p_version is null or e.assignment_version = p_version)
       and e.assignment_version = a.assignment_version
       and a.state in ('assigned', 'in_progress', 'awaiting_verification')
       and f.status = 'open');
$$;


-- ---------------------------------------------------------------------------
-- 9. Exchanging a link, now including an escalation link (replaces v198's)
-- ---------------------------------------------------------------------------

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
    and case g.purpose
          when 'owner_inbox' then true
          when 'escalation_action' then
            focus.esh_escalation_live(g.action_id, g.principal_id, g.assignment_version)
          else focus.esh_owner_holds(g.action_id, g.principal_id, g.assignment_version)
        end;
  v_destination := case when g.purpose = 'owner_inbox' then '/respond/my-actions'
                        else '/respond/actions/' || g.action_id end;

  if p_existing_session is not null then
    v_existing := focus.esh_guest_resolve(p_existing_session, false);
  end if;

  -- This browser can already go there: spend nothing (§19).
  v_covered := v_eligible
    and v_existing.id is not null
    and v_existing.principal_id = g.principal_id
    and case g.purpose
          when 'escalation_action' then
            focus.esh_escalation_covers(v_existing.id, v_existing.principal_id, g.action_id)
          when 'owner_action' then
            v_existing.inbox_scope
            or focus.esh_guest_covers(v_existing.id, v_existing.principal_id, false, g.action_id)
          else v_existing.inbox_scope
        end;
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
    insert into public.esh_guest_session_escalations
      (session_id, action_id, level, assignment_version)
    select v_session_id, s.action_id, s.level, s.assignment_version
      from public.esh_guest_session_escalations s
     where s.session_id = v_existing.id;
  end if;
  if g.purpose = 'escalation_action' then
    insert into public.esh_guest_session_escalations
      (session_id, action_id, level, assignment_version)
    select v_session_id, g.action_id, e.level, g.assignment_version
      from public.esh_escalation_entitlements e
     where e.action_id = g.action_id
       and e.principal_id = g.principal_id
       and e.assignment_version = g.assignment_version
       and e.revoked_at is null
     order by e.level desc
     limit 1
    on conflict (session_id, action_id) do update set level = excluded.level;
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

-- ---------------------------------------------------------------------------
-- 10. Reading an action: the owner, a receipt, or an escalation (replaces
-- v200's)
-- ---------------------------------------------------------------------------

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
  v_message_ids uuid[];
  v_assignment_start timestamptz;
  v_read_only boolean := false;
  v_mode text := 'owner';
  v_level smallint;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_available', 'inbox_scope', s.inbox_scope);
  end if;
  -- v200: an action ESH accepted stays readable to its owner for 30 days, as
  -- a receipt, and nothing more (§20).
  if not focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    if focus.esh_escalation_covers(s.id, s.principal_id, p_action_id) then
      -- v201: an escalation recipient reads the context and the conversation,
      -- and may write in it; they never submit or close (§15).
      v_mode := 'escalation';
      select e.level into v_level
        from public.esh_escalation_entitlements e
        join public.esh_finding_actions x on x.id = e.action_id
       where e.action_id = p_action_id
         and e.principal_id = s.principal_id
         and e.revoked_at is null
         and e.assignment_version = x.assignment_version
       order by e.level desc
       limit 1;
    elsif focus.esh_guest_receipt(s.id, s.principal_id, s.inbox_scope, p_action_id) then
      v_read_only := true;
    else
      return jsonb_build_object('ok', false, 'code', 'not_available', 'inbox_scope', s.inbox_scope);
    end if;
  end if;

  select * into a from public.esh_finding_actions where id = p_action_id;
  select * into f from public.esh_findings where id = a.finding_id;
  select * into v_principal from public.esh_email_principals where id = s.principal_id;
  select * into v_creator from public.user_profiles where id = f.created_by;
  select name into v_department from public.departments where id = f.accountable_department_id;
  select started_at into v_assignment_start from public.esh_action_assignments
   where action_id = a.id and version = a.assignment_version;

  with recent as (
    select m.id, m.author_kind, m.author_name, m.author_email, m.author_principal_id, m.body,
           m.sent_at
      from public.esh_action_messages m
     where m.action_id = a.id
       and (p_before is null or m.sent_at < p_before)
     order by m.sent_at desc, m.id desc
     limit 51
  ),
  ranked as (
    select recent.*, row_number() over (order by sent_at desc, id desc) as rn from recent
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'author_kind', r.author_kind,
           'author_name', case when r.author_kind in ('staff', 'escalation')
                               then r.author_name else null end,
           'author_email', case when r.author_kind in ('owner', 'escalation')
                                then r.author_email else null end,
           'author_principal_id', r.author_principal_id,
           'body', r.body,
           'sent_at', r.sent_at,
           -- The owner may submit an update they sent under this assignment.
           'submittable', r.author_kind = 'owner'
                          and r.author_principal_id = s.principal_id
                          and r.sent_at >= coalesce(v_assignment_start, a.assigned_at))
           order by r.sent_at, r.id) filter (where r.rn <= 50), '[]'::jsonb),
         count(*) > 50,
         coalesce(array_agg(r.id) filter (where r.rn <= 50), '{}')
    into v_messages, v_more, v_message_ids
    from ranked r;

  return jsonb_build_object(
    'ok', true,
    'email', v_principal.display_email,
    'display_name', v_principal.display_name,
    'principal_id', v_principal.id,
    'inbox_scope', s.inbox_scope,
    'read_only', v_read_only,
    'mode', v_mode,
    'escalation_level', v_level,
    'owner_email', (select p.display_email from public.esh_email_principals p
                     where p.id = a.owner_principal_id),
    'finding_status', f.status,
    'action', jsonb_build_object(
      'accepted_at', a.accepted_at,
      'id', a.id,
      'title', a.title,
      'state', a.state,
      'priority', a.priority,
      'required_outcome', a.required_outcome,
      'evidence_instruction', a.evidence_instruction,
      'evidence_rule', a.evidence_rule,
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
    'files', focus.esh_message_files(v_message_ids),
    'has_more', v_more,
    'original_evidence', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.original_name,
                                          'type', e.content_type, 'size', e.size_bytes)
                       order by e.created_at, e.id)
        from public.esh_evidence_assets e
       where e.finding_id = f.id and e.purpose = 'original' and e.state = 'ready'), '[]'::jsonb),
    -- Files this owner uploaded and has not sent yet, so a reload keeps them.
    'drafts', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.original_name,
                                          'type', e.content_type, 'size', e.size_bytes)
                       order by e.created_at, e.id)
        from public.esh_evidence_assets e
       where e.action_id = a.id and e.uploader_principal_id = s.principal_id
         and e.message_id is null and e.state = 'ready'), '[]'::jsonb),
    'submissions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', x.id, 'version', x.version, 'state', x.state, 'message_id', x.message_id,
               'submitted_at', x.submitted_at, 'closed_at', x.closed_at,
               'files', cardinality(x.evidence_asset_ids))
             order by x.version)
        from public.esh_action_submissions x
       where x.action_id = a.id and x.assignment_version = a.assignment_version), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Writing in the conversation (replaces v199's)
-- ---------------------------------------------------------------------------

create or replace function public.esh_guest_send_message(
  p_session text,
  p_action_id uuid,
  p_body text,
  p_client_key text,
  p_asset_ids uuid[] default '{}'
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
  v_files uuid[] := coalesce(p_asset_ids, '{}');
  v_existing uuid;
  v_message_id uuid;
  v_problem text;
  v_author text;
  v_notifications integer := 0;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;

  select * into a from public.esh_finding_actions where id = p_action_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  -- v201: the owner writes, and so does an escalation recipient whose level
  -- is live — with no files, because evidence is the owner's to give (§15).
  if focus.esh_guest_covers(s.id, s.principal_id, s.inbox_scope, p_action_id) then
    v_author := 'owner';
  elsif focus.esh_escalation_covers(s.id, s.principal_id, p_action_id) then
    v_author := 'escalation';
    if cardinality(v_files) > 0 then
      return jsonb_build_object('ok', false, 'code', 'not_available');
    end if;
  else
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

  if v_body = '' and cardinality(v_files) = 0 then
    return jsonb_build_object('ok', false, 'code', 'body_required');
  end if;
  if length(v_body) > 4000 then
    return jsonb_build_object('ok', false, 'code', 'body_too_long');
  end if;
  v_problem := focus.esh_files_problem(a.id, s.principal_id, null, v_files);
  if v_problem is not null then
    return jsonb_build_object('ok', false, 'code', v_problem);
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
    (a.organization_id, a.id, v_author, s.principal_id, v_principal.display_email,
     v_principal.display_name, v_body, p_client_key)
  returning id into v_message_id;

  if cardinality(v_files) > 0 then
    update public.esh_evidence_assets set message_id = v_message_id where id = any (v_files);
  end if;

  -- Only the owner starting work moves the action on; a supervisor's
  -- comment does not (§6).
  if a.state = 'assigned' and v_author = 'owner' then
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
    (a.organization_id, 'principal', s.principal_id,
     case when v_author = 'owner' then 'owner_message' else 'escalation_message' end,
     a.finding_id, a.id,
     jsonb_build_object('message_id', v_message_id, 'files', cardinality(v_files)));

  v_notifications := focus.esh_notify_action_staff(
    a.id,
    case when v_author = 'owner' then 'owner_reply' else 'escalation_reply' end,
    v_message_id);

  return jsonb_build_object(
    'ok', true, 'message_id', v_message_id,
    'notifications', v_notifications,
    'state', case when a.state = 'assigned' and v_author = 'owner'
                  then 'in_progress' else a.state end);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Acknowledging an escalation (§15)
-- ---------------------------------------------------------------------------

/*
 * Acknowledging says the message was received and understood. It is not
 * completing the work, approving anything or taking it over (§5): the action
 * does not move, and the owner still owes what they owed.
 */
create or replace function public.esh_guest_acknowledge(p_session text, p_action_id uuid)
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
  v_level smallint;
begin
  s := focus.esh_guest_resolve(p_session, true);
  if s.id is null then
    return jsonb_build_object('ok', false, 'code', 'no_session');
  end if;
  if p_action_id is null or not focus.esh_escalation_covers(s.id, s.principal_id, p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select * into a from public.esh_finding_actions where id = p_action_id;
  select * into v_principal from public.esh_email_principals where id = s.principal_id;

  update public.esh_escalation_entitlements set acknowledged_at = now()
   where action_id = a.id
     and principal_id = s.principal_id
     and assignment_version = a.assignment_version
     and revoked_at is null
     and acknowledged_at is null
  returning level into v_level;
  if v_level is null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into public.esh_action_messages
    (organization_id, action_id, author_kind, author_principal_id, author_email, author_name,
     body, client_key, kind)
  values
    (a.organization_id, a.id, 'escalation', s.principal_id, v_principal.display_email,
     v_principal.display_name,
     'Escalation level ' || v_level || ' acknowledged by ' || v_principal.display_email || '.',
     'ack:' || a.id || ':' || s.principal_id || ':v' || a.assignment_version, 'event');
  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_principal_id, event_type, finding_id, action_id, detail)
  values
    (a.organization_id, 'principal', s.principal_id, 'escalation_acknowledged', a.finding_id, a.id,
     jsonb_build_object('level', v_level));
  return jsonb_build_object('ok', true, 'level', v_level);
end;
$$;


-- ---------------------------------------------------------------------------
-- 13. Dispatch, re-checking each kind at the moment of sending (replaces
-- v200's)
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

-- ---------------------------------------------------------------------------
-- 14. Provider delivery evidence (§17, FM38-FM39)
-- ---------------------------------------------------------------------------

create or replace function public.esh_record_delivery_event(
  p_provider_event_id text,
  p_provider_message_id text,
  p_event_type text,
  p_occurred_at timestamptz,
  p_detail text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  o public.esh_notification_outbox;
  v_event_id uuid;
begin
  if p_provider_event_id is null or length(btrim(p_provider_event_id)) not between 4 and 200
     or p_provider_message_id is null or length(btrim(p_provider_message_id)) not between 1 and 200
     or p_event_type not in ('delivered', 'bounced', 'failed')
     or p_occurred_at is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  select * into o
    from public.esh_notification_outbox
   where provider_message_id = p_provider_message_id
   order by sent_at desc nulls last
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'message_not_found');
  end if;

  insert into public.esh_delivery_events
    (organization_id, outbox_id, provider_event_id, provider_message_id,
     event_type, detail, occurred_at)
  values
    (o.organization_id, o.id, left(btrim(p_provider_event_id), 200),
     left(btrim(p_provider_message_id), 200), p_event_type,
     left(nullif(btrim(coalesce(p_detail, '')), ''), 500), p_occurred_at)
  on conflict (provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('ok', true, 'duplicate', true, 'state', o.state);
  end if;

  if p_event_type = 'delivered' and o.state = 'provider_accepted' then
    update public.esh_notification_outbox set
      state = 'delivered', state_reason = null, updated_at = now()
     where id = o.id;
  elsif p_event_type in ('bounced', 'failed')
        and o.state in ('provider_accepted', 'delivered') then
    update public.esh_notification_outbox set
      state = 'bounced',
      state_reason = p_event_type,
      last_error = left(coalesce(p_detail, p_event_type), 500),
      next_attempt_at = null,
      updated_at = now()
     where id = o.id;
  end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, event_type, finding_id, action_id,
     subject_principal_id, detail)
  values
    (o.organization_id, 'system', 'notification_' || p_event_type,
     o.finding_id, o.action_id, o.recipient_principal_id,
     jsonb_build_object('outbox_id', o.id, 'provider_event_id', p_provider_event_id));

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'state', (select state from public.esh_notification_outbox where id = o.id));
end;
$$;

-- ---------------------------------------------------------------------------
-- 15. Grants
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_escalation_covers(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function focus.esh_escalation_live(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function focus.esh_stamp_policy_version() from public, anon, authenticated;
revoke all on function focus.esh_notify_action_staff(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function focus.esh_is_working_day(uuid, date) from public, anon, authenticated;
revoke all on function focus.esh_after_working_days(uuid, date, integer)
  from public, anon, authenticated;
revoke all on function public.esh_run_followups(timestamptz) from public, anon, authenticated;
revoke all on function public.esh_guest_acknowledge(text, uuid) from public, anon, authenticated;
revoke all on function public.esh_guest_exchange(text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.esh_guest_action(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.esh_guest_send_message(text, uuid, text, text, uuid[])
  from public, anon, authenticated;
revoke all on function public.esh_dispatch_claim(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.esh_record_delivery_event(text, text, text, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.esh_set_followup_policy(integer, boolean, integer, integer[], integer)
  from public, anon;
revoke all on function public.esh_set_working_calendar(integer[], date, jsonb)
  from public, anon;

grant execute on function focus.esh_escalation_covers(uuid, uuid, uuid) to service_role;
grant execute on function focus.esh_escalation_live(uuid, uuid, integer) to service_role;
grant execute on function focus.esh_notify_action_staff(uuid, text, uuid) to service_role;
grant execute on function public.esh_run_followups(timestamptz) to service_role;
grant execute on function public.esh_guest_acknowledge(text, uuid) to service_role;
grant execute on function public.esh_guest_exchange(text, text, text, text, boolean) to service_role;
grant execute on function public.esh_guest_action(text, uuid, timestamptz) to service_role;
grant execute on function public.esh_guest_send_message(text, uuid, text, text, uuid[]) to service_role;
grant execute on function public.esh_dispatch_claim(uuid, jsonb) to service_role;
grant execute on function public.esh_record_delivery_event(text, text, text, timestamptz, text)
  to service_role;
grant execute on function public.esh_set_followup_policy(integer, boolean, integer, integer[], integer)
  to authenticated;
grant execute on function public.esh_set_working_calendar(integer[], date, jsonb)
  to authenticated;
