-- TAMCO Focus v50 - deterministic lifecycle read models.

drop view if exists public.goal_team_summary;

create or replace view public.goal_overview
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
  case
    when coalesce(measure_progress.measure_count, 0) > 0
      then coalesce(measure_progress.derived_progress, 0)
    else coalesce(milestone_progress.derived_progress, 0)
  end::smallint as derived_progress,
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
  coalesce(support.open_count, 0) as open_support_count,
  (
    g.status = 'active'
    and current_monthly.id is null
  ) as is_checkin_due,
  (g.status = 'active' and g.update_requested_at is not null) as is_update_requested,
  (
    g.status = 'active'
    and g.target_date >= current_date
    and g.target_date <= current_date + 30
    and coalesce(measure_progress.derived_progress, g.reported_progress) < 100
  ) as is_target_approaching,
  coalesce(recent_completion.has_recent_completion, false) as has_recent_milestone_completion,
  (
    g.health in ('need_attention', 'support_requested', 'at_risk', 'off_track')
    or coalesce(support.open_count, 0) > 0
    or (g.status = 'active' and g.update_requested_at is not null)
    or coalesce(current_quarterly.status = 'submitted', false)
  ) as needs_attention,
  case
    when coalesce(support.open_count, 0) > 0 or g.health = 'support_requested'
      then 'Support requested'
    when current_quarterly.status = 'submitted'
      then 'Quarterly discussion ready'
    when g.update_requested_at is not null
      then 'Manager requested an update'
    when g.health = 'off_track'
      then 'Employee reported Off track'
    when g.health in ('at_risk', 'need_attention')
      then 'Employee reported At risk'
    else null
  end as attention_reason,
  version_data.expected_result,
  version_data.success_measure,
  version_data.employee_approach,
  version_data.support_agreed,
  version_data.dependencies,
  version_data.baseline,
  version_data.purpose,
  version_data.version_number as active_version_number,

  coalesce(measure_progress.measure_count, 0)::integer as success_measure_count,
  coalesce(measure_progress.derived_progress, 0)::smallint as measure_progress,
  case
    when current_monthly.id is null then focus.goal_month_end(current_date)
    else focus.goal_month_end((current_date + interval '1 month')::date)
  end as next_monthly_checkin_date,
  (g.status = 'active' and current_monthly.id is null) as is_monthly_checkin_due,
  latest_monthly.submitted_at as last_monthly_checkin_at,
  latest_monthly.progress_status as last_monthly_checkin_status,
  case
    when current_quarterly.status = 'agreed'
      then focus.goal_quarter_end((current_date + interval '3 months')::date)
    else focus.goal_quarter_end(current_date)
  end as next_quarterly_checkin_date,
  (
    g.status = 'active'
    and (current_quarterly.id is null or current_quarterly.status = 'draft')
  ) as is_quarterly_checkin_due,
  (
    g.status = 'active'
    and coalesce(current_quarterly.status = 'submitted', false)
  ) as quarterly_requires_manager_action,
  (
    g.health in ('need_attention', 'support_requested', 'at_risk', 'off_track')
    or coalesce(support.open_count, 0) > 0
    or coalesce(current_quarterly.status = 'submitted', false)
  ) as manager_needs_attention,
  case
    when coalesce(support.open_count, 0) > 0 or g.health = 'support_requested'
      then 'Support requested'
    when current_quarterly.status = 'submitted'
      then 'Quarterly discussion ready'
    when g.health = 'off_track'
      then 'Employee reported Off track'
    when g.health in ('at_risk', 'need_attention')
      then 'Employee reported At risk'
    else null
  end as manager_attention_reason,
  current_quarterly.id as current_quarterly_checkin_id,
  current_quarterly.status as current_quarterly_status,
  latest_year_end.result_statement as latest_year_end_result,
  latest_year_end.status as latest_year_end_status
from public.goals g
join public.user_profiles owner on owner.id = g.owner_id
left join public.user_profiles manager on manager.id = g.manager_id
left join public.goal_versions version_data
  on version_data.id = coalesce(g.active_version_id, g.pending_version_id)
left join lateral (
  select
    count(*)::integer as measure_count,
    round(avg(focus.goal_measure_progress(
      m.measure_type,
      m.target_numeric,
      m.current_numeric,
      m.current_state
    )))::smallint as derived_progress
  from public.goal_success_measures m
  where m.goal_version_id = g.active_version_id
) measure_progress on true
left join lateral (
  select round(avg(m.progress_percent))::smallint as derived_progress
  from public.goal_milestones m
  where m.goal_version_id = g.active_version_id
) milestone_progress on true
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
    select 1
    from public.goal_milestone_updates mu
    where mu.goal_id = g.id
      and mu.marked_complete
      and mu.created_at >= now() - interval '7 days'
  ) as has_recent_completion
) recent_completion on true
left join lateral (
  select ci.id, ci.status, ci.progress_status, ci.submitted_at
  from public.goal_check_ins ci
  where ci.goal_id = g.id
    and ci.checkin_type = 'monthly'
    and ci.period_year = extract(year from current_date)::integer
    and ci.period_month = extract(month from current_date)::integer
  limit 1
) current_monthly on true
left join lateral (
  select ci.progress_status, ci.submitted_at
  from public.goal_check_ins ci
  where ci.goal_id = g.id and ci.checkin_type = 'monthly'
  order by ci.period_end desc, ci.created_at desc
  limit 1
) latest_monthly on true
left join lateral (
  select ci.id, ci.status, ci.progress_status
  from public.goal_check_ins ci
  where ci.goal_id = g.id
    and ci.checkin_type = 'quarterly'
    and ci.period_year = extract(year from current_date)::integer
    and ci.period_quarter = extract(quarter from current_date)::integer
  limit 1
) current_quarterly on true
left join lateral (
  select ci.result_statement, ci.status
  from public.goal_check_ins ci
  where ci.goal_id = g.id and ci.checkin_type = 'year_end'
  order by ci.period_year desc
  limit 1
) latest_year_end on true;

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
      sum(derived_progress * weight_percent) filter (where status = 'active')::numeric
      / nullif(sum(weight_percent) filter (where status = 'active'), 0)
    ),
    round(avg(derived_progress) filter (where status = 'active')),
    0
  )::smallint as weighted_progress,
  count(*) filter (where status = 'active' and manager_needs_attention)::integer
    as attention_count,
  count(*) filter (where status = 'active' and is_monthly_checkin_due)::integer
    as checkin_due_count,
  count(*) filter (where status = 'active' and open_support_count > 0)::integer
    as support_request_count,
  max(last_meaningful_update_at) as last_goal_update_at,
  count(*) filter (
    where status = 'active' and quarterly_requires_manager_action
  )::integer as quarterly_action_count,
  count(*) filter (
    where status = 'active' and is_quarterly_checkin_due
  )::integer as quarterly_due_count
from public.goal_overview
where status <> 'cancelled'
group by owner_id, owner_name, owner_employee_id;

create view public.goal_lifecycle_history
with (security_invoker = true)
as
select
  ae.id,
  ae.goal_id,
  ae.occurred_at,
  ae.actor_id,
  actor.full_name as actor_name,
  ae.event_type::text as event_kind,
  case ae.event_type::text
    when 'goal_created' then 'Goal created'
    when 'goal_version_proposed' then 'Goal change proposed'
    when 'goal_version_agreed' then 'Goal agreement activated'
    when 'goal_measure_updated' then 'Success measure updated'
    when 'goal_monthly_checkin_submitted' then 'Monthly check-in submitted'
    when 'goal_quarterly_checkin_submitted' then 'Quarterly summary submitted'
    when 'goal_quarterly_checkin_agreed' then 'Quarterly discussion agreed'
    when 'goal_year_end_result_saved' then 'Year-end Result saved'
    when 'goal_year_end_result_finalized' then 'Year-end Result finalized'
    when 'goal_support_requested' then 'Support requested'
    when 'goal_support_resolved' then 'Support resolved'
    when 'goal_milestone_updated' then 'Milestone updated'
    when 'goal_milestone_completed' then 'Milestone completed'
    when 'goal_update_requested' then 'Manager requested an update'
    when 'goal_completed' then 'Goal completed'
    when 'goal_closed' then 'Goal closed'
    else 'Goal activity'
  end as title,
  ae.detail
from public.audit_events ae
left join public.user_profiles actor on actor.id = ae.actor_id
where ae.goal_id is not null
union all
select
  ga.id,
  ga.goal_id,
  ga.created_at as occurred_at,
  ga.uploaded_by as actor_id,
  actor.full_name as actor_name,
  'goal_attachment_added'::text as event_kind,
  'Evidence attached'::text as title,
  jsonb_build_object(
    'attachment_id', ga.id,
    'file_name', ga.file_name,
    'mime_type', ga.mime_type,
    'byte_size', ga.byte_size
  ) as detail
from public.goal_attachments ga
left join public.user_profiles actor on actor.id = ga.uploaded_by;

grant select on public.goal_overview,
  public.goal_team_summary,
  public.goal_lifecycle_history to authenticated, service_role;
revoke all on public.goal_overview,
  public.goal_team_summary,
  public.goal_lifecycle_history from anon;
