-- ============================================================================
-- v230 — Two dashboards: one for ESH, one for everybody
--
-- The Overview was four counters and a department table, which answers "how
-- many" and not "how are we doing". A dashboard has to show movement: whether
-- the backlog is growing or shrinking, how old the open work is, and whether
-- what closes, closes on time.
--
-- Two functions, because the two audiences may see different things:
--
--   * `esh_dashboard` is scoped by the caller's Finding access, exactly as the
--     register is, and names departments.
--   * `esh_public_dashboard` is served to anonymous callers on a page with no
--     sign-in, at the Product Owner's explicit request (1 Oct 2026). It returns
--     counts and nothing else: no department, no reference, no title, no owner,
--     no location, no date of any single finding. Nobody can be identified from
--     it, and findings marked restricted are left out of it entirely.
--
-- "On time" is measured against `baseline_due_at`, the date first promised —
-- not `due_at`, which moves. A deadline extended three times and then met is
-- not a finding closed on time, and a dashboard that says otherwise is worse
-- than no dashboard.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shared shapes
-- ---------------------------------------------------------------------------

/*
 * Open findings bucketed by how long they have been open. Age is measured
 * from when the finding was recorded, because that is when the clock a person
 * cares about started, not when somebody got round to assigning it.
 */
create or replace function focus.esh_age_buckets(p_findings uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'under_30', count(*) filter (where age_days < 30),
    'from_30_to_90', count(*) filter (where age_days >= 30 and age_days < 90),
    'over_90', count(*) filter (where age_days >= 90))
    from (select extract(day from (now() - f.created_at))::integer as age_days
            from public.esh_findings f
           where f.id = any (p_findings)) aged;
$$;

-- ---------------------------------------------------------------------------
-- 2. The ESH dashboard (§33)
-- ---------------------------------------------------------------------------

/*
 * Everything the Overview needs, in the caller's own scope. The register's
 * definition of overdue and of who acts next is not repeated here: this counts
 * findings and actions, and links to the register for the list.
 */
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
                          and a.due_at < now())) as overdue
                from public.esh_findings f
                left join public.departments dep on dep.id = f.accountable_department_id
               where f.id = any (v_open)
               group by coalesce(dep.name, 'Unassigned')) d))
    into v_result;
  return v_result;
end;
$$;

/*
 * How much closed, and how much of it closed by the date first promised.
 * Shared by both dashboards so the public number can never drift from the one
 * ESH sees.
 */
create or replace function focus.esh_closure_facts(p_org uuid, p_months integer)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'closed', count(*),
    'on_time', count(*) filter (where promised is not null and f.closed_at <= promised),
    'late', count(*) filter (where promised is null or f.closed_at > promised),
    'median_days', coalesce(
      percentile_disc(0.5) within group (
        order by extract(day from (f.closed_at - f.created_at))::integer), 0))
    from public.esh_findings f
    left join lateral (
      select min(a.baseline_due_at) as promised
        from public.esh_finding_actions a where a.finding_id = f.id) b on true
   where f.organization_id = p_org
     and f.status = 'closed'
     and f.closed_at >= date_trunc('month', now()) - make_interval(months => p_months - 1);
$$;

/** Findings recorded and findings closed, month by month. */
create or replace function focus.esh_monthly_series(p_org uuid, p_months integer)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(row_to_json(m) order by m.month), '[]'::jsonb)
    from (
      select to_char(months.month, 'YYYY-MM') as month,
             (select count(*) from public.esh_findings f
               where f.organization_id = p_org
                 and date_trunc('month', f.created_at) = months.month) as opened,
             (select count(*) from public.esh_findings f
               where f.organization_id = p_org
                 and f.status = 'closed'
                 and date_trunc('month', f.closed_at) = months.month) as closed
        from generate_series(
               date_trunc('month', now()) - make_interval(months => p_months - 1),
               date_trunc('month', now()),
               interval '1 month') as months(month)) m;
$$;

-- ---------------------------------------------------------------------------
-- 3. The public dashboard
--
-- Served with no sign-in. Everything here is a count over the whole
-- organisation. There is deliberately no department, no reference, no title,
-- no owner, no location and no per-finding date, and a restricted finding is
-- not counted at all — an anonymous caller must not be able to learn that a
-- particular place or person has a safety problem.
-- ---------------------------------------------------------------------------

create or replace function public.esh_public_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  org uuid;
  v_open uuid[];
begin
  select organization_id into org from public.esh_rollout_settings limit 1;
  if org is null then
    return jsonb_build_object('ok', false, 'code', 'not_configured');
  end if;

  select coalesce(array_agg(f.id), '{}') into v_open
    from public.esh_findings f
   where f.organization_id = org
     and f.status in ('new', 'open')
     and not f.is_restricted;

  return jsonb_build_object(
    'ok', true,
    'as_of', now(),
    'open_findings', cardinality(v_open),
    'open_by_risk', (
      select coalesce(jsonb_object_agg(risk_level, n), '{}'::jsonb)
        from (select f.risk_level, count(*) as n
                from public.esh_findings f
               where f.id = any (v_open)
               group by f.risk_level) risks),
    'open_by_age', focus.esh_age_buckets(v_open),
    'overdue_actions', (
      select count(*) from public.esh_finding_actions a
       where a.finding_id = any (v_open)
         and a.state in ('assigned', 'in_progress')
         and a.due_at < now()),
    'closure', focus.esh_closure_facts(org, 6),
    'monthly', focus.esh_monthly_series(org, 6));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------

revoke all on function focus.esh_age_buckets(uuid[]) from public, anon, authenticated;
revoke all on function focus.esh_closure_facts(uuid, integer) from public, anon, authenticated;
revoke all on function focus.esh_monthly_series(uuid, integer) from public, anon, authenticated;
revoke all on function public.esh_dashboard(integer) from public, anon;
grant execute on function public.esh_dashboard(integer) to authenticated;

-- The one function in this module an anonymous caller may run. It returns
-- counts only; see the comment above section 3.
revoke all on function public.esh_public_dashboard() from public;
grant execute on function public.esh_public_dashboard() to anon, authenticated;

comment on function public.esh_dashboard is
  'The ESH dashboard (§33), in the caller''s own Finding scope.';
comment on function public.esh_public_dashboard is
  'Organisation-wide safety counts for the sign-in-free page. Aggregates only: no department, reference, title, owner, location or per-finding date, and restricted findings are excluded.';
