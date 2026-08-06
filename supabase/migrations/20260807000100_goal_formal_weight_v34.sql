-- v34: keep the public Goal operation contracts unchanged while making the
-- 100% formal-weight rule authoritative and concurrency-safe.

alter function public.create_goal(
  uuid, text, text, date, text, text, text, text, text, integer, text, jsonb, boolean, text
) rename to create_goal_v33_internal;

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
  replayed jsonb;
  active_weight integer;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to create a goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  if p_activate then
    if not focus.is_manager_or_admin() or actor = p_owner_id
       or (not focus.is_admin() and not focus.is_manager_of(p_owner_id)) then
      return focus.error('not_authorised', 'Only an authorised manager can set an employee goal.');
    end if;

    perform pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 34));
    select coalesce(sum(weight_percent), 0)::integer
      into active_weight
      from public.goals
     where owner_id = p_owner_id
       and status = 'active';

    if active_weight + p_weight_percent > 100 then
      return focus.error(
        'invalid_target',
        format(
          'Active Goal weight would become %s%%. Reduce the weight or save the Goal for discussion.',
          active_weight + p_weight_percent
        )
      );
    end if;
  end if;

  return public.create_goal_v33_internal(
    p_owner_id,
    p_expected_result,
    p_success_measure,
    p_target_date,
    p_employee_approach,
    p_support_agreed,
    p_dependencies,
    p_baseline,
    p_purpose,
    p_weight_percent,
    p_category,
    p_milestones,
    p_activate,
    p_idempotency_key
  );
end;
$$;

alter function public.agree_goal_version(uuid, uuid, integer, text)
  rename to agree_goal_version_v33_internal;

create or replace function public.agree_goal_version(
  p_goal_id uuid,
  p_pending_version_id uuid,
  p_expected_version integer,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  replayed jsonb;
  goal_owner_id uuid;
  pending_weight integer;
  active_weight integer;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to agree Goal changes.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  if not focus.can_agree_goal(p_goal_id) then
    return focus.error('not_authorised', 'Only the authorised manager can agree Goal changes.');
  end if;

  select g.owner_id, v.weight_percent
    into goal_owner_id, pending_weight
    from public.goals g
    join public.goal_versions v
      on v.id = p_pending_version_id
     and v.goal_id = g.id
     and v.status = 'pending'
   where g.id = p_goal_id;

  if found then
    perform pg_advisory_xact_lock(hashtextextended(goal_owner_id::text, 34));
    select coalesce(sum(weight_percent), 0)::integer
      into active_weight
      from public.goals
     where owner_id = goal_owner_id
       and status = 'active'
       and id <> p_goal_id;

    if active_weight + pending_weight > 100 then
      return focus.error(
        'invalid_target',
        format(
          'Active Goal weight would become %s%%. Reduce the pending weight before agreement.',
          active_weight + pending_weight
        )
      );
    end if;
  end if;

  return public.agree_goal_version_v33_internal(
    p_goal_id,
    p_pending_version_id,
    p_expected_version,
    p_idempotency_key
  );
end;
$$;

revoke all on function public.create_goal_v33_internal(
  uuid, text, text, date, text, text, text, text, text, integer, text, jsonb, boolean, text
) from public, anon, authenticated;
revoke all on function public.agree_goal_version_v33_internal(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.create_goal(
  uuid, text, text, date, text, text, text, text, text, integer, text, jsonb, boolean, text
) from public;
revoke all on function public.agree_goal_version(uuid, uuid, integer, text) from public;
grant execute on function public.create_goal(
  uuid, text, text, date, text, text, text, text, text, integer, text, jsonb, boolean, text
) to authenticated;
grant execute on function public.agree_goal_version(uuid, uuid, integer, text) to authenticated;

comment on function public.create_goal(
  uuid, text, text, date, text, text, text, text, text, integer, text, jsonb, boolean, text
) is 'Creates discussion Goals or activates a Goal when the owner formal weight remains at or below 100%.';
comment on function public.agree_goal_version(uuid, uuid, integer, text)
  is 'Agrees a pending Goal version when the owner formal weight remains at or below 100%.';

create or replace function public.post_goal_milestone_checkin(
  p_goal_id uuid,
  p_milestone_id uuid,
  p_expected_version integer,
  p_progress integer,
  p_comment text,
  p_what_changed text,
  p_next_step text default null,
  p_support_requested boolean default false,
  p_support_details text default null,
  p_mark_complete boolean default false,
  p_attachments jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  replayed jsonb;
  milestone_result jsonb;
  support_result jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to update a milestone.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  milestone_result := public.post_goal_milestone_update(
    p_goal_id,
    p_milestone_id,
    p_expected_version,
    p_progress,
    p_comment,
    p_mark_complete,
    p_attachments,
    p_idempotency_key || ':milestone'
  );
  if not coalesce((milestone_result ->> 'ok')::boolean, false) then
    return milestone_result;
  end if;

  if p_support_requested then
    support_result := public.post_goal_update(
      p_goal_id,
      (milestone_result ->> 'version')::integer,
      (milestone_result ->> 'derived_progress')::integer,
      p_what_changed,
      p_next_step,
      true,
      p_support_details,
      '[]'::jsonb,
      p_idempotency_key || ':support'
    );
    if not coalesce((support_result ->> 'ok')::boolean, false) then
      raise exception 'Milestone support request failed: %',
        coalesce(support_result ->> 'message', 'unknown error');
    end if;
  end if;

  result := milestone_result || jsonb_build_object(
    'support_requested', p_support_requested,
    'support_request_update_id', support_result ->> 'goal_update_id'
  );
  return focus.remember_operation(actor, p_idempotency_key, 'post_goal_milestone_checkin', result);
end;
$$;

revoke all on function public.post_goal_milestone_checkin(
  uuid, uuid, integer, integer, text, text, text, boolean, text, boolean, jsonb, text
) from public;
grant execute on function public.post_goal_milestone_checkin(
  uuid, uuid, integer, integer, text, text, text, boolean, text, boolean, jsonb, text
) to authenticated;

comment on function public.post_goal_milestone_checkin(
  uuid, uuid, integer, integer, text, text, text, boolean, text, boolean, jsonb, text
) is 'Atomically saves a milestone update and, when requested, uses the existing Goal support notification workflow.';
