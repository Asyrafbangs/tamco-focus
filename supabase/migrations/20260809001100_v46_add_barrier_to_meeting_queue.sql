-- ---------------------------------------------------------------------------
-- v46 sections 19, 46 — put this barrier on the meeting agenda, once.
--
-- Idempotency here is not about double-clicks alone. A manager may reasonably
-- press this today, forget, and press it again next week; the agenda should
-- carry the item once either way. So the uniqueness is asserted against the
-- barrier itself rather than against a request key, and the second call
-- reports the existing item rather than failing.
-- ---------------------------------------------------------------------------

create unique index if not exists meeting_queue_items_open_barrier_idx
  on public.meeting_queue_items (barrier_id)
  where barrier_id is not null and status = 'open';

create or replace function public.add_barrier_to_meeting_queue(
  p_barrier_id uuid,
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
  existing public.meeting_queue_items;
  item_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to do this.');
  end if;

  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then return replayed; end if;
  end if;

  select * into barrier from public.barriers where id = p_barrier_id;
  if not found then
    return focus.error('not_found', 'That barrier no longer exists.');
  end if;

  if barrier.status <> 'open' then
    return focus.error('invalid_state',
      'This barrier has been resolved. There is nothing left to discuss.');
  end if;

  -- The people who may put it on an agenda are the people already entitled to
  -- act on it: whoever was asked, and anyone who can contribute to the work.
  if barrier.action_required_from is distinct from actor
     and not focus.can_contribute_to_task(barrier.task_id)
     and not focus.can_edit_task(barrier.task_id) then
    return focus.error('not_authorised', 'You are not authorised to raise this for discussion.');
  end if;

  select * into existing
    from public.meeting_queue_items
   where barrier_id = p_barrier_id and status = 'open'
   limit 1;

  if found then
    result := jsonb_build_object('ok', true, 'code', 'meeting_queue_item_exists',
                                 'item_id', existing.id, 'already_queued', true);
    return focus.remember_operation(actor, p_idempotency_key,
                                    'add_barrier_to_meeting_queue', result);
  end if;

  select * into task_row from public.tasks where id = barrier.task_id;

  -- The agenda line says what is to be decided, not "barrier on TASK-124".
  insert into public.meeting_queue_items (task_id, barrier_id, source, summary)
  values (barrier.task_id, p_barrier_id, 'barrier', btrim(barrier.support_needed))
  returning id into item_id;

  perform focus.write_audit(
    p_event_type := 'barrier_added_to_meeting_queue',
    p_actor_id := actor,
    p_task_id := barrier.task_id,
    p_detail := jsonb_build_object(
      'barrier_id', p_barrier_id,
      'meeting_queue_item_id', item_id,
      'summary', btrim(barrier.support_needed)));

  result := jsonb_build_object('ok', true, 'code', 'meeting_queue_item_added',
                               'item_id', item_id, 'already_queued', false);
  return focus.remember_operation(actor, p_idempotency_key,
                                  'add_barrier_to_meeting_queue', result);
end;
$$;

revoke all on function public.add_barrier_to_meeting_queue(uuid, text) from public, anon;
grant execute on function public.add_barrier_to_meeting_queue(uuid, text) to authenticated;
