-- TAMCO Focus v53 — RLS and deterministic projections for the unified lifecycles.

-- ---------------------------------------------------------------------------
-- Shared is incomplete checklist work assigned away from the parent owner.
-- Terminal parents and completed steps are historical, never actionable.
-- ---------------------------------------------------------------------------

create or replace view public.shared_contributions
with (security_invoker = true)
as
select
  item.id as checklist_item_id,
  item.task_id,
  item.action as title,
  item.assigned_to as assignee_id,
  item.evidence_rule,
  item.due_at as item_due_at,
  item.depends_on_item_id,
  item.state,
  item.completed_at,
  item.position,
  parent.title as parent_title,
  parent.status as parent_status,
  parent.work_class as parent_work_class,
  parent.due_at as parent_due_at,
  parent.due_is_date_only as parent_due_is_date_only,
  parent.primary_owner_id,
  coalesce(owner.full_name, 'Team member') as primary_owner_name,
  prerequisite.action as prerequisite_title,
  case
    when parent.status = 'backlog' then 'waiting_for_owner'
    when parent.status = 'paused' then 'waiting_parent_paused'
    when item.depends_on_item_id is not null
         and coalesce(prerequisite.state, 'waiting') <> 'completed'
      then 'waiting_prerequisite'
    when parent.status = 'active' then 'ready'
    else 'waiting'
  end as readiness
from public.task_checklist_items item
join public.tasks parent on parent.id = item.task_id
left join public.team_directory owner on owner.id = parent.primary_owner_id
left join public.task_checklist_items prerequisite on prerequisite.id = item.depends_on_item_id
where item.assigned_to is not null
  and item.assigned_to <> parent.primary_owner_id
  and item.state <> 'completed'
  and parent.status in ('backlog', 'active', 'paused');

-- ---------------------------------------------------------------------------
-- Unified request policies.
-- ---------------------------------------------------------------------------

drop policy if exists barriers_select on public.barriers;
drop policy if exists barriers_insert on public.barriers;
drop policy if exists barriers_update on public.barriers;

create policy barriers_select on public.barriers
  for select to authenticated
  using (focus.can_view_request(id));

create policy barriers_insert on public.barriers
  for insert to authenticated
  with check (
    raised_by = focus.current_user_id()
    and (
      (task_id is not null and focus.can_contribute_to_task(task_id))
      or (goal_id is not null and focus.can_update_goal(goal_id))
    )
  );

create policy barriers_update on public.barriers
  for update to authenticated
  using (focus.can_manage_request(id))
  with check (focus.can_manage_request(id));

drop policy if exists barrier_responses_select on public.barrier_responses;
drop policy if exists barrier_responses_insert on public.barrier_responses;

create policy barrier_responses_select on public.barrier_responses
  for select to authenticated
  using (focus.can_view_request(barrier_id));

create policy barrier_responses_insert on public.barrier_responses
  for insert to authenticated
  with check (
    author_id = focus.current_user_id()
    and focus.can_view_request(barrier_id)
  );

drop policy if exists meeting_queue_items_select on public.meeting_queue_items;
drop policy if exists meeting_queue_items_insert on public.meeting_queue_items;
drop policy if exists meeting_queue_items_update on public.meeting_queue_items;

create policy meeting_queue_items_select on public.meeting_queue_items
  for select to authenticated
  using (
    focus.is_manager_or_admin()
    or (task_id is not null and focus.can_view_task(task_id))
    or (barrier_id is not null and focus.can_view_request(barrier_id))
  );

create policy meeting_queue_items_insert on public.meeting_queue_items
  for insert to authenticated
  with check (
    focus.is_manager_or_admin()
    or (task_id is not null and focus.can_contribute_to_task(task_id))
    or (barrier_id is not null and focus.can_view_request(barrier_id))
  );

create policy meeting_queue_items_update on public.meeting_queue_items
  for update to authenticated
  using (
    focus.is_manager_or_admin()
    or (barrier_id is not null and focus.can_manage_request(barrier_id))
  )
  with check (
    focus.is_manager_or_admin()
    or (barrier_id is not null and focus.can_manage_request(barrier_id))
  );

-- ---------------------------------------------------------------------------
-- Goal period/session policies.
-- ---------------------------------------------------------------------------

create policy performance_periods_select on public.performance_periods
  for select to authenticated
  using (focus.is_active_account());

create policy employee_goal_plans_select on public.employee_goal_plans
  for select to authenticated
  using (
    employee_id = focus.current_user_id()
    or focus.is_admin()
    or focus.can_view_user(employee_id)
  );

create policy goal_checkin_sessions_select on public.goal_checkin_sessions
  for select to authenticated
  using (
    employee_id = focus.current_user_id()
    or focus.is_admin()
    or focus.can_view_user(employee_id)
  );

create policy goal_checkin_session_items_select on public.goal_checkin_session_items
  for select to authenticated
  using (
    focus.can_view_goal(goal_id)
    and exists (
      select 1 from public.goal_checkin_sessions session
      where session.id = session_id
        and (
          session.employee_id = focus.current_user_id()
          or focus.is_admin()
          or focus.can_view_user(session.employee_id)
        )
    )
  );

revoke all on public.performance_periods,
  public.employee_goal_plans,
  public.goal_checkin_sessions,
  public.goal_checkin_session_items from public, anon, authenticated;

grant select on public.performance_periods,
  public.employee_goal_plans,
  public.goal_checkin_sessions,
  public.goal_checkin_session_items to authenticated;

grant all on public.performance_periods,
  public.employee_goal_plans,
  public.goal_checkin_sessions,
  public.goal_checkin_session_items to service_role;

-- ---------------------------------------------------------------------------
-- Read models.
-- ---------------------------------------------------------------------------

create view public.goal_plan_overview
with (security_invoker = true)
as
select
  plan.id,
  plan.employee_id,
  person.full_name as employee_name,
  plan.performance_period_id,
  period.name as performance_period_name,
  period.starts_on,
  period.ends_on,
  plan.status,
  plan.finalized_by,
  plan.finalized_at,
  plan.version,
  coalesce(allocation.active_goal_count, 0)::integer as active_goal_count,
  coalesce(allocation.formal_weight, 0)::integer as formal_weight,
  greatest(0, 100 - coalesce(allocation.formal_weight, 0))::integer as reallocation_required,
  coalesce(allocation.formal_weight, 0) = 100 as can_finalize
from public.employee_goal_plans plan
join public.user_profiles person on person.id = plan.employee_id
join public.performance_periods period on period.id = plan.performance_period_id
left join lateral (
  select count(*) filter (where goal.status = 'active')::integer as active_goal_count,
         coalesce(sum(goal.weight_percent), 0)::integer as formal_weight
  from public.goals goal
  where goal.owner_id = plan.employee_id
    and goal.performance_period_id = plan.performance_period_id
    and goal.status in ('active', 'completed')
) allocation on true;

create view public.goal_session_overview
with (security_invoker = true)
as
select
  session.id,
  session.employee_id,
  person.full_name as employee_name,
  session.performance_period_id,
  period.name as performance_period_name,
  session.session_kind,
  session.status,
  session.period_year,
  session.period_month,
  session.period_quarter,
  session.submitted_by,
  submitter.full_name as submitted_by_name,
  session.submitted_at,
  session.reviewed_by,
  reviewer.full_name as reviewed_by_name,
  session.reviewed_at,
  session.summary,
  session.version,
  count(item.id)::integer as goal_count,
  count(item.id) filter (where item.health = 'at_risk')::integer as at_risk_count,
  count(item.id) filter (where item.health = 'off_track')::integer as off_track_count,
  count(item.id) filter (where item.support_requested)::integer as support_request_count
from public.goal_checkin_sessions session
join public.user_profiles person on person.id = session.employee_id
join public.performance_periods period on period.id = session.performance_period_id
left join public.user_profiles submitter on submitter.id = session.submitted_by
left join public.user_profiles reviewer on reviewer.id = session.reviewed_by
left join public.goal_checkin_session_items item on item.session_id = session.id
group by session.id, person.full_name, period.name,
  submitter.full_name, reviewer.full_name;

create view public.action_requests_overview
with (security_invoker = true)
as
select
  request.id,
  case when request.task_id is not null then 'task' else 'goal' end as source_type,
  coalesce(request.task_id, request.goal_id) as source_id,
  request.task_id,
  request.goal_id,
  coalesce(task.title, goal.title, 'Work request') as source_title,
  request.description,
  request.support_needed,
  request.impact,
  request.action_type,
  request.action_required_from,
  action_person.full_name as action_required_from_name,
  request.raised_by,
  raiser.full_name as raised_by_name,
  request.raised_at,
  request.status,
  request.action_pending,
  request.source_active,
  request.source_inactive_at,
  request.resolved_at,
  request.version
from public.barriers request
left join public.tasks task on task.id = request.task_id
left join public.goals goal on goal.id = request.goal_id
left join public.team_directory action_person on action_person.id = request.action_required_from
left join public.team_directory raiser on raiser.id = request.raised_by;

grant select on public.shared_contributions,
  public.goal_plan_overview,
  public.goal_session_overview,
  public.action_requests_overview to authenticated;

-- Task capabilities include terminal authority so a Mandatory-work owner does
-- not see a Cancel control the transaction is required to refuse.
create or replace function public.get_task_capabilities(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or not focus.can_view_task(p_task_id) then
      jsonb_build_object(
        'can_view', false, 'can_contribute', false, 'can_edit', false,
        'can_review', false, 'can_reassign', false, 'can_cancel', false
      )
    else (
      select jsonb_build_object(
        'can_view', true,
        'can_contribute', focus.can_contribute_to_task(task.id),
        'can_edit', focus.can_edit_task(task.id),
        'can_review', focus.can_review_task(task.id),
        'can_reassign', task.status not in ('completed', 'cancelled') and (
          focus.is_admin()
          or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))
        ),
        'can_cancel', task.status not in ('completed', 'cancelled') and case
          when task.is_mandatory then (
            focus.is_admin()
            or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))
          )
          else (
            task.primary_owner_id = auth.uid()
            or focus.is_admin()
            or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))
          )
        end
      )
      from public.tasks task where task.id = p_task_id
    )
  end;
$$;

revoke all on function public.get_task_capabilities(uuid) from public, anon;
grant execute on function public.get_task_capabilities(uuid) to authenticated;

-- Capabilities name the separate terminal actions and session authority.
create or replace function public.get_goal_capabilities(p_goal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or not focus.can_view_goal(p_goal_id) then
      jsonb_build_object(
        'can_view', false, 'can_update', false, 'can_edit_structure', false,
        'can_agree', false, 'can_submit_monthly', false,
        'can_prepare_quarterly', false, 'can_complete_quarterly', false,
        'can_save_year_end', false, 'can_complete_goal', false,
        'can_cancel_goal', false
      )
    else (
      select jsonb_build_object(
        'can_view', true,
        'can_update', focus.can_update_goal(goal.id),
        'can_edit_structure', focus.can_edit_goal_structure(goal.id),
        'can_agree', focus.can_agree_goal(goal.id),
        'can_submit_monthly', focus.can_submit_goal_monthly(goal.id),
        'can_prepare_quarterly', focus.can_prepare_goal_quarterly(goal.id),
        'can_complete_quarterly', focus.can_complete_goal_quarterly(goal.id),
        'can_save_year_end', focus.can_save_goal_year_end(goal.id),
        'can_complete_goal', goal.status = 'active' and focus.can_agree_goal(goal.id),
        'can_cancel_goal', goal.status not in ('completed', 'closed', 'cancelled') and (
          goal.owner_id = auth.uid()
          or focus.is_admin()
          or goal.manager_id = auth.uid()
          or (focus.is_manager_or_admin() and focus.is_manager_of(goal.owner_id))
        )
      )
      from public.goals goal where goal.id = p_goal_id
    )
  end;
$$;

revoke all on function public.get_goal_capabilities(uuid) from public, anon;
grant execute on function public.get_goal_capabilities(uuid) to authenticated;
