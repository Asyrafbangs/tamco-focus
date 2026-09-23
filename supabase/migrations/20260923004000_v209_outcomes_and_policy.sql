-- ============================================================================
-- v209 ESH Finding Management: outcomes that are not closures, and a policy
-- that can differ by how bad the finding is.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md §6, §16,
-- §21.
--
-- Two things the specification asks for that nothing had built.
--
-- First, a finding recorded in error could only be closed — as though somebody
-- had corrected it and ESH had verified the correction. §6 gives three
-- administrative outcomes instead: cancelled, duplicate and withdrawn, each
-- with a reason, each preserving the record rather than deleting it, and a
-- duplicate keeping a link to the finding it repeats.
--
-- Second, §16 is explicit that follow-up timing may differ by risk and
-- priority and that one hardcoded rule must not stand in for safety policy.
-- Until now a critical finding and a housekeeping observation were chased on
-- exactly the same schedule.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. An outcome that is not a closure (§6)
-- ---------------------------------------------------------------------------

alter table public.esh_findings
  add column resolved_outcome text
    check (resolved_outcome in ('cancelled', 'duplicate', 'withdrawn')),
  add column resolved_at timestamptz,
  add column resolved_by uuid references public.user_profiles (id),
  add column duplicate_of_finding_id uuid,
  add constraint esh_findings_resolved_check
    check ((resolved_outcome is null) = (resolved_at is null)),
  -- A duplicate says what it duplicates; the others do not pretend to.
  add constraint esh_findings_duplicate_check
    check (duplicate_of_finding_id is null or resolved_outcome = 'duplicate'),
  add constraint esh_findings_duplicate_self_check
    check (duplicate_of_finding_id is distinct from id),
  add foreign key (organization_id, duplicate_of_finding_id)
    references public.esh_findings (organization_id, id);

comment on column public.esh_findings.duplicate_of_finding_id is
  'The finding this one repeats. The record stays; nothing is ever deleted to make counts agree (§6).';

/**
 * Cancel, withdraw, or mark a finding as a duplicate.
 *
 * None of these is a closure: a closure means ESH verified a correction, and
 * saying so about a finding that was recorded in error is a false record. The
 * finding keeps its reference, its conversation and its history; what changes
 * is that it stops being open work — its actions are cancelled, its owners'
 * links stop working, and anything still queued to send is cancelled rather
 * than delivered to somebody who no longer owes anything.
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
begin
  if actor is null or not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if coalesce(p_outcome, '') not in ('cancelled', 'duplicate', 'withdrawn') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
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

  -- Work that was outstanding stops being outstanding. An accepted action
  -- keeps its acceptance: it was done, whatever became of the finding.
  select coalesce(array_agg(id), '{}') into v_actions
    from public.esh_finding_actions
   where finding_id = f.id and state in ('assigned', 'in_progress', 'awaiting_verification');

  update public.esh_finding_actions set
    state = 'cancelled',
    updated_at = now(),
    row_version = row_version + 1
   where id = any(v_actions);

  update public.esh_findings set
    status = p_outcome,
    status_reason = v_reason,
    resolved_outcome = p_outcome,
    resolved_at = now(),
    resolved_by = actor,
    duplicate_of_finding_id = case when p_outcome = 'duplicate' then p_duplicate_of end,
    updated_at = now(),
    row_version = row_version + 1
   where id = f.id;

  -- Links to work nobody owes any more stop working, and what was queued for
  -- those owners is cancelled rather than delivered.
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
    state_reason = 'finding_' || p_outcome,
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

revoke all on function public.esh_resolve_finding(uuid, text, text, uuid) from public, anon;
grant execute on function public.esh_resolve_finding(uuid, text, text, uuid) to authenticated;
-- ---------------------------------------------------------------------------
-- 2. A policy that can differ by risk and by priority (§16, §21)
--
-- The organisation's policy stays as it is and remains the answer for most
-- work. A rule may be added for a risk level or for an action priority, and
-- the most specific one that matches an action wins: priority first, because
-- it is the judgement ESH made about this action, then risk, then the base.
-- ---------------------------------------------------------------------------

create table public.esh_followup_policy_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.esh_followup_policies (organization_id)
    on delete cascade,
  applies_to text not null check (applies_to in ('risk', 'priority')),
  applies_value text not null,
  pre_due_days smallint not null check (pre_due_days between 0 and 30),
  remind_on_due boolean not null default true,
  overdue_every_days smallint not null check (overdue_every_days between 1 and 30),
  level_days smallint[] not null,
  review_reminder_days smallint not null check (review_reminder_days between 1 and 30),
  updated_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  unique (organization_id, applies_to, applies_value),
  check ((applies_to = 'risk' and applies_value in ('not_assessed', 'low', 'medium', 'high', 'critical'))
         or (applies_to = 'priority' and applies_value in ('urgent', 'high', 'normal'))),
  check (array_length(level_days, 1) between 1 and 9),
  check (array_position(level_days, null) is null)
);

-- Quiet hours and the catch-up rule belong to the policy (§21). Coalescing was
-- always what the scheduler did; saying so here makes it a decision somebody
-- took rather than one nobody can see.
alter table public.esh_followup_policies
  add column quiet_from time,
  add column quiet_to time,
  add column catch_up text not null default 'coalesce'
    check (catch_up in ('coalesce', 'every_missed')),
  add constraint esh_followup_quiet_hours_check
    check ((quiet_from is null) = (quiet_to is null));

comment on column public.esh_followup_policies.quiet_from is
  'Start of the hours when routine mail waits until morning. Escalation is not held (§16).';

alter table public.esh_followup_policy_rules enable row level security;

create policy esh_followup_policy_rules_select on public.esh_followup_policy_rules
  as permissive for select to authenticated
  using ((select focus.esh_enabled())
         and organization_id = (select focus.esh_organization_id()));

revoke all on public.esh_followup_policy_rules from anon, authenticated;
grant select on public.esh_followup_policy_rules to authenticated;

/**
 * The rule that applies to one action: priority, then risk, then the base.
 *
 * Returned as the policy row itself so the scheduler reads one shape whatever
 * decided it, with `rule_id` saying which rule answered — null for the base.
 */
create or replace function focus.esh_followup_rule(p_action_id uuid)
returns table (
  organization_id uuid,
  version integer,
  pre_due_days smallint,
  remind_on_due boolean,
  overdue_every_days smallint,
  level_days smallint[],
  review_reminder_days smallint,
  quiet_from time,
  quiet_to time,
  catch_up text,
  rule_id uuid,
  rule_source text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with action as (
    select a.organization_id, a.priority, f.risk_level
      from public.esh_finding_actions a
      join public.esh_findings f on f.id = a.finding_id
     where a.id = p_action_id
  ),
  base as (
    select p.* from public.esh_followup_policies p
     join action on action.organization_id = p.organization_id
  ),
  chosen as (
    select r.*, case when r.applies_to = 'priority' then 0 else 1 end as rank
      from public.esh_followup_policy_rules r
      join action on action.organization_id = r.organization_id
     where (r.applies_to = 'priority' and r.applies_value = action.priority)
        or (r.applies_to = 'risk' and r.applies_value = action.risk_level)
     order by rank
     limit 1
  )
  select base.organization_id,
         base.version,
         coalesce(chosen.pre_due_days, base.pre_due_days),
         coalesce(chosen.remind_on_due, base.remind_on_due),
         coalesce(chosen.overdue_every_days, base.overdue_every_days),
         coalesce(chosen.level_days, base.level_days),
         coalesce(chosen.review_reminder_days, base.review_reminder_days),
         base.quiet_from,
         base.quiet_to,
         base.catch_up,
         chosen.id,
         coalesce(chosen.applies_to, 'organisation')
    from base
    left join chosen on true;
$$;

/** ESH writes or removes a rule for one risk level or one priority. */
create or replace function public.esh_set_followup_rule(
  p_applies_to text,
  p_applies_value text,
  p_pre_due_days integer,
  p_remind_on_due boolean,
  p_overdue_every_days integer,
  p_level_days integer[],
  p_review_reminder_days integer,
  p_remove boolean default false
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
  v_levels smallint[];
begin
  if actor is null or not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if coalesce(p_applies_to, '') not in ('risk', 'priority')
     or (p_applies_to = 'risk'
         and coalesce(p_applies_value, '')
             not in ('not_assessed', 'low', 'medium', 'high', 'critical'))
     or (p_applies_to = 'priority'
         and coalesce(p_applies_value, '') not in ('urgent', 'high', 'normal')) then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if not exists (select 1 from public.esh_followup_policies where organization_id = org) then
    return jsonb_build_object('ok', false, 'code', 'not_configured');
  end if;

  if coalesce(p_remove, false) then
    delete from public.esh_followup_policy_rules
     where organization_id = org and applies_to = p_applies_to and applies_value = p_applies_value;
    insert into public.esh_audit_events
      (organization_id, actor_kind, actor_user_id, event_type, detail)
    values (org, 'staff', actor, 'followup_rule_removed',
            jsonb_build_object('applies_to', p_applies_to, 'value', p_applies_value));
    return jsonb_build_object('ok', true, 'removed', true);
  end if;

  if p_pre_due_days is null or p_pre_due_days not between 0 and 30
     or p_overdue_every_days is null or p_overdue_every_days not between 1 and 30
     or p_review_reminder_days is null or p_review_reminder_days not between 1 and 30
     or p_level_days is null or array_length(p_level_days, 1) is null
     or array_length(p_level_days, 1) > 9 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  select array_agg(value order by value) into v_levels
    from (select distinct unnest(p_level_days) as value) levels
   where value between 1 and 365;
  if v_levels is null or array_length(v_levels, 1) <> array_length(p_level_days, 1) then
    return jsonb_build_object('ok', false, 'code', 'levels_invalid');
  end if;

  insert into public.esh_followup_policy_rules
    (organization_id, applies_to, applies_value, pre_due_days, remind_on_due,
     overdue_every_days, level_days, review_reminder_days, updated_by)
  values
    (org, p_applies_to, p_applies_value, p_pre_due_days, coalesce(p_remind_on_due, true),
     p_overdue_every_days, v_levels, p_review_reminder_days, actor)
  on conflict (organization_id, applies_to, applies_value) do update
    set pre_due_days = excluded.pre_due_days,
        remind_on_due = excluded.remind_on_due,
        overdue_every_days = excluded.overdue_every_days,
        level_days = excluded.level_days,
        review_reminder_days = excluded.review_reminder_days,
        updated_by = excluded.updated_by,
        updated_at = now();

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'followup_rule_saved',
          jsonb_build_object('applies_to', p_applies_to, 'value', p_applies_value,
                             'level_days', to_jsonb(v_levels)));
  return jsonb_build_object('ok', true);
end;
$$;

/** Quiet hours and the catch-up rule, set with the rest of the policy. */
create or replace function public.esh_set_followup_quiet_hours(
  p_quiet_from time,
  p_quiet_to time,
  p_catch_up text
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
begin
  if actor is null or not focus.esh_can('verify') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if (p_quiet_from is null) <> (p_quiet_to is null) then
    return jsonb_build_object('ok', false, 'code', 'quiet_hours_incomplete');
  end if;
  if coalesce(p_catch_up, '') not in ('coalesce', 'every_missed') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  update public.esh_followup_policies set
    quiet_from = p_quiet_from,
    quiet_to = p_quiet_to,
    catch_up = p_catch_up,
    updated_by = actor,
    updated_at = now()
   where organization_id = org;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_configured'); end if;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, detail)
  values (org, 'staff', actor, 'followup_quiet_hours_saved',
          jsonb_build_object('quiet_from', p_quiet_from, 'quiet_to', p_quiet_to,
                             'catch_up', p_catch_up));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function focus.esh_followup_rule(uuid) from public, anon, authenticated;
revoke all on function
  public.esh_set_followup_rule(text, text, integer, boolean, integer, integer[], integer, boolean)
  from public, anon;
revoke all on function public.esh_set_followup_quiet_hours(time, time, text) from public, anon;

grant execute on function focus.esh_followup_rule(uuid) to service_role;
grant execute on function
  public.esh_set_followup_rule(text, text, integer, boolean, integer, integer[], integer, boolean)
  to authenticated;
grant execute on function public.esh_set_followup_quiet_hours(time, time, text) to authenticated;

/**
 * When a routine notice may go, given the organisation's quiet hours.
 *
 * Returns the moment itself when quiet hours are unset or the moment is
 * outside them, and the end of the quiet window otherwise. The window may
 * cross midnight, which is the usual way of writing "not overnight".
 */
create or replace function focus.esh_after_quiet_hours(p_organization uuid, p_at timestamptz)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_zone text;
  v_from time;
  v_to time;
  v_local timestamp;
  v_clock time;
  v_inside boolean;
begin
  select coalesce(org.timezone, 'Asia/Kuala_Lumpur'), policy.quiet_from, policy.quiet_to
    into v_zone, v_from, v_to
    from public.organizations org
    left join public.esh_followup_policies policy on policy.organization_id = org.id
   where org.id = p_organization;
  if v_from is null or v_to is null or v_from = v_to then
    return p_at;
  end if;

  v_local := p_at at time zone v_zone;
  v_clock := v_local::time;
  v_inside := case
                when v_from < v_to then v_clock >= v_from and v_clock < v_to
                -- Crossing midnight: 21:00 to 07:00 is quiet at 23:00 and 02:00.
                else v_clock >= v_from or v_clock < v_to
              end;
  if not v_inside then
    return p_at;
  end if;

  return (case
            when v_clock < v_to then (v_local::date + v_to)
            else ((v_local::date + interval '1 day')::date + v_to)
          end) at time zone v_zone;
end;
$$;

revoke all on function focus.esh_after_quiet_hours(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function focus.esh_after_quiet_hours(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Where the rule and the policy reach the work
--
-- All three routines are their latest definitions, extended rather than
-- rewritten. The scheduler still reads the snapshot on the ownership interval;
-- what changed is what gets written there.
-- ---------------------------------------------------------------------------

create or replace function focus.esh_stamp_policy_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.policy_version is null then
    -- v209: the organisation's policy, unless a rule for this action's
    -- priority or its finding's risk says otherwise (§16). Resolved here, once,
    -- so a later policy change never rewrites what this owner was promised.
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
      from focus.esh_followup_rule(new.action_id);
    if new.policy_version is null then
      select version, pre_due_days, remind_on_due, overdue_every_days, level_days,
             review_reminder_days
        into new.policy_version, new.followup_pre_due_days, new.followup_remind_on_due,
             new.followup_overdue_every_days, new.followup_level_days,
             new.followup_review_reminder_days
        from public.esh_followup_policies
       where organization_id = new.organization_id;
    end if;
  end if;
  return new;
end;
$$;

create or replace function focus.esh_tell_owner(
  p_action_id uuid,
  p_principal_id uuid,
  p_event text,
  p_intents jsonb,
  p_key text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  a public.esh_finding_actions;
  v_state text;
  v_when timestamptz;
begin
  select * into a from public.esh_finding_actions where id = p_action_id;
  -- A notice with links never goes ahead of a held assignment email (v198).
  v_state := case
               when not focus.esh_contact_usable(p_principal_id) then 'held_rollout'
               when p_intents <> '[]'::jsonb and p_event <> 'owner_assignment' and exists (
                 select 1 from public.esh_notification_outbox held
                  where held.action_id = p_action_id
                    and held.recipient_principal_id = p_principal_id
                    and held.event_type = 'owner_assignment'
                    and held.state = 'held_rollout') then 'held_rollout'
               else 'queued'
             end;
  -- v209: a routine reminder raised inside quiet hours waits until they end.
  -- An assignment, a decision or anything somebody is waiting on does not:
  -- quiet hours are about not pestering people at night, not about holding up
  -- news they need (§16).
  v_when := case
              when v_state <> 'queued' then null
              when p_event = 'owner_reminder'
                then focus.esh_after_quiet_hours(a.organization_id, now())
              else now()
            end;
  insert into public.esh_notification_outbox
    (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
     link_intents, idempotency_key, next_attempt_at)
  values
    (a.organization_id, p_event, p_principal_id, a.finding_id, a.id, v_state, p_intents, p_key,
     v_when)
  on conflict (idempotency_key) do nothing;
  return v_state;
end;
$$;

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
  v_catch_up text;
  v_send_from integer;
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
    -- v209: which stages actually go. Coalescing sends the highest level now
    -- due and records the ones it passed as skipped, which is the default and
    -- the one that does not produce a storm after downtime. An organisation
    -- that has asked for every missed stage gets one message per stage, each
    -- with its own entitlement (§16).
    v_catch_up := (select catch_up from public.esh_followup_policies
                    where organization_id = a.organization_id);
    v_send_from := case when v_catch_up = 'every_missed' then 1 else v_target end;

    if v_catch_up <> 'every_missed' then
      for v_level in 1 .. v_target - 1 loop
        insert into public.esh_followup_events
          (organization_id, action_id, kind, stage, trigger_key, policy_version,
           assignment_version, due_at_snapshot, state, detail)
        values
          (a.organization_id, a.id, 'escalation', v_level,
           'level-' || v_level || '-v' || a.assignment_version, a.policy_version,
           a.assignment_version, a.due_at, 'suppressed',
           jsonb_build_object('reason', 'coalesced', 'sent_level', v_target))
        on conflict (action_id, kind, trigger_key) do nothing;
      end loop;
    end if;

    for v_level in v_send_from .. v_target loop
      v_event := null;
      insert into public.esh_followup_events
        (organization_id, action_id, kind, stage, trigger_key, policy_version, assignment_version,
         due_at_snapshot, detail)
      values
        (a.organization_id, a.id, 'escalation', v_level,
         'level-' || v_level || '-v' || a.assignment_version, a.policy_version,
         a.assignment_version, a.due_at,
         jsonb_build_object('days_overdue', v_overdue, 'catch_up', v_catch_up))
      on conflict (action_id, kind, trigger_key) do nothing
      returning id into v_event;
      if v_event is null then
        continue;
      end if;

      for r in
        select rec.principal_id
          from public.esh_action_escalation_recipients rec
         where rec.action_id = a.id and rec.level = v_level and rec.removed_at is null
      loop
        insert into public.esh_escalation_entitlements
          (organization_id, action_id, level, principal_id, assignment_version, activated_event_id)
        values
          (a.organization_id, a.id, v_level, r.principal_id, a.assignment_version, v_event)
        on conflict (action_id, level, principal_id, assignment_version) do nothing;
        insert into public.esh_notification_outbox
          (organization_id, event_type, recipient_principal_id, finding_id, action_id, state,
           link_intents, idempotency_key, next_attempt_at, followup_event_id, escalation_level)
        values
          (a.organization_id, 'escalation', r.principal_id, a.finding_id, a.id,
           case when focus.esh_contact_usable(r.principal_id) then 'queued' else 'held_rollout' end,
           '["escalation_action"]'::jsonb,
           'escalation:' || a.id || ':' || v_level || ':' || r.principal_id || ':v'
             || a.assignment_version,
           case when focus.esh_contact_usable(r.principal_id) then p_now end,
           v_event, v_level)
        on conflict (idempotency_key) do nothing;
        v_escalations := v_escalations + 1;
      end loop;
    end loop;
    v_event := null;

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
