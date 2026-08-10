-- ---------------------------------------------------------------------------
-- v47 §17, §48 — a topic removed from the queue can be put back.
--
-- `meeting_queue_items_barrier_unique` has always allowed one row per barrier,
-- full stop, which was right when the only states were open and decided. With
-- a `removed` state it means a manager who tidies a topic away can never queue
-- that request again: the insert hits the constraint and the button reports a
-- database error.
--
-- The constraint stays — one barrier really should own one agenda line, and
-- keeping the row keeps its history. Re-queueing therefore revives the row it
-- already has instead of writing a second one. My earlier partial index is
-- redundant beside the original and is dropped rather than left to imply a
-- rule it no longer enforces alone.
-- ---------------------------------------------------------------------------

drop index if exists public.meeting_queue_items_active_barrier_idx;

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

  select * into barrier from public.barriers where id = p_barrier_id for update;
  if not found then
    return focus.error('not_found', 'That request no longer exists.');
  end if;

  if barrier.status <> 'open' then
    return focus.error('invalid_state',
      'This barrier has been resolved. There is nothing left to discuss.');
  end if;

  -- §45 — the person being asked decides that their answer needs a
  -- conversation. Anyone who can edit the work may also arrange one.
  if barrier.action_required_from is distinct from actor
     and not focus.can_edit_task(barrier.task_id) then
    return focus.error('not_authorised', 'You are not authorised to raise this for discussion.');
  end if;

  select * into existing
    from public.meeting_queue_items
   where barrier_id = p_barrier_id
   for update;

  if found then
    if existing.status in ('open', 'queued', 'scheduled') then
      result := jsonb_build_object('ok', true, 'code', 'meeting_queue_item_exists',
                                   'item_id', existing.id, 'already_queued', true);
      return focus.remember_operation(actor, p_idempotency_key,
                                      'add_barrier_to_meeting_queue', result);
    end if;

    -- Previously removed, or decided and raised again: the same topic returns
    -- to the agenda, carrying its own history rather than starting a new one.
    update public.meeting_queue_items
       set status = 'queued',
           summary = btrim(barrier.support_needed),
           added_by = actor,
           requested_by = barrier.raised_by,
           scheduled_event_id = null
     where id = existing.id;

    item_id := existing.id;
  else
    insert into public.meeting_queue_items
      (task_id, barrier_id, source, summary, status, added_by, requested_by)
    values
      (barrier.task_id, p_barrier_id, 'barrier', btrim(barrier.support_needed),
       'queued', actor, barrier.raised_by)
    returning id into item_id;
  end if;

  perform focus.write_audit(
    p_event_type := 'barrier_added_to_meeting_queue',
    p_actor_id := actor,
    p_task_id := barrier.task_id,
    p_detail := jsonb_build_object(
      'barrier_id', p_barrier_id,
      'meeting_queue_item_id', item_id,
      'summary', btrim(barrier.support_needed)));

  -- §29 — deliberately does NOT touch `action_pending`. Agreeing to talk about
  -- a decision is not making it.
  result := jsonb_build_object('ok', true, 'code', 'meeting_queue_item_added',
                               'item_id', item_id, 'already_queued', false);
  return focus.remember_operation(actor, p_idempotency_key,
                                  'add_barrier_to_meeting_queue', result);
end;
$$;

revoke all on function public.add_barrier_to_meeting_queue(uuid, text) from public, anon;
grant execute on function public.add_barrier_to_meeting_queue(uuid, text) to authenticated;
