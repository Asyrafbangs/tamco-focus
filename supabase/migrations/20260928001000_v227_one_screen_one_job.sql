-- ============================================================================
-- v227 — One screen, one job
--
-- A design review of the working module asked each screen to do one thing and
-- to keep its machinery underneath. Most of that is presentation. v223–v226
-- already carry the rollout mode, releasing everything held, adding a
-- department where it is missed and each department's escalation route. What
-- is left needs the database in four places:
--
--   1. An open finding's wording, place and department can be corrected on
--      the record, with the before and after.
--   2. Its risk can be reassessed with a reason, without moving the follow-up
--      it was assigned under.
--   3. "Raised in error" is its own administrative outcome; Withdraw is no
--      longer offered for new findings (existing ones keep what they were).
--   4. The register learns "changes requested", and a held email stops
--      counting as a reason a row needs attention: v224 reports it once, for
--      the whole system, instead of once per finding.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1–2. Correcting an open finding
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
-- 3. Raised in error, and no new Withdraw
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
-- 4. The register: changes requested, and held stops being per-row attention
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

/*
 * v224's register, with two differences: a held email is no longer a reason a
 * row needs attention (the register says it once, above the list), and the
 * row says when the last decision sent the correction back. The column is
 * appended, so `create or replace` keeps the view, its security_invoker option
 * and its grants.
 */
create or replace view public.esh_register_rows
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
    (f.status = ANY (ARRAY['draft'::text, 'new'::text])) OR f.status = 'open'::text AND (COALESCE((a.state = ANY (ARRAY['assigned'::text, 'in_progress'::text])) AND a.due_at < now(), false) OR COALESCE(a.state = 'awaiting_verification'::text, false) OR COALESCE(failed.any_failed, false)) AS needs_attention,
    COALESCE(latest.occurred_at, f.created_at) AS last_update_at,
    COALESCE(latest.event_type, 'finding_created'::text) AS last_update_type,
    COALESCE(failed.any_failed, false) AS notification_failed,
    escalated.level AS escalation_level,
    COALESCE(focus.esh_changes_requested(a.id), false) AS changes_requested
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
         LIMIT 1) latest ON true;

/* v202's action register, with the same two differences. */
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

revoke all on function focus.esh_changes_requested(uuid) from public, anon;
grant execute on function focus.esh_changes_requested(uuid) to authenticated;

revoke all on function public.esh_edit_finding(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.esh_set_risk(uuid, text, text) from public, anon;
grant execute on function public.esh_edit_finding(uuid, text, text, text, uuid) to authenticated;
grant execute on function public.esh_set_risk(uuid, text, text) to authenticated;
