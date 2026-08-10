-- ---------------------------------------------------------------------------
-- v45 §37-38, §44 — "the manager has answered" and "the work is unblocked"
-- are two different facts.
--
-- Until now a barrier had one flag, `status`, doing both jobs. So a manager who
-- provided the decision they were asked for stayed on the Needs Attention list
-- until somebody closed the barrier — which cannot happen until the contractor
-- turns up, days later. Their queue filled with work they had already done.
--
-- Closing the barrier on response is the opposite mistake: the decision is
-- given, the shutdown is still unapproved, and the record would claim the work
-- was unblocked.
--
--   action_pending  does this person still owe an answer?
--   status          is the work still blocked?
--
-- A response clears the first and leaves the second alone. Needs Attention
-- reads `action_pending`; the barrier stays open until the real blocker goes.
-- ---------------------------------------------------------------------------

alter table public.barriers
  add column if not exists action_pending boolean not null default true;

comment on column public.barriers.action_pending is
  'Whether the person named in action_required_from still owes a response. '
  'Cleared by their reply. Independent of `status`, which tracks whether the '
  'work is still blocked.';

-- Existing open barriers are still awaiting their first response; resolved
-- ones plainly are not.
update public.barriers
   set action_pending = (status = 'open')
 where action_pending is distinct from (status = 'open');

-- The Needs Attention query is exactly this predicate, so it is the index.
create index if not exists barriers_action_pending_idx
  on public.barriers (action_required_from, action_pending)
  where action_pending;

-- ---------------------------------------------------------------------------
-- Responding clears the asker's obligation, transactionally, and never closes
-- the barrier (§42, §44).
-- ---------------------------------------------------------------------------

create or replace function public.post_barrier_response(
  p_barrier_id uuid,
  p_message text,
  p_expected_version integer default null,
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
  task_row public.tasks;
  response_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to respond.');
  end if;

  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then return replayed; end if;
  end if;

  -- §42.1 — reload rather than trust what the screen was showing.
  select * into barrier from public.barriers where id = p_barrier_id for update;
  if not found then
    return focus.error('not_found', 'That barrier no longer exists.');
  end if;

  -- §52 — somebody else may have resolved it while this reply was being typed.
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

  select * into task_row from public.tasks where id = barrier.task_id;

  insert into public.barrier_responses (barrier_id, author_id, message)
  values (p_barrier_id, actor, btrim(p_message))
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
      'action_pending_cleared', actor = barrier.action_required_from,
      'barrier_status', barrier.status));

  -- §43 — the person who asked hears the answer, carrying the answer itself.
  if barrier.raised_by <> actor then
    perform focus.notify(
      barrier.raised_by,
      'barrier_raised', 'immediate', true,
      case barrier.action_type
        when 'decision' then 'Decision received'
        when 'approval' then 'Approval received'
        else 'Response received'
      end,
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
    'action_pending', false,
    'barrier_status', barrier.status);

  return focus.remember_operation(actor, p_idempotency_key, 'post_barrier_response', result);
end;
$$;

revoke all on function public.post_barrier_response(uuid, text, integer, text) from public, anon;
grant execute on function public.post_barrier_response(uuid, text, integer, text) to authenticated;

-- Resolving clears both: the blocker is gone, so nobody owes anything either.
create or replace function focus.clear_action_pending_on_resolve()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resolved' and old.status <> 'resolved' then
    new.action_pending := false;
  end if;
  return new;
end;
$$;

drop trigger if exists barriers_clear_action_pending on public.barriers;
create trigger barriers_clear_action_pending
  before update of status on public.barriers
  for each row execute function focus.clear_action_pending_on_resolve();
