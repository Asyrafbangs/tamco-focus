-- ============================================================================
-- v264 — whether the owner was slow, or we were
--
-- Closure against the date first promised is one number doing two jobs, and it
-- gets both wrong depending on which way you read it:
--
--   * measure only the **first** submission and an owner is rewarded for
--     sending something, anything, before the deadline — a photograph of the
--     wrong machine lands on time;
--   * measure only the **accepted** submission and an owner who did the work
--     properly on the due day is marked late because ESH took eleven days to
--     look at it.
--
-- So both, separately, plus the two gaps nobody was measuring at all: how long
-- ESH takes to review a submission, and how long an owner takes to come back
-- after being asked for more. Each figure carries the number of events behind
-- it, because a percentage from three closures is not a rate and should not be
-- able to pass for one on a dashboard.
--
-- Windowed on the decision, not the finding: a submission reviewed this month
-- belongs to this month's review turnaround however old the finding is.
-- ============================================================================

create or replace function focus.esh_responsiveness(p_org uuid, p_months integer)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with window_start as (
    select date_trunc('month', now()) - make_interval(months => p_months - 1) as from_at
  ),
  -- Every action accepted inside the window, with the date first promised and
  -- the two submissions that say different things about it.
  settled as (
    select a.id,
           a.baseline_due_at as promised,
           (select min(s.submitted_at) from public.esh_action_submissions s
             where s.action_id = a.id) as first_at,
           (select max(s.submitted_at) from public.esh_action_submissions s
             where s.action_id = a.id and s.state = 'accepted') as accepted_at
      from public.esh_finding_actions a
     where a.organization_id = p_org
       and a.state = 'accepted'
       and a.accepted_at >= (select from_at from window_start)
  ),
  -- How long a submission waited for somebody to look at it.
  reviews as (
    select extract(epoch from (v.verified_at - s.submitted_at)) / 3600 as hours
      from public.esh_verification_events v
      join public.esh_action_submissions s on s.id = v.submission_id
     where v.organization_id = p_org
       and v.verified_at >= (select from_at from window_start)
  ),
  -- And how long the owner took to come back after being asked for more. The
  -- next submission on that action, if one has arrived yet; an owner who has
  -- not answered is not counted as fast, they are simply not counted.
  returns_after_changes as (
    select extract(epoch from (
             (select min(s2.submitted_at) from public.esh_action_submissions s2
               where s2.action_id = v.action_id and s2.submitted_at > v.verified_at)
             - v.verified_at)) / 3600 as hours
      from public.esh_verification_events v
     where v.organization_id = p_org
       and v.decision = 'changes_requested'
       and v.verified_at >= (select from_at from window_start)
  )
  select jsonb_build_object(
    'first_submission', jsonb_build_object(
      'counted', (select count(*) from settled where first_at is not null and promised is not null),
      'on_time', (select count(*) from settled
                   where first_at is not null and promised is not null and first_at <= promised)),
    'accepted_submission', jsonb_build_object(
      'counted', (select count(*) from settled
                   where accepted_at is not null and promised is not null),
      'on_time', (select count(*) from settled
                   where accepted_at is not null and promised is not null
                     and accepted_at <= promised)),
    'esh_review', jsonb_build_object(
      'counted', (select count(*) from reviews),
      'median_hours', (select coalesce(round(percentile_disc(0.5) within group (
                                order by hours)::numeric, 1), 0) from reviews)),
    'after_changes', jsonb_build_object(
      'counted', (select count(*) from returns_after_changes where hours is not null),
      'waiting', (select count(*) from returns_after_changes where hours is null),
      'median_hours', (select coalesce(round(percentile_disc(0.5) within group (
                                order by hours)::numeric, 1), 0)
                         from returns_after_changes where hours is not null)));
$$;

revoke all on function focus.esh_responsiveness(uuid, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The dashboard carries it
--
-- Copied forward from v263, which is the latest definition of this function in
-- this repository and not the one a file listing shows first.
-- ---------------------------------------------------------------------------

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
    'responsiveness', focus.esh_responsiveness(org, v_months),
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
