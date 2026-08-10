-- ---------------------------------------------------------------------------
-- v44 section 14 — a barrier says who must act.
--
-- `raise_barrier` gains the two facts the form was never asking for: what KIND
-- of action is wanted, and WHO is being asked for it. Until now the procedure
-- inferred the recipient — always the owner's reporting manager — which is
-- right often enough to be invisible and wrong exactly when it matters, such as
-- a contractor decision that belongs to Engineering rather than to your line
-- manager.
--
-- It also removes a duplicate the v44 triggers introduced. The old body
-- notified the manager itself; the new `barriers_notify_action_required`
-- trigger notifies `action_required_from`. Left as they were, one barrier would
-- have produced two entries in the same person's bell — the precise noise
-- section 43 says to avoid. The trigger keeps the job, because it addresses
-- whoever was actually chosen.
-- ---------------------------------------------------------------------------

drop function if exists public.raise_barrier(
  uuid, text, text, public.barrier_impact, boolean, text);

create or replace function public.raise_barrier(
  p_task_id uuid,
  p_description text,
  p_support_needed text,
  p_impact public.barrier_impact,
  p_action_type public.barrier_action_type default 'support',
  p_action_required_from uuid default null,
  p_add_to_meeting_queue boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  task record;
  barrier_id uuid;
  recipient uuid;
  blocks_work boolean;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to raise a barrier.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_contribute_to_task(p_task_id) then
    return focus.error('not_authorised', 'You are not authorised to raise a barrier here.');
  end if;

  if length(btrim(coalesce(p_description, ''))) = 0
     or length(btrim(coalesce(p_support_needed, ''))) = 0 then
    return focus.error('validation_failed',
      'Describe what is blocking the work and what you need before sending.');
  end if;

  -- Falls back to the reporting manager, which is who the previous behaviour
  -- always chose. Naming somebody is now possible, not compulsory.
  recipient := p_action_required_from;
  if recipient is null then
    select reporting_manager_id into recipient
      from public.user_profiles where id = task.primary_owner_id;
  end if;

  -- You may only ask somebody you are authorised to reach. Otherwise the form
  -- would be a way to put an item on a stranger's list.
  --
  -- `can_view_user` answers "may I see this person's work", which runs
  -- downwards: a manager sees their reports. Asking runs the other way — the
  -- commonest barrier in the product is an employee asking their own manager
  -- for a decision — so the reporting line is checked explicitly in both
  -- directions. Using visibility alone here would have blocked the main case.
  if recipient is not null
     and recipient <> actor
     and not focus.can_view_user(recipient)
     and recipient is distinct from (
       select reporting_manager_id from public.user_profiles where id = actor)
     and recipient is distinct from (
       select reporting_manager_id from public.user_profiles where id = task.primary_owner_id)
  then
    return focus.error('not_authorised',
      'You can only ask your manager or somebody your visibility settings cover.');
  end if;

  insert into public.barriers (
    task_id, description, support_needed, impact, action_type,
    action_required_from, add_to_meeting_queue, raised_by
  ) values (
    p_task_id, p_description, p_support_needed, p_impact, p_action_type,
    recipient, p_add_to_meeting_queue, actor
  )
  returning id into barrier_id;

  blocks_work := p_impact = 'cannot_continue';

  -- Section 14.3 / v44 section 25 — pause only when work genuinely cannot
  -- continue. "May be delayed" is a risk, not a stop, and pausing on it would
  -- hand back a focus slot the person is still using.
  if blocks_work and task.status = 'active' then
    update public.tasks
       set status = 'paused',
           paused_reason = format('Blocked: %s', p_description),
           over_focus_target = false,
           last_meaningful_update_at = now(),
           version = version + 1
     where id = p_task_id;

    perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);
  else
    update public.tasks
       set last_meaningful_update_at = now(), version = version + 1
     where id = p_task_id;
  end if;

  if p_add_to_meeting_queue then
    insert into public.meeting_queue_items (task_id, barrier_id, source, summary)
    values (p_task_id, barrier_id, 'barrier',
            format('%s — %s', task.title, p_description))
    on conflict do nothing;
  end if;

  -- The recipient's notification is written by
  -- `barriers_notify_action_required`, in this same transaction. It is not
  -- repeated here.
  --
  -- The owner still hears about it when somebody else raised it on their work,
  -- because it is their result and it may now be paused.
  if task.primary_owner_id <> actor and task.primary_owner_id <> recipient then
    perform focus.notify(
      task.primary_owner_id, 'barrier_raised', 'immediate', true,
      'Barrier raised on your work',
      format('%s raised a barrier on "%s".',
             (select full_name from public.user_profiles where id = actor), task.title),
      p_task_id, barrier_id, actor);
  end if;

  event_id := focus.write_audit(
    p_event_type := 'barrier_raised',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := case when blocks_work and task.status = 'active'
                         then 'paused'::public.task_status else task.status end,
    p_detail := jsonb_build_object(
      'barrier_id', barrier_id,
      'impact', p_impact,
      'action_type', p_action_type,
      'action_required_from', recipient,
      'paused_task', blocks_work)
  );

  result := jsonb_build_object('ok', true, 'code', 'barrier_raised',
                               'barrier_id', barrier_id,
                               'task_paused', blocks_work and task.status = 'active',
                               'task', focus.task_snapshot(p_task_id),
                               'audit_event_id', event_id);
  return focus.remember_operation(actor, p_idempotency_key, 'raise_barrier', result);
end;
$$;

revoke all on function public.raise_barrier(
  uuid, text, text, public.barrier_impact, public.barrier_action_type,
  uuid, boolean, text) from public, anon;
grant execute on function public.raise_barrier(
  uuid, text, text, public.barrier_impact, public.barrier_action_type,
  uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Posting a response (section 16). Explicitly NOT a resolution.
-- ---------------------------------------------------------------------------

create or replace function public.post_barrier_response(
  p_barrier_id uuid,
  p_message text,
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
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to respond.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into barrier from public.barriers where id = p_barrier_id;
  if not found then return focus.error('not_found', 'That barrier no longer exists.'); end if;

  if not focus.can_contribute_to_task(barrier.task_id)
     and barrier.action_required_from <> actor then
    return focus.error('not_authorised', 'You are not authorised to respond to this barrier.');
  end if;

  if length(btrim(coalesce(p_message, ''))) = 0 then
    return focus.error('validation_failed', 'Write a response before sending.');
  end if;

  insert into public.barrier_responses (barrier_id, author_id, message)
  values (p_barrier_id, actor, btrim(p_message))
  returning id into response_id;

  -- The barrier stays OPEN. Saying "I will confirm by 3pm" removes nothing:
  -- the shutdown is still unapproved and the work is still blocked. Only
  -- resolving it says the blocker is gone.
  perform focus.notify(
    case when actor = barrier.raised_by then barrier.action_required_from
         else barrier.raised_by end,
    'barrier_raised', 'immediate', false,
    'Response on a barrier',
    format('%s replied: %s',
           (select full_name from public.user_profiles where id = actor),
           left(btrim(p_message), 160)),
    barrier.task_id, p_barrier_id, actor);

  perform focus.write_audit(
    p_event_type := 'barrier_response_posted',
    p_actor_id := actor,
    p_task_id := barrier.task_id,
    p_detail := jsonb_build_object('barrier_id', p_barrier_id, 'response_id', response_id));

  result := jsonb_build_object('ok', true, 'code', 'barrier_response_posted',
                               'response_id', response_id);
  return focus.remember_operation(actor, p_idempotency_key, 'post_barrier_response', result);
end;
$$;

revoke all on function public.post_barrier_response(uuid, text, text) from public, anon;
grant execute on function public.post_barrier_response(uuid, text, text) to authenticated;
