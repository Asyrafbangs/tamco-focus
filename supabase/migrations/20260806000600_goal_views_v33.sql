-- ============================================================================
-- TAMCO Focus v33 — compact Goal read models
--
-- All views use security_invoker so the caller's RLS remains authoritative.
-- ============================================================================

create view public.goal_overview
with (security_invoker = true)
as
select
  g.id,
  g.owner_id,
  owner.full_name as owner_name,
  owner.employee_id as owner_employee_id,
  owner.reporting_manager_id,
  g.manager_id,
  manager.full_name as manager_name,
  g.title,
  g.category,
  g.status,
  g.health,
  g.reported_progress,
  coalesce(progress.derived_progress, 0)::smallint as derived_progress,
  g.target_date,
  g.weight_percent,
  g.checkin_due_at,
  g.update_requested_at,
  g.last_meaningful_update_at,
  g.active_version_id,
  g.pending_version_id,
  g.agreed_at,
  g.completed_at,
  g.closed_at,
  g.version,
  g.created_at,
  current_milestone.id as current_milestone_id,
  current_milestone.title as current_milestone_title,
  current_milestone.progress_percent as current_milestone_progress,
  next_milestone.title as next_milestone_title,
  coalesce(support.open_count, 0)::integer as open_support_count,
  (g.status = 'active' and g.checkin_due_at is not null and g.checkin_due_at <= now())
    as is_checkin_due,
  (g.status = 'active' and g.update_requested_at is not null)
    as is_update_requested,
  (
    g.status = 'active'
    and g.target_date between current_date and current_date + 30
    and g.reported_progress < 100
  ) as is_target_approaching,
  coalesce(recent_completion.has_recent_completion, false)
    as has_recent_milestone_completion,
  (
       g.health in ('need_attention', 'support_requested')
    or coalesce(support.open_count, 0) > 0
    or (g.status = 'active' and g.checkin_due_at is not null and g.checkin_due_at <= now())
    or (g.status = 'active' and g.update_requested_at is not null)
    or (
      g.status = 'active'
      and g.target_date between current_date and current_date + 30
      and g.reported_progress < 100
    )
    or coalesce(recent_completion.has_recent_completion, false)
  ) as needs_attention,
  case
    when coalesce(support.open_count, 0) > 0 or g.health = 'support_requested'
      then 'Support requested'
    when g.update_requested_at is not null then 'Manager requested an update'
    when g.checkin_due_at is not null and g.checkin_due_at <= now() then 'Progress check-in due'
    when g.health = 'need_attention' then 'Needs attention'
    when g.target_date between current_date and current_date + 30 and g.reported_progress < 100
      then 'Target date approaching'
    when coalesce(recent_completion.has_recent_completion, false)
      then 'Milestone completed'
    else null
  end as attention_reason,
  version_data.expected_result,
  version_data.success_measure,
  version_data.employee_approach,
  version_data.support_agreed,
  version_data.dependencies,
  version_data.baseline,
  version_data.purpose,
  version_data.version_number as active_version_number
from public.goals g
join public.user_profiles owner on owner.id = g.owner_id
left join public.user_profiles manager on manager.id = g.manager_id
left join public.goal_versions version_data
  on version_data.id = coalesce(g.active_version_id, g.pending_version_id)
left join lateral (
  select round(
    sum(m.progress_percent * m.weight_percent)::numeric / nullif(sum(m.weight_percent), 0)
  )::smallint as derived_progress
  from public.goal_milestones m
  where m.goal_version_id = g.active_version_id
) progress on true
left join lateral (
  select m.id, m.title, m.progress_percent, m.position
  from public.goal_milestones m
  where m.goal_version_id = coalesce(g.active_version_id, g.pending_version_id)
    and m.progress_percent < 100
  order by m.position
  limit 1
) current_milestone on true
left join lateral (
  select m.title
  from public.goal_milestones m
  where m.goal_version_id = coalesce(g.active_version_id, g.pending_version_id)
    and m.position > coalesce(current_milestone.position, 0)
  order by m.position
  limit 1
) next_milestone on true
left join lateral (
  select count(*)::integer as open_count
  from public.goal_support_requests sr
  where sr.goal_id = g.id and sr.status <> 'resolved'
) support on true
left join lateral (
  select exists (
    select 1 from public.goal_milestone_updates mu
    where mu.goal_id = g.id
      and mu.marked_complete
      and mu.created_at >= now() - interval '7 days'
  ) as has_recent_completion
) recent_completion on true;

create view public.goal_team_summary
with (security_invoker = true)
as
select
  owner_id as user_id,
  owner_name as full_name,
  owner_employee_id as employee_id,
  count(*) filter (where status = 'active')::integer as active_goal_count,
  coalesce(
    round(
      sum(reported_progress * weight_percent) filter (where status = 'active')::numeric
      / nullif(sum(weight_percent) filter (where status = 'active'), 0)
    ),
    round(avg(reported_progress) filter (where status = 'active')),
    0
  )::smallint as weighted_progress,
  count(*) filter (where status = 'active' and needs_attention)::integer as attention_count,
  count(*) filter (where status = 'active' and is_checkin_due)::integer as checkin_due_count,
  count(*) filter (where status = 'active' and open_support_count > 0)::integer
    as support_request_count,
  max(last_meaningful_update_at) as last_goal_update_at
from public.goal_overview
where status <> 'cancelled'
group by owner_id, owner_name, owner_employee_id;

grant select on public.goal_overview, public.goal_team_summary to authenticated, service_role;
revoke all on public.goal_overview, public.goal_team_summary from anon;
