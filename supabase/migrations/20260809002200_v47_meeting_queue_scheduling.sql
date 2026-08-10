-- ---------------------------------------------------------------------------
-- v47 §18-19, §25 — the queue item grows a lifecycle and a booking.
--
-- It already recorded that a barrier needed discussing. It could not say who
-- put it there, who was waiting on the answer, or whether a date had been
-- agreed — all of which the Meeting Queue drawer has to show before somebody
-- can decide what to schedule next.
-- ---------------------------------------------------------------------------

alter table public.meeting_queue_items
  add column if not exists added_by uuid references public.user_profiles (id),
  add column if not exists requested_by uuid references public.user_profiles (id),
  add column if not exists scheduled_event_id uuid references public.calendar_events (id)
    on delete set null;

comment on column public.meeting_queue_items.scheduled_event_id is
  'The booked discussion, once a date exists. Null while the item is queued: '
  'needing a discussion and having agreed a time are different facts (v47 §28).';

-- Existing barrier items predate these columns; fill them from the barrier.
update public.meeting_queue_items item
   set added_by = coalesce(item.added_by, barrier.action_required_from),
       requested_by = coalesce(item.requested_by, barrier.raised_by)
  from public.barriers barrier
 where barrier.id = item.barrier_id
   and (item.added_by is null or item.requested_by is null);

-- Items created before v47 used 'open'; the lifecycle now names the stage.
update public.meeting_queue_items
   set status = 'queued'
 where status = 'open' and barrier_id is not null;

-- §48 — one live queue entry per barrier, whatever route creates it. The v46
-- index only knew about 'open'.
drop index if exists public.meeting_queue_items_open_barrier_idx;
create unique index if not exists meeting_queue_items_active_barrier_idx
  on public.meeting_queue_items (barrier_id)
  where barrier_id is not null and status in ('open', 'queued', 'scheduled');

-- ---------------------------------------------------------------------------
-- Queueing (§19), rewritten for the new lifecycle.
-- ---------------------------------------------------------------------------

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
     and status in ('open', 'queued', 'scheduled')
   limit 1;

  if found then
    result := jsonb_build_object('ok', true, 'code', 'meeting_queue_item_exists',
                                 'item_id', existing.id, 'already_queued', true);
    return focus.remember_operation(actor, p_idempotency_key,
                                    'add_barrier_to_meeting_queue', result);
  end if;

  insert into public.meeting_queue_items
    (task_id, barrier_id, source, summary, status, added_by, requested_by)
  values
    (barrier.task_id, p_barrier_id, 'barrier', btrim(barrier.support_needed),
     'queued', actor, barrier.raised_by)
  returning id into item_id;

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

-- ---------------------------------------------------------------------------
-- Scheduling (§25).
-- ---------------------------------------------------------------------------

create or replace function public.schedule_meeting_queue_item(
  p_item_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer default 30,
  p_participant_ids uuid[] default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  item public.meeting_queue_items;
  barrier public.barriers;
  new_event_id uuid;
  participant uuid;
  participants uuid[];
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to schedule this.');
  end if;

  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then return replayed; end if;
  end if;

  select * into item from public.meeting_queue_items where id = p_item_id for update;
  if not found then
    return focus.error('not_found', 'That queue item no longer exists.');
  end if;

  -- §50 — somebody else may have booked it while this form was open. Report
  -- the booking that exists rather than making a second one.
  if item.scheduled_event_id is not null then
    result := jsonb_build_object('ok', true, 'code', 'discussion_already_scheduled',
                                 'item_id', p_item_id, 'event_id', item.scheduled_event_id);
    return focus.remember_operation(actor, p_idempotency_key,
                                    'schedule_meeting_queue_item', result);
  end if;

  if item.status = 'removed' then
    return focus.error('invalid_state', 'That topic was removed from the queue.');
  end if;

  if item.task_id is not null
     and not focus.can_view_task(item.task_id) then
    return focus.error('not_authorised', 'You are not authorised to schedule this discussion.');
  end if;

  if p_starts_at is null then
    return focus.error('validation_failed', 'Choose a date and time for the discussion.');
  end if;

  if coalesce(p_duration_minutes, 0) <= 0 or p_duration_minutes > 480 then
    return focus.error('validation_failed', 'Choose a length between 1 and 480 minutes.');
  end if;

  if item.barrier_id is not null then
    select * into barrier from public.barriers where id = item.barrier_id;
  end if;

  /*
   * §23 — the two people the discussion is actually about are in it by
   * default. Asking the organiser to add the requester and themselves every
   * time is asking them to retype what the request already says.
   */
  participants := coalesce(p_participant_ids, array[]::uuid[]);
  participants := participants || actor;
  if barrier.id is not null then
    participants := participants || barrier.raised_by;
    if barrier.action_required_from is not null then
      participants := participants || barrier.action_required_from;
    end if;
  end if;

  insert into public.calendar_events
    (title, starts_at, ends_at, source_type, source_id, task_id, barrier_id, created_by)
  values
    (item.summary,
     p_starts_at,
     p_starts_at + make_interval(mins => p_duration_minutes),
     'meeting_queue', p_item_id, item.task_id, item.barrier_id, actor)
  returning id into new_event_id;

  foreach participant in array participants loop
    if participant is not null
       and exists (select 1 from public.user_profiles
                    where id = participant and status = 'active') then
      insert into public.calendar_event_participants (event_id, user_id)
      values (new_event_id, participant)
      on conflict do nothing;
    end if;
  end loop;

  update public.meeting_queue_items
     set status = 'scheduled', scheduled_event_id = new_event_id
   where id = p_item_id;

  perform focus.write_audit(
    p_event_type := 'discussion_scheduled',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_detail := jsonb_build_object(
      'meeting_queue_item_id', p_item_id,
      'calendar_event_id', new_event_id,
      'barrier_id', item.barrier_id,
      'starts_at', p_starts_at));

  -- §38 — a date is news the participants need. Queueing alone was not.
  for participant in
    select user_id from public.calendar_event_participants where event_id = new_event_id
  loop
    if participant <> actor then
      perform focus.notify(
        participant,
        'barrier_raised', 'immediate', false,
        'Discussion scheduled',
        format('%s · %s', item.summary,
               to_char(p_starts_at at time zone 'Asia/Kuala_Lumpur', 'DD Mon HH24:MI')),
        item.task_id, item.barrier_id, actor);
    end if;
  end loop;

  -- §29 — still not an answer. `action_pending` is untouched.
  result := jsonb_build_object('ok', true, 'code', 'discussion_scheduled',
                               'item_id', p_item_id, 'event_id', new_event_id);
  return focus.remember_operation(actor, p_idempotency_key,
                                  'schedule_meeting_queue_item', result);
end;
$$;

revoke all on function public.schedule_meeting_queue_item(
  uuid, timestamptz, integer, uuid[], text) from public, anon;
grant execute on function public.schedule_meeting_queue_item(
  uuid, timestamptz, integer, uuid[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- Removing a topic (§17, §60).
-- ---------------------------------------------------------------------------

create or replace function public.remove_meeting_queue_item(
  p_item_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  item public.meeting_queue_items;
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

  select * into item from public.meeting_queue_items where id = p_item_id for update;
  if not found then
    result := jsonb_build_object('ok', true, 'code', 'meeting_queue_item_removed',
                                 'item_id', p_item_id);
    return focus.remember_operation(actor, p_idempotency_key,
                                    'remove_meeting_queue_item', result);
  end if;

  if item.added_by is distinct from actor
     and not (item.task_id is not null and focus.can_edit_task(item.task_id))
     and not focus.is_admin() then
    return focus.error('not_authorised', 'Only the person who queued this topic can remove it.');
  end if;

  -- A booked discussion is an appointment in other people's days. Cancelling
  -- it is a separate act from tidying the queue, so this refuses rather than
  -- silently dropping the event.
  if item.scheduled_event_id is not null then
    return focus.error('invalid_state',
      'This topic already has a scheduled discussion. Cancel the discussion first.');
  end if;

  update public.meeting_queue_items set status = 'removed' where id = p_item_id;

  perform focus.write_audit(
    p_event_type := 'meeting_queue_item_removed',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_detail := jsonb_build_object(
      'meeting_queue_item_id', p_item_id,
      'barrier_id', item.barrier_id));

  result := jsonb_build_object('ok', true, 'code', 'meeting_queue_item_removed',
                               'item_id', p_item_id);
  return focus.remember_operation(actor, p_idempotency_key,
                                  'remove_meeting_queue_item', result);
end;
$$;

revoke all on function public.remove_meeting_queue_item(uuid, text) from public, anon;
grant execute on function public.remove_meeting_queue_item(uuid, text) to authenticated;
