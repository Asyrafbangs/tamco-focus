-- ---------------------------------------------------------------------------
-- v45 sections 41-45 — the reply carries its answer, and says so plainly to
-- the person who asked.
--
-- Supersedes the version in 20260808008000. The behaviour that matters is
-- unchanged and re-stated here rather than patched: a reply clears the named
-- person's obligation and never closes the barrier, because "the manager has
-- answered" and "the work is unblocked" are different facts.
-- ---------------------------------------------------------------------------

create or replace function public.post_barrier_response(
  p_barrier_id uuid,
  p_message text,
  p_expected_version integer default null,
  p_kind public.barrier_response_kind default 'answer',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  barrier public.barriers;
  response_id uuid;
  replayed jsonb;
  result jsonb;
  headline text;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to respond.');
  end if;

  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then return replayed; end if;
  end if;

  -- Section 42.1 — reload rather than trust what the screen was showing.
  select * into barrier from public.barriers where id = p_barrier_id for update;
  if not found then
    return focus.error('not_found', 'That barrier no longer exists.');
  end if;

  -- Section 52 — somebody may have resolved it while this reply was typed.
  if barrier.status <> 'open' then
    return focus.error('invalid_state',
      'This barrier has already been resolved. Review the latest activity before responding.');
  end if;

  if p_expected_version is not null and barrier.version <> p_expected_version then
    return focus.error('version_conflict',
      'This barrier changed while you were writing. Reopen it and try again.');
  end if;

  if barrier.action_required_from is distinct from actor
     and not focus.can_contribute_to_task(barrier.task_id) then
    return focus.error('not_authorised', 'You are not authorised to respond to this barrier.');
  end if;

  if length(btrim(coalesce(p_message, ''))) = 0 then
    return focus.error('validation_failed', 'Write a response before sending.');
  end if;

  -- Approving something nobody asked you to approve is not a coherent answer,
  -- and would make the record claim an authority the request never invoked.
  if p_kind <> 'answer' and barrier.action_type <> 'approval' then
    return focus.error('validation_failed',
      'This request did not ask for an approval decision.');
  end if;

  insert into public.barrier_responses (barrier_id, author_id, message, kind)
  values (p_barrier_id, actor, btrim(p_message), p_kind)
  returning id into response_id;

  -- The asked-for action is done. The blocker is not necessarily gone, so
  -- `status` is deliberately untouched.
  update public.barriers
     set action_pending = case when actor = barrier.action_required_from
                               then false else action_pending end,
         version = version + 1
   where id = p_barrier_id;

  perform focus.write_audit(
    p_event_type := 'barrier_response_posted',
    p_actor_id := actor,
    p_task_id := barrier.task_id,
    p_detail := jsonb_build_object(
      'barrier_id', p_barrier_id,
      'response_id', response_id,
      'action_type', barrier.action_type,
      'response_kind', p_kind,
      'action_pending_cleared', actor = barrier.action_required_from,
      'barrier_status', barrier.status));

  -- Section 43 — the person who asked hears the answer, and the headline is
  -- the answer, not the fact that something arrived.
  headline := case
    when p_kind = 'approved' then 'Approved'
    when p_kind = 'changes_requested' then 'Changes requested'
    when barrier.action_type = 'decision' then 'Decision received'
    when barrier.action_type = 'approval' then 'Approval received'
    else 'Response received'
  end;

  if barrier.raised_by <> actor then
    perform focus.notify(
      barrier.raised_by,
      'barrier_raised', 'immediate', true,
      headline,
      format('%s: %s',
             (select full_name from public.user_profiles where id = actor),
             left(btrim(p_message), 180)),
      barrier.task_id, p_barrier_id, actor);

    update public.notifications
       set entity_type = 'barrier', entity_id = p_barrier_id
     where recipient_id = barrier.raised_by and barrier_id = p_barrier_id;
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', 'barrier_response_posted',
    'response_id', response_id,
    'response_kind', p_kind,
    'action_pending', false,
    'barrier_status', barrier.status);

  return focus.remember_operation(actor, p_idempotency_key, 'post_barrier_response', result);
end;
$$;

-- The four-argument shape is gone: leaving it callable would leave a second
-- copy of this logic reachable, and the two would drift.
drop function if exists public.post_barrier_response(uuid, text, integer, text);

revoke all on function public.post_barrier_response(
  uuid, text, integer, public.barrier_response_kind, text) from public, anon;
grant execute on function public.post_barrier_response(
  uuid, text, integer, public.barrier_response_kind, text) to authenticated;
