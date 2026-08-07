-- Existing local databases may already have the original v33 create_goal
-- function. Recreate it with explicit enum casts so PostgreSQL never resolves
-- the conditional status expressions as text.

create or replace function public.create_goal(
  p_owner_id uuid,
  p_expected_result text,
  p_success_measure text,
  p_target_date date,
  p_employee_approach text default null,
  p_support_agreed text default null,
  p_dependencies text default null,
  p_baseline text default null,
  p_purpose text default null,
  p_weight_percent integer default 0,
  p_category text default 'performance',
  p_milestones jsonb default '[]'::jsonb,
  p_activate boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  owner_profile record;
  goal_id uuid;
  goal_version_id uuid;
  milestone_count integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to create a goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  if not focus.is_manager_or_admin() or actor = p_owner_id
     or (not focus.is_admin() and not focus.is_manager_of(p_owner_id)) then
    return focus.error('not_authorised', 'Only an authorised manager can set an employee goal.');
  end if;

  select * into owner_profile from public.user_profiles
   where id = p_owner_id and status = 'active';
  if not found then return focus.error('invalid_owner', 'Select an active employee.'); end if;

  if length(btrim(coalesce(p_expected_result, ''))) = 0
     or length(btrim(coalesce(p_success_measure, ''))) = 0
     or p_target_date is null
     or p_target_date < current_date
     or p_weight_percent not between 0 and 100
     or p_category not in ('performance', 'improvement', 'development') then
    return focus.error('validation_failed', 'Add a clear result, success measure and valid target date.');
  end if;

  begin
    if jsonb_array_length(coalesce(p_milestones, '[]'::jsonb)) < 1 then
      return focus.error('validation_failed', 'Define at least one milestone together.');
    end if;
  exception when others then
    return focus.error('validation_failed', 'Milestone details are malformed.');
  end;

  goal_id := extensions.gen_random_uuid();
  goal_version_id := extensions.gen_random_uuid();

  insert into public.goals (
    id, owner_id, manager_id, created_by, title, category, status, health,
    target_date, weight_percent, checkin_due_at, active_version_id,
    pending_version_id, agreed_at
  ) values (
    goal_id, p_owner_id, actor, actor, btrim(p_expected_result), p_category,
    (case when p_activate then 'active' else 'pending_discussion' end)::public.goal_status,
    'on_track', p_target_date, p_weight_percent,
    case when p_activate then now() + interval '30 days' else null end,
    null, null, case when p_activate then now() else null end
  );

  insert into public.goal_versions (
    id, goal_id, version_number, status, title, expected_result, success_measure,
    employee_approach, support_agreed, dependencies, baseline, purpose,
    target_date, weight_percent, proposed_by, activated_at
  ) values (
    goal_version_id, goal_id, 1,
    (case when p_activate then 'active' else 'pending' end)::public.goal_version_status,
    btrim(p_expected_result), btrim(p_expected_result), btrim(p_success_measure),
    nullif(btrim(coalesce(p_employee_approach, '')), ''),
    nullif(btrim(coalesce(p_support_agreed, '')), ''),
    nullif(btrim(coalesce(p_dependencies, '')), ''),
    nullif(btrim(coalesce(p_baseline, '')), ''),
    nullif(btrim(coalesce(p_purpose, '')), ''),
    p_target_date, p_weight_percent, actor,
    case when p_activate then now() else null end
  );

  milestone_count := focus.insert_goal_milestones(goal_version_id, p_milestones);

  update public.goals
     set active_version_id = case when p_activate then goal_version_id else null end,
         pending_version_id = case when p_activate then null else goal_version_id end
   where id = goal_id;

  insert into public.goal_participants (goal_id, user_id, participant_role, added_by)
  values
    (goal_id, p_owner_id, 'employee', actor),
    (goal_id, actor, 'manager', actor);

  if p_activate then
    insert into public.goal_agreements (
      goal_id, goal_version_id, employee_id, manager_id, agreed_by,
      detail
    ) values (
      goal_id, goal_version_id, p_owner_id, actor, actor,
      jsonb_build_object('mode', 'manager_employee_discussion')
    );
  else
    perform focus.notify_goal(
      p_owner_id, 'goal_version_ready', 'immediate', true,
      'Goal ready for discussion',
      'Review the expected result, approach and milestones with your manager.',
      goal_id, actor
    );
  end if;

  perform focus.write_goal_audit(
    'goal_created', actor, goal_id, p_owner_id, 1,
    jsonb_build_object(
      'activated', p_activate,
      'milestone_count', milestone_count,
      'target_date', p_target_date,
      'weight_percent', p_weight_percent
    )
  );
  if p_activate then
    perform focus.write_goal_audit(
      'goal_version_agreed', actor, goal_id, p_owner_id, 1,
      jsonb_build_object('goal_version_id', goal_version_id, 'version_number', 1)
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', case when p_activate then 'goal_activated' else 'goal_saved_for_discussion' end,
    'goal_id', goal_id,
    'goal_version_id', goal_version_id,
    'version', 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'create_goal', result);
exception
  when check_violation or unique_violation then
    return focus.error('validation_failed', sqlerrm);
end;
$$;
