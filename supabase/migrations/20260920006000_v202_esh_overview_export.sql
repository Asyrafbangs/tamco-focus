-- ============================================================================
-- v202 ESH Finding Management: overview, exact drill-down and safe export.
--
-- docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md
-- §24, §26, §33; FM54, FM67-FM69.
-- ============================================================================

-- Action-level rows are deliberately separate from the finding register. A
-- multi-action finding is one open finding, but may be two overdue actions;
-- putting both units in one view is how dashboards quietly stop reconciling.
create view public.esh_action_register_rows
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
        or coalesce(held.any_held, false)
        or coalesce(failed.any_failed, false)) as needs_attention,
       coalesce(latest.occurred_at, a.assigned_at, a.created_at) as last_update_at,
       coalesce(latest.event_type, 'action_assigned') as last_update_type
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
       and e.event_type in ('action_assigned', 'action_started', 'owner_message',
                            'esh_message', 'escalation_message',
                            'submission_created', 'submission_withdrawn')
     order by e.occurred_at desc,
              array_position(array['submission_created', 'submission_withdrawn',
                                   'owner_message', 'esh_message', 'escalation_message',
                                   'action_started', 'action_assigned'], e.event_type)
     limit 1
  ) latest on true;

revoke all on public.esh_action_register_rows from anon, authenticated;
grant select on public.esh_action_register_rows to authenticated;

-- The maintained-calendar helper is intentionally private. This narrow wrapper
-- checks the caller's live Finding entitlement before answering one review due
-- question, so the security-invoker overview need not widen calendar access.
create or replace function focus.esh_review_is_overdue(
  p_organization_id uuid,
  p_submitted_at timestamptz,
  p_days integer,
  p_as_of timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when focus.esh_enabled()
     and p_organization_id = focus.esh_organization_id()
    then (p_as_of at time zone organization.timezone)::date
           >= focus.esh_after_working_days(
             p_organization_id,
             (p_submitted_at at time zone organization.timezone)::date,
             p_days)
    else false
  end
    from public.organizations organization
   where organization.id = p_organization_id;
$$;

revoke all on function focus.esh_review_is_overdue(uuid, timestamptz, integer, timestamptz)
  from public, anon;
grant execute on function focus.esh_review_is_overdue(uuid, timestamptz, integer, timestamptz)
  to authenticated;

-- One transaction and one authorized row set supplies every signal and every
-- department row. Summing the department rows therefore gives the signals,
-- including the explicit null/Unassigned group, without a second definition.
create or replace function public.esh_overview(
  p_department_id uuid,
  p_closed_since timestamptz,
  p_closed_until timestamptz default null,
  p_as_of timestamptz default now()
)
returns table (
  accountable_department_id uuid,
  department_name text,
  open_findings bigint,
  overdue_actions bigint,
  awaiting_review_actions bigint,
  review_overdue_actions bigint,
  closed_findings bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with visible as (
    select f.*
      from public.esh_findings f
     where p_department_id is null
        or f.accountable_department_id = p_department_id
  )
  select f.accountable_department_id,
         coalesce(max(d.name), 'Unassigned') as department_name,
         count(distinct f.id) filter (
           where f.status in ('draft', 'new', 'open')
         ) as open_findings,
         count(distinct a.id) filter (
           where f.status in ('draft', 'new', 'open')
             and a.state in ('assigned', 'in_progress')
             and a.due_at < p_as_of
         ) as overdue_actions,
         count(distinct a.id) filter (
           where f.status in ('draft', 'new', 'open')
             and a.state = 'awaiting_verification'
             and s.state = 'pending'
         ) as awaiting_review_actions,
         count(distinct a.id) filter (
           where f.status in ('draft', 'new', 'open')
             and a.state = 'awaiting_verification'
             and s.state = 'pending'
             and focus.esh_review_is_overdue(
                   f.organization_id, s.submitted_at,
                   assignment.followup_review_reminder_days::integer, p_as_of)
         ) as review_overdue_actions,
         count(distinct f.id) filter (
           where f.status = 'closed'
             and f.closed_at >= p_closed_since
             and (p_closed_until is null or f.closed_at <= p_closed_until)
         ) as closed_findings
    from visible f
    left join public.departments d on d.id = f.accountable_department_id
    left join public.esh_finding_actions a on a.finding_id = f.id
    left join public.esh_action_assignments assignment
      on assignment.action_id = a.id and assignment.ended_at is null
    left join public.esh_action_submissions s on s.id = a.current_submission_id
   group by f.accountable_department_id
   order by coalesce(max(d.name), 'Unassigned');
$$;

revoke all on function public.esh_overview(uuid, timestamptz, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.esh_overview(uuid, timestamptz, timestamptz, timestamptz)
  to authenticated;

-- A flat, action-level export. No evidence URL or guest token is exposed: a
-- file is still opened through the normal authorized, short-lived route.
create view public.esh_register_export_rows
with (security_invoker = true)
as
select f.id as finding_id,
       a.id as action_id,
       f.reference,
       f.title as finding_title,
       f.description as before_description,
       f.location,
       d.name as accountable_department,
       f.status as finding_status,
       f.risk_level,
       f.reported_on,
       a.sequence as action_sequence,
       a.title as action_title,
       a.required_outcome,
       a.state as action_state,
       a.priority,
       p.display_email as owner_email,
       a.baseline_due_at,
       a.due_at as current_due_at,
       submitted.result_text as after_description,
       submitted.submitted_at,
       verified.verified_at,
       f.closed_at,
       case
         when coalesce(escalation.active_count, 0) > 0 then 'activated'
         when coalesce(route.recipient_count, 0) > 0 then 'configured'
         else 'none'
       end as escalation_state,
       coalesce(route.recipient_count, 0) as escalation_recipients,
       coalesce(escalation.active_count, 0) as active_escalations
  from public.esh_findings f
  left join public.departments d on d.id = f.accountable_department_id
  left join public.esh_finding_actions a on a.finding_id = f.id
  left join public.esh_email_principals p on p.id = a.owner_principal_id
  left join lateral (
    select s.id, s.result_text, s.submitted_at
      from public.esh_action_submissions s
     where s.action_id = a.id
     order by s.version desc
     limit 1
  ) submitted on true
  left join lateral (
    select v.verified_at
      from public.esh_verification_events v
     where v.submission_id = submitted.id and v.decision = 'accepted'
     order by v.verified_at desc
     limit 1
  ) verified on true
  left join lateral (
    select count(*)::integer as recipient_count
      from public.esh_action_escalation_recipients r
     where r.action_id = a.id and r.removed_at is null
  ) route on true
  left join lateral (
    select count(*)::integer as active_count
      from public.esh_escalation_entitlements e
     where e.action_id = a.id
       and e.assignment_version = a.assignment_version
       and e.revoked_at is null
  ) escalation on true;

revoke all on public.esh_register_export_rows from anon, authenticated;
grant select on public.esh_register_export_rows to authenticated;
