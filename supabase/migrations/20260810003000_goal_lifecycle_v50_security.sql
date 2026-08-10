-- TAMCO Focus v50 - Goal lifecycle permissions and RLS.

create or replace function focus.can_submit_goal_monthly(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
    from public.goals g
    where g.id = target_goal_id
      and g.owner_id = auth.uid()
      and g.status = 'active'
  );
$$;

create or replace function focus.can_prepare_goal_quarterly(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
    from public.goals g
    where g.id = target_goal_id
      and g.owner_id = auth.uid()
      and g.status = 'active'
  );
$$;

create or replace function focus.can_complete_goal_quarterly(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.can_agree_goal(target_goal_id) and exists (
    select 1 from public.goals g
    where g.id = target_goal_id and g.status = 'active'
  );
$$;

create or replace function focus.can_save_goal_year_end(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
    from public.goals g
    where g.id = target_goal_id
      and g.status in ('active', 'completed')
      and (g.owner_id = auth.uid() or focus.can_agree_goal(g.id))
  );
$$;

alter table public.goal_success_measures enable row level security;
alter table public.goal_check_ins enable row level security;
alter table public.goal_success_measure_updates enable row level security;

create policy goal_success_measures_select on public.goal_success_measures
  for select to authenticated
  using (
    exists (
      select 1
      from public.goal_versions gv
      where gv.id = goal_version_id
        and focus.can_view_goal(gv.goal_id)
    )
  );

create policy goal_check_ins_select on public.goal_check_ins
  for select to authenticated
  using (focus.can_view_goal(goal_id));

create policy goal_success_measure_updates_select on public.goal_success_measure_updates
  for select to authenticated
  using (focus.can_view_goal(goal_id));

revoke all on public.goal_success_measures,
  public.goal_check_ins,
  public.goal_success_measure_updates from anon, authenticated;

grant select on public.goal_success_measures,
  public.goal_check_ins,
  public.goal_success_measure_updates to authenticated;

grant all on public.goal_success_measures,
  public.goal_check_ins,
  public.goal_success_measure_updates to service_role;

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
        'can_view', false,
        'can_update', false,
        'can_edit_structure', false,
        'can_agree', false,
        'can_submit_monthly', false,
        'can_prepare_quarterly', false,
        'can_complete_quarterly', false,
        'can_save_year_end', false
      )
    else jsonb_build_object(
      'can_view', true,
      'can_update', focus.can_update_goal(p_goal_id),
      'can_edit_structure', focus.can_edit_goal_structure(p_goal_id),
      'can_agree', focus.can_agree_goal(p_goal_id),
      'can_submit_monthly', focus.can_submit_goal_monthly(p_goal_id),
      'can_prepare_quarterly', focus.can_prepare_goal_quarterly(p_goal_id),
      'can_complete_quarterly', focus.can_complete_goal_quarterly(p_goal_id),
      'can_save_year_end', focus.can_save_goal_year_end(p_goal_id)
    )
  end;
$$;

revoke all on function public.get_goal_capabilities(uuid) from public;
grant execute on function public.get_goal_capabilities(uuid) to authenticated;
