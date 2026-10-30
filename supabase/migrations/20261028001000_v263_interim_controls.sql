-- ============================================================================
-- v263 — what protects people while the finding is still open
--
-- The record could say who owns a fix, when it is due and who gets told when
-- it is late. It could not say whether anybody is safe in the meantime.
--
-- "Install a replacement machine guard" is six weeks of procurement. For those
-- six weeks the hazard is still there, and the only honest question — what
-- stops somebody reaching into it today — had nowhere to live. It was being
-- answered in conversation messages, if at all, where nothing can count it,
-- nothing can chase it and an auditor cannot find it.
--
-- Four facts, on the finding rather than the action, because they are about
-- the hazard and survive a reassignment:
--
--   * what was done immediately;
--   * what controls the hazard until the permanent fix, and who is responsible
--     for keeping it in place;
--   * who checked that the control is actually working, and when;
--   * or an explicit decision that none is needed, with a reason.
--
-- The last one matters as much as the rest. Without it, "no interim control"
-- means both "nobody has considered it" and "it was considered and is not
-- needed", and a count that mixes those two is not worth reading.
--
-- The rule with teeth: **changing the control clears the verification.** A
-- control nobody has checked since it changed is not a verified control, and
-- quietly keeping the old tick would be the system telling a comfortable lie.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The facts
-- ---------------------------------------------------------------------------

alter table public.esh_findings
  add column immediate_containment text,
  add column interim_control text,
  -- Free text, not a principal: the person holding a barrier in place is often
  -- a shift supervisor who owns no action and is in no directory.
  add column interim_owner text,
  add column interim_verified_by uuid references public.user_profiles (id),
  add column interim_verified_at timestamptz,
  add column interim_not_required_reason text;

alter table public.esh_findings
  -- A decision either way, never both.
  add constraint esh_findings_interim_exclusive
    check (interim_control is null or interim_not_required_reason is null),
  -- Nothing is verified until there is something to verify.
  add constraint esh_findings_interim_verified_has_control
    check (interim_verified_at is null or interim_control is not null),
  add constraint esh_findings_interim_verified_pair
    check ((interim_verified_at is null) = (interim_verified_by is null));

comment on column public.esh_findings.interim_control is
  'What controls the hazard until the permanent corrective action lands. '
  'Cleared of its verification whenever the text changes (v263).';

-- Reading the open, significant, unprotected ones is the whole point, so it is
-- worth an index rather than a sequential scan of every finding ever raised.
create index esh_findings_protection_idx
  on public.esh_findings (organization_id, status, risk_level)
  where status in ('new', 'open');

-- ---------------------------------------------------------------------------
-- 2. Recording it
-- ---------------------------------------------------------------------------

/*
 * Set, change or clear the interim position on a finding.
 *
 * Takes the whole position at once rather than a field at a time, because the
 * fields are not independent: deciding none is needed must remove any control
 * that was recorded, and recording a control must remove that decision.
 */
create or replace function public.esh_set_interim_control(p_finding_id uuid, p_payload jsonb)
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
  v_containment text := nullif(btrim(coalesce(p_payload->>'immediate_containment', '')), '');
  v_control text := nullif(btrim(coalesce(p_payload->>'interim_control', '')), '');
  v_owner text := nullif(btrim(coalesce(p_payload->>'interim_owner', '')), '');
  v_none text := nullif(btrim(coalesce(p_payload->>'not_required_reason', '')), '');
  v_changed boolean;
begin
  if actor is null or not focus.esh_can('coordinate') then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;
  if v_control is not null and v_none is not null then
    return jsonb_build_object('ok', false, 'code', 'both_given');
  end if;
  if v_control is not null and v_owner is null then
    return jsonb_build_object('ok', false, 'code', 'owner_required');
  end if;
  if v_none is not null and length(v_none) < 3 then
    return jsonb_build_object('ok', false, 'code', 'reason_required');
  end if;
  if coalesce(length(v_control), 0) > 2000
     or coalesce(length(v_containment), 0) > 2000
     or coalesce(length(v_owner), 0) > 200
     or coalesce(length(v_none), 0) > 500 then
    return jsonb_build_object('ok', false, 'code', 'too_long');
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

  /*
   * A control nobody has checked since it changed is not a verified control.
   * Tightening the wording of an existing barrier is still a change to what
   * somebody is relying on, so it is treated as one.
   */
  v_changed := f.interim_control is distinct from v_control;

  update public.esh_findings set
    immediate_containment = v_containment,
    interim_control = v_control,
    interim_owner = case when v_control is null then null else v_owner end,
    interim_not_required_reason = v_none,
    interim_verified_by = case when v_changed then null else f.interim_verified_by end,
    interim_verified_at = case when v_changed then null else f.interim_verified_at end,
    updated_at = now(),
    row_version = row_version + 1
   where id = f.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'interim_control_set', f.id,
          jsonb_build_object(
            'from', jsonb_build_object('control', f.interim_control,
                                       'owner', f.interim_owner,
                                       'not_required_reason', f.interim_not_required_reason,
                                       'verified_at', f.interim_verified_at),
            'to', jsonb_build_object('control', v_control,
                                     'owner', v_owner,
                                     'not_required_reason', v_none),
            'verification_cleared', v_changed and f.interim_verified_at is not null));

  return jsonb_build_object('ok', true,
                            'verification_cleared',
                            v_changed and f.interim_verified_at is not null);
end;
$$;

/*
 * Record that somebody has been and checked the interim control is working.
 *
 * Separate from recording it on purpose. Writing down a barrier and confirming
 * the barrier exists are different claims, often made by different people on
 * different days, and only the second one is evidence that anybody is safe.
 */
create or replace function public.esh_verify_interim_control(p_finding_id uuid)
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
  if f.interim_control is null then
    return jsonb_build_object('ok', false, 'code', 'no_control');
  end if;

  update public.esh_findings set
    interim_verified_by = actor,
    interim_verified_at = now(),
    updated_at = now(),
    row_version = row_version + 1
   where id = f.id;

  insert into public.esh_audit_events
    (organization_id, actor_kind, actor_user_id, event_type, finding_id, detail)
  values (org, 'staff', actor, 'interim_control_verified', f.id,
          jsonb_build_object('control', f.interim_control, 'owner', f.interim_owner));

  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Counting it
--
-- Two numbers a safety manager should be able to read in one glance, and
-- neither is a closure percentage:
--
--   unprotected — open, significant, and nobody has recorded a verified
--                 control or decided one is not needed;
--   unassessed  — open and nobody has said how bad it is, so it cannot even
--                 be counted as significant or not.
--
-- `unassessed` is the triage queue. It exists because the organisation's
-- assessment method is not configured yet, and a finding sitting at
-- `not_assessed` is invisible to any risk-based count including this one.
-- ---------------------------------------------------------------------------

create or replace function focus.esh_protection(p_open uuid[])
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'significant', count(*) filter (where f.risk_level in ('high', 'critical')),
    'unprotected', count(*) filter (
      where f.risk_level in ('high', 'critical')
        and f.interim_verified_at is null
        and f.interim_not_required_reason is null),
    'unverified', count(*) filter (
      where f.risk_level in ('high', 'critical')
        and f.interim_control is not null
        and f.interim_verified_at is null),
    'unassessed', count(*) filter (where f.risk_level = 'not_assessed'))
    from public.esh_findings f
   where f.id = any (p_open);
$$;

grant execute on function public.esh_set_interim_control(uuid, jsonb) to authenticated;
grant execute on function public.esh_verify_interim_control(uuid) to authenticated;

create or replace function public.esh_dashboard(p_months integer default 6)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid := focus.esh_organization_id();
  v_months integer := least(greatest(coalesce(p_months, 6), 1), 24);
  v_open uuid[];
  v_result jsonb;
begin
  if org is null or not focus.esh_enabled() then
    return jsonb_build_object('ok', false, 'code', 'not_permitted');
  end if;

  select coalesce(array_agg(f.id), '{}') into v_open
    from public.esh_findings f
   where f.organization_id = org
     and f.status in ('new', 'open')
     and (focus.esh_scope_all()
          or f.accountable_department_id = any (focus.esh_visible_department_ids()));

  select jsonb_build_object(
    'ok', true,
    'as_of', now(),
    'open_findings', cardinality(v_open),
    'protection', focus.esh_protection(v_open),
    'open_by_risk', (
      select coalesce(jsonb_object_agg(risk_level, n), '{}'::jsonb)
        from (select f.risk_level, count(*) as n
                from public.esh_findings f
               where f.id = any (v_open)
               group by f.risk_level) risks),
    'open_by_age', focus.esh_age_buckets(v_open),
    'oldest_open_days', (
      select coalesce(max(extract(day from (now() - f.created_at))::integer), 0)
        from public.esh_findings f where f.id = any (v_open)),
    'overdue_actions', (
      select count(*) from public.esh_finding_actions a
        join public.esh_findings f on f.id = a.finding_id
       where f.id = any (v_open)
         and a.state in ('assigned', 'in_progress')
         and a.due_at < now()),
    'awaiting_verification', (
      select count(*) from public.esh_finding_actions a
        join public.esh_findings f on f.id = a.finding_id
       where f.id = any (v_open) and a.state = 'awaiting_verification'),
    'closure', focus.esh_closure_facts(org, v_months),
    'monthly', focus.esh_monthly_series(org, v_months),
    'by_department', (
      select coalesce(jsonb_agg(row_to_json(d) order by d.name), '[]'::jsonb)
        from (select coalesce(dep.name, 'Unassigned') as name,
                     count(*) as open_findings,
                     count(*) filter (where exists (
                       select 1 from public.esh_finding_actions a
                        where a.finding_id = f.id
                          and a.state in ('assigned', 'in_progress')
                          and a.due_at < now())) as overdue,
                     count(*) filter (
                       where f.risk_level in ('high', 'critical')
                         and f.interim_verified_at is null
                         and f.interim_not_required_reason is null) as unprotected
                from public.esh_findings f
                left join public.departments dep on dep.id = f.accountable_department_id
               where f.id = any (v_open)
               group by coalesce(dep.name, 'Unassigned')) d))
    into v_result;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The owner is told what is protecting them
--
-- The person most entitled to know that a temporary gate is fitted, and who is
-- keeping it there, is the one standing next to the machine.
--
-- Copied forward whole from v212, which is where this function was last
-- defined -- not v201, where the same name appears three times earlier in the
-- file list. Taking the older one silently dropped the handover request from
-- the thread, which two of v211's and v212's tests caught at once.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.esh_guest_action(p_session text, p_action_id uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
           m.sent_at, m.proposed_due_date, m.proposed_owner_email
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
                          and r.sent_at >= coalesce(v_assignment_start, a.assigned_at),
           -- v211: a date the owner asked for. It is part of what they said,
           -- not a change to anything; only ESH moves a deadline.
           'proposed_due_date', r.proposed_due_date,
           -- v212: and who they say should really hold it. Naming somebody
           -- is a request; only ESH hands work over.
           'proposed_owner_email', r.proposed_owner_email)
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
      'reported_on', f.reported_on,
      -- v263 - what is protecting them while they work on the permanent fix.
      'interim_control', f.interim_control,
      'interim_owner', f.interim_owner,
      'interim_verified_at', f.interim_verified_at),
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
$function$;
