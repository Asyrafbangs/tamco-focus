-- v50: requesting an owner update is not a Goal-health change and must not
-- create work in the requesting manager's own attention queue.
create or replace function public.request_goal_update(
  p_goal_id uuid,
  p_expected_version integer,
  p_message text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal record;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to request an update.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into goal
  from public.goals
  where id = p_goal_id
  for update;

  if not found then
    return focus.error('not_found', 'This goal no longer exists.');
  end if;
  if not focus.can_agree_goal(p_goal_id) then
    return focus.error('not_authorised', 'Only the authorised manager can request a Goal update.');
  end if;
  if goal.status <> 'active' then
    return focus.error('invalid_state', 'Only an active Goal can receive an update request.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error('version_conflict', 'This goal changed. Review it and try again.');
  end if;

  update public.goals
  set update_requested_at = now(),
      version = version + 1
  where id = p_goal_id;

  perform focus.notify_goal(
    goal.owner_id,
    'goal_update_requested',
    'immediate',
    true,
    'Goal update requested',
    coalesce(
      nullif(btrim(coalesce(p_message, '')), ''),
      'Your manager requested a progress update for ' || goal.title || '.'
    ),
    p_goal_id,
    actor
  );
  perform focus.write_goal_audit(
    'goal_update_requested',
    actor,
    p_goal_id,
    goal.owner_id,
    goal.version + 1,
    jsonb_build_object('message', nullif(btrim(coalesce(p_message, '')), ''))
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'goal_update_requested',
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'request_goal_update', result);
end;
$$;
