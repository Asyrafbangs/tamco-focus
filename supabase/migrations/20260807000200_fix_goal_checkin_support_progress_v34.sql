-- The retained reported-progress column accepts five-percent steps while the
-- authoritative milestone-derived value may be any integer. The support
-- workflow receives the nearest retained step; the UI continues to show the
-- exact milestone-derived value.

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
  retained_progress integer;
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
    retained_progress := greatest(
      0,
      least(100, round((milestone_result ->> 'derived_progress')::numeric / 5) * 5)
    )::integer;
    support_result := public.post_goal_update(
      p_goal_id,
      (milestone_result ->> 'version')::integer,
      retained_progress,
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
