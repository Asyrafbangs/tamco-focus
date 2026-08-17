-- ============================================================================
-- v69 — Team visibility boundary and set-based workload projections
-- ============================================================================
--
-- `user_profiles_select` deliberately exposes the caller's own reporting
-- manager so ordinary screens can say who they report to. That narrow name /
-- attribution permission is not Team visibility, but both `focus_summary` and
-- `team_load_summary` treated every profile returned by that policy as a team
-- member. A restricted employee could therefore acquire their manager's load
-- row if a caller reached the projection.
--
-- Team membership is the stricter question answered by `can_view_user`. The
-- views now state that requirement explicitly. The task and related tables
-- remain security-invoker inputs, so this is a narrowing and never a bypass.
--
-- The old Team load view also executed many correlated subqueries per person.
-- The replacement groups each authoritative table once and joins those
-- aggregates to the visible roster. This preserves every count while avoiding
-- work that grows as people × workload.
-- ============================================================================

create or replace view public.focus_summary
with (security_invoker = true)
as
with buckets as (
  select unnest(enum_range(null::public.focus_bucket)) as bucket
),
active as (
  select
    t.primary_owner_id as user_id,
    t.focus_bucket as bucket,
    count(*)::integer as active_count,
    min(t.activated_at) filter (where t.over_focus_target) as over_target_since
  from public.tasks t
  where t.status = 'active'
    and t.focus_bucket is not null
  group by t.primary_owner_id, t.focus_bucket
)
select
  p.id as user_id,
  p.full_name,
  b.bucket,
  coalesce(a.active_count, 0)::integer as active_count,
  target.recommended_target,
  coalesce(a.active_count, 0) > coalesce(target.recommended_target, 0) as is_over_target,
  a.over_target_since
from public.user_profiles p
cross join buckets b
cross join lateral (
  select focus.effective_focus_target(p.id, b.bucket) as recommended_target
) target
left join active a on a.user_id = p.id and a.bucket = b.bucket
where p.status = 'active'
  -- Service workers already hold BYPASSRLS and use this projection for
  -- canonical counts. The explicit Team predicate must not accidentally
  -- remove the access that role already has; browser requests run as
  -- `authenticated` and carry a user id, so they remain bounded by
  -- `can_view_user`. The view itself is not granted to `anon`.
  and (auth.uid() is null or focus.can_view_user(p.id));

comment on view public.focus_summary is
  'Focus counts for active people in the caller''s effective Team visibility. '
  'Reporting-manager attribution alone does not expose workload.';

create or replace view public.team_load_summary
with (security_invoker = true)
as
with settings as (
  select focus.stale_threshold_days() as stale_days
),
task_stats as (
  select
    t.primary_owner_id as user_id,
    count(*) filter (
      where t.status = 'backlog'
        and t.work_class in ('major_project', 'operational_action', 'self_development')
    )::integer as available_work_count,
    count(*) filter (
      where t.status = 'active'
        and t.due_at is not null
        and now() > t.due_at
    )::integer as overdue_count,
    count(*) filter (
      where t.status = 'active'
        and t.last_meaningful_update_at
            < now() - make_interval(days => settings.stale_days)
    )::integer as stale_count,
    count(*) filter (
      where t.work_class = 'routine_occurrence'
        and t.occurrence_date between date_trunc('week', current_date)::date
                                 and (date_trunc('week', current_date) + interval '6 days')::date
    )::integer as routines_this_week,
    count(*) filter (
      where t.work_class = 'routine_occurrence'
        and t.status = 'completed'
        and t.occurrence_date between date_trunc('week', current_date)::date
                                 and (date_trunc('week', current_date) + interval '6 days')::date
    )::integer as routines_completed_this_week,
    count(*) filter (
      where t.work_class = 'routine_occurrence'
        and t.status in ('backlog', 'active')
        and t.due_at is not null
        and now() > t.due_at
    )::integer as routines_overdue,
    count(*) filter (
      where t.origin = 'self_initiated'
        and t.work_class = 'quick_action'
        and t.created_at >= date_trunc('week', current_date)
    )::integer as quick_actions_created_this_week,
    count(*) filter (
      where t.origin = 'self_initiated'
        and t.work_class = 'operational_action'
        and t.created_at >= date_trunc('week', current_date)
    )::integer as operational_created_this_week
  from public.tasks t
  cross join settings
  group by t.primary_owner_id
),
barrier_stats as (
  select
    t.primary_owner_id as user_id,
    count(*)::integer as open_barrier_count
  from public.barriers b
  join public.tasks t on t.id = b.task_id
  where b.status = 'open'
  group by t.primary_owner_id
),
proposal_stats as (
  select
    wp.proposed_by as user_id,
    count(*)::integer as decisions_pending
  from public.work_proposals wp
  where wp.status = 'pending'
  group by wp.proposed_by
)
select
  p.id as user_id,
  p.full_name,
  p.employee_id,
  p.department_id,
  p.reporting_manager_id,
  coalesce(ts.available_work_count, 0)::integer as available_work_count,
  coalesce(ts.overdue_count, 0)::integer as overdue_count,
  coalesce(ts.stale_count, 0)::integer as stale_count,
  coalesce(bs.open_barrier_count, 0)::integer as open_barrier_count,
  coalesce(ts.routines_this_week, 0)::integer as routines_this_week,
  coalesce(ts.routines_completed_this_week, 0)::integer as routines_completed_this_week,
  coalesce(ts.routines_overdue, 0)::integer as routines_overdue,
  coalesce(ts.quick_actions_created_this_week, 0)::integer as quick_actions_created_this_week,
  coalesce(ts.operational_created_this_week, 0)::integer as operational_created_this_week,
  coalesce(ps.decisions_pending, 0)::integer as decisions_pending
from public.user_profiles p
left join task_stats ts on ts.user_id = p.id
left join barrier_stats bs on bs.user_id = p.id
left join proposal_stats ps on ps.user_id = p.id
where p.status = 'active'
  and (auth.uid() is null or focus.can_view_user(p.id));

comment on view public.team_load_summary is
  'Set-based workload summary for active people in the caller''s effective Team '
  'visibility. Profile attribution access never widens the roster.';

revoke all on public.focus_summary, public.team_load_summary from public, anon;
grant select on public.focus_summary, public.team_load_summary to authenticated;

-- PostgreSQL checks function privileges for every expression referenced by a
-- view, even when the service-role branch above is already true. This role is
-- server-only and already BYPASSRLS; the narrow EXECUTE grant preserves its
-- established worker/read-model access without exposing the helper to anon.
grant execute on function
  focus.can_view_user(uuid),
  focus.effective_focus_target(uuid, public.focus_bucket),
  focus.stale_threshold_days()
to service_role;
