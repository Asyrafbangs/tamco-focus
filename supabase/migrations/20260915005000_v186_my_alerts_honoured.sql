-- ============================================================================
-- TAMCO Focus v186 — My Alerts, honoured
--
-- My Alerts has offered five switches since the first build. v185 wired
-- "Due-today and selection deadlines". Nothing read the other four, so
-- switching one off still sent every notice and every email.
--
-- 1. "Barrier or support involving me", "Assignment and reassignment" and
--    "Collaborative handoff" now stop the EMAIL for the notices they name. The
--    notice is still written to the bell, quiet (v158), so the outbox queues
--    nothing for it. Each of these asks somebody to act: the bell entry is the
--    written explanation §23.4 requires of the red count, and v161 reads the
--    unread assignment notice to avoid sending one more notice per step.
--    "Due-today and selection deadlines" keeps v185's rule and sends nothing,
--    because My Day's Needs attention already lists late work.
-- 2. No switch silences a barrier about a safety or compliance risk, or any
--    notice about mandatory work (§23.2). That now includes the deadline
--    notices, which v185 did not exempt.
-- 3. "Routine work coming up" governs nothing: no procedure, trigger or job
--    writes a `routine_upcoming` notice. My Alerts stops offering it; the
--    stored value is kept.
-- ============================================================================

comment on column public.user_alert_preferences.barrier_involving_me is
  'v186 - off: barrier and Goal support notices are bell-only (quiet), not emailed. Never for a safety_or_compliance_risk barrier or mandatory work.';
comment on column public.user_alert_preferences.assignment_changes is
  'v186 - off: assigned, reassigned and routine follow-up work notices are bell-only (quiet), not emailed. Never for mandatory work.';
comment on column public.user_alert_preferences.collaboration_handoff is
  'v186 - off: step assigned, ready, reassigned, withdrawn and removed notices are bell-only (quiet), not emailed. Never for mandatory work.';
comment on column public.user_alert_preferences.due_today_and_deadlines is
  'v185 - off: overdue and due-date-moved notices are not written at all. v186 - never for mandatory work.';
comment on column public.user_alert_preferences.routine_upcoming is
  'Governs nothing: no notice of kind routine_upcoming is written. Not offered in My Alerts since v186.';

-- ---------------------------------------------------------------------------
-- Whether a person wants the alert a notice answers to.
--
-- No alert — a notice no switch may stop — and no preferences row both mean
-- yes, which is every switch's default.
-- ---------------------------------------------------------------------------

create function focus.alert_is_on(p_user_id uuid, p_alert text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  pref public.user_alert_preferences;
begin
  if p_alert is null then
    return true;
  end if;
  if p_alert not in (
    'barrier_involving_me', 'assignment_changes', 'collaboration_handoff',
    'due_today_and_deadlines', 'routine_upcoming'
  ) then
    raise exception 'focus.alert_is_on: unknown alert "%"', p_alert;
  end if;

  select * into pref from public.user_alert_preferences where user_id = p_user_id;
  if not found then
    return true;
  end if;

  return case p_alert
    when 'barrier_involving_me' then pref.barrier_involving_me
    when 'assignment_changes' then pref.assignment_changes
    when 'collaboration_handoff' then pref.collaboration_handoff
    when 'due_today_and_deadlines' then pref.due_today_and_deadlines
    when 'routine_upcoming' then pref.routine_upcoming
  end;
end;
$$;

revoke all on function focus.alert_is_on(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The alert a notice about some work answers to: the one asked for, or none
-- when the work is mandatory. Work that does not exist, or no work at all,
-- answers to the alert asked for.
-- ---------------------------------------------------------------------------

create function focus.work_alert(p_task_id uuid, p_alert text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from public.tasks where id = p_task_id and is_mandatory
    ) then null
    else p_alert
  end;
$$;

revoke all on function focus.work_alert(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The alert a barrier notice answers to: none for a safety or compliance
-- risk, or for a barrier on mandatory work. Taken from the impact and work
-- rather than the barrier's id, because the notice to the person asked is
-- written by a trigger on the insert itself.
-- ---------------------------------------------------------------------------

create function focus.barrier_alert(p_impact public.barrier_impact, p_task_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_impact = 'safety_or_compliance_risk' then null
    else focus.work_alert(p_task_id, 'barrier_involving_me')
  end;
$$;

revoke all on function focus.barrier_alert(public.barrier_impact, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The two notice helpers learn which alert a notice answers to. Replaced,
-- not overloaded: a second signature with a trailing default would make
-- every existing call ambiguous. Nothing depends on either by oid.
-- Reproduced from 20260805001100_operations.sql and
-- 20260806000400_goal_security_v33.sql.
-- ---------------------------------------------------------------------------

drop function focus.notify(
  uuid, public.notification_kind, public.notification_channel, boolean, text, text, uuid, uuid, uuid
);

create function focus.notify(
  p_recipient uuid,
  p_kind public.notification_kind,
  p_channel public.notification_channel,
  p_requires_action boolean,
  p_title text,
  p_body text,
  p_task_id uuid default null,
  p_barrier_id uuid default null,
  p_actor_id uuid default null,
  p_alert text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Never notify someone about their own action, and never notify a
  -- deactivated account.
  if p_recipient is null or p_recipient = p_actor_id then
    return;
  end if;

  if not exists (
    select 1 from public.user_profiles where id = p_recipient and status = 'active'
  ) then
    return;
  end if;

  -- v186 - `p_alert` names the My Alerts switch this notice answers to. Off,
  -- the notice stays in the bell and is not emailed.
  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, barrier_id, actor_id, quiet
  ) values (
    p_recipient, p_kind, p_channel, p_requires_action, p_title, p_body,
    p_task_id, p_barrier_id, p_actor_id,
    not focus.alert_is_on(p_recipient, p_alert)
  );
end;
$$;

drop function focus.notify_goal(
  uuid, public.notification_kind, public.notification_channel, boolean, text, text, uuid, uuid
);

create function focus.notify_goal(
  p_recipient uuid,
  p_kind public.notification_kind,
  p_channel public.notification_channel,
  p_requires_action boolean,
  p_title text,
  p_body text,
  p_goal_id uuid,
  p_actor_id uuid,
  p_alert text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_recipient is null or p_recipient = p_actor_id then return; end if;
  if not exists (
    select 1 from public.user_profiles where id = p_recipient and status = 'active'
  ) then return; end if;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body, goal_id, actor_id, quiet
  ) values (
    p_recipient, p_kind, p_channel, p_requires_action, p_title, p_body,
    p_goal_id, p_actor_id,
    -- v186
    not focus.alert_is_on(p_recipient, p_alert)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Barrier or support involving me: the person asked.
-- Reproduced from the live definition (20260810016000_v53_goal_lifecycle_operations.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION focus.notify_barrier_action_required()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  task_title text;
  goal_title text;
  raiser_name text;
  action_label text;
begin
  if new.action_required_from is null or new.action_required_from = new.raised_by then
    return new;
  end if;
  select full_name into raiser_name from public.user_profiles where id = new.raised_by;
  action_label := case new.action_type
    when 'decision' then 'Decision needed'
    when 'approval' then 'Approval required'
    when 'escalation' then 'Escalation requested'
    when 'support' then 'Support requested'
    else 'Response requested' end;

  if new.task_id is not null then
    select title into task_title from public.tasks where id = new.task_id;
    perform focus.notify(
      new.action_required_from, 'barrier_raised', 'immediate', true, action_label,
      format('%s needs you on "%s": %s', coalesce(raiser_name, 'A colleague'),
        coalesce(task_title, 'a task'), new.support_needed),
      new.task_id, new.id, new.raised_by,
      focus.barrier_alert(new.impact, new.task_id)
    );
  else
    select title into goal_title from public.goals where id = new.goal_id;
    insert into public.notifications (
      recipient_id, kind, channel, requires_action, title, body,
      goal_id, barrier_id, actor_id, entity_type, entity_id, quiet
    ) values (
      new.action_required_from, 'goal_support_requested', 'immediate', true,
      action_label,
      format('%s needs you on Goal "%s": %s', coalesce(raiser_name, 'A colleague'),
        coalesce(goal_title, 'Goal'), new.support_needed),
      new.goal_id, new.id, new.raised_by, 'barrier', new.id,
      -- v186
      not focus.alert_is_on(new.action_required_from, focus.barrier_alert(new.impact, null))
    );
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Barrier or support involving me: the owner, when somebody else raised it.
-- Reproduced from the live definition (20260808007000_v44_structured_barrier.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.raise_barrier(p_task_id uuid, p_description text, p_support_needed text, p_impact barrier_impact, p_action_type barrier_action_type DEFAULT 'support'::barrier_action_type, p_action_required_from uuid DEFAULT NULL::uuid, p_add_to_meeting_queue boolean DEFAULT false, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      p_task_id, barrier_id, actor,
      focus.barrier_alert(p_impact, p_task_id));
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
$function$;

-- ---------------------------------------------------------------------------
-- Barrier or support involving me: the owner, when the blocker is removed.
-- Reproduced from the live definition (20260808006000_v44_handoff_loops.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION focus.notify_barrier_resolved()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  parent public.tasks;
begin
  if old.status <> 'open' or new.status <> 'resolved' then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found or parent.primary_owner_id = focus.current_user_id() then
    return new;
  end if;

  perform focus.notify(
    parent.primary_owner_id,
    'barrier_raised',
    'immediate',
    true,
    'Barrier resolved — review your work',
    coalesce(nullif(btrim(new.resolution_note), ''), 'The blocker has been removed.'),
    new.task_id,
    new.id,
    focus.current_user_id(),
    focus.barrier_alert(new.impact, new.task_id));

  update public.notifications
     set entity_type = 'barrier', entity_id = new.id
   where recipient_id = parent.primary_owner_id
     and barrier_id = new.id;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Barrier or support involving me: the reply.
--
-- Only this overload. The three-argument one, from v44, is unreachable: every
-- call naming its arguments also fits this one, and PostgREST refuses to
-- choose (PGRST203). Nothing in the database calls it either.
-- Reproduced from the live definition (20260810015000_v53_execution_operations.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.post_barrier_response(p_barrier_id uuid, p_message text, p_expected_version integer DEFAULT NULL::integer, p_kind barrier_response_kind DEFAULT 'answer'::barrier_response_kind, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  request public.barriers;
  response_id uuid;
  replayed jsonb;
  result jsonb;
  headline text;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to respond.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into request from public.barriers where id = p_barrier_id for update;
  if not found then return focus.error('not_found', 'That request no longer exists.'); end if;
  if not request.source_active then
    return focus.error('invalid_state', 'The source record is no longer active. This request is historical.');
  end if;
  if request.status <> 'open' then
    return focus.error('invalid_state', 'This request has already been resolved.');
  end if;
  if p_expected_version is not null and request.version <> p_expected_version then
    return focus.error('version_conflict', 'This request changed while you were writing.');
  end if;
  if request.action_required_from is distinct from actor
     and not (
       (request.task_id is not null and focus.can_contribute_to_task(request.task_id))
       or (request.goal_id is not null and focus.can_update_goal(request.goal_id))
     ) then
    return focus.error('not_authorised', 'You are not authorised to respond to this request.');
  end if;
  if length(btrim(coalesce(p_message, ''))) = 0 then
    return focus.error('validation_failed', 'Write a response before sending.');
  end if;
  if p_kind <> 'answer' and request.action_type <> 'approval' then
    return focus.error('validation_failed', 'This request did not ask for an approval decision.');
  end if;

  insert into public.barrier_responses (barrier_id, author_id, message, kind)
  values (request.id, actor, btrim(p_message), p_kind)
  returning id into response_id;
  update public.barriers
  set action_pending = case when actor = request.action_required_from then false else action_pending end,
      version = version + 1
  where id = request.id;

  headline := case when p_kind = 'approved' then 'Approved'
    when p_kind = 'changes_requested' then 'Changes requested'
    when request.action_type = 'decision' then 'Decision received'
    when request.action_type = 'approval' then 'Approval received'
    else 'Response received' end;

  if request.task_id is not null then
    perform focus.write_audit(
      p_event_type := 'barrier_response_posted', p_actor_id := actor,
      p_task_id := request.task_id,
      p_detail := jsonb_build_object('barrier_id', request.id, 'response_id', response_id,
        'response_kind', p_kind, 'action_pending_cleared', actor = request.action_required_from)
    );
    perform focus.notify(
      request.raised_by, 'barrier_raised', 'immediate', true, headline,
      left(btrim(p_message), 220), request.task_id, request.id, actor,
      focus.barrier_alert(request.impact, request.task_id)
    );
  else
    perform focus.write_goal_audit(
      'goal_support_requested', actor, request.goal_id,
      (select owner_id from public.goals where id = request.goal_id),
      (select version from public.goals where id = request.goal_id),
      jsonb_build_object('request_id', request.id, 'response_id', response_id,
        'response_kind', p_kind, 'event', 'response_posted')
    );
    perform focus.notify_goal(
      request.raised_by, 'goal_support_requested', 'immediate', true,
      headline, left(btrim(p_message), 220), request.goal_id, actor,
      focus.barrier_alert(request.impact, null)
    );
  end if;

  result := jsonb_build_object(
    'ok', true, 'code', 'barrier_response_posted', 'response_id', response_id,
    'response_kind', p_kind, 'action_pending', false, 'barrier_status', request.status
  );
  return focus.remember_operation(actor, p_idempotency_key, 'post_barrier_response', result);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Barrier or support involving me: the person who raised it, when it is resolved.
-- Reproduced from the live definition (20260810015000_v53_execution_operations.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_barrier(p_barrier_id uuid, p_resolution_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  request public.barriers;
  remaining_goal_requests integer;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to resolve a request.');
  end if;
  select * into request from public.barriers where id = p_barrier_id for update;
  if not found then return focus.error('not_found', 'This request no longer exists.'); end if;
  if not focus.can_manage_request(request.id) then
    return focus.error('not_authorised', 'You are not authorised to resolve this request.');
  end if;
  if request.status = 'resolved' then
    return jsonb_build_object('ok', true, 'code', 'already_resolved');
  end if;
  if length(btrim(coalesce(p_resolution_note, ''))) = 0 then
    return focus.error('validation_failed', 'Record how the request was resolved.');
  end if;

  update public.barriers
  set status = 'resolved', action_pending = false, resolved_by = actor,
      resolved_at = now(), resolution_note = btrim(p_resolution_note), version = version + 1
  where id = request.id;

  if request.task_id is not null then
    update public.tasks set last_meaningful_update_at = now(), version = version + 1
    where id = request.task_id;
    perform focus.write_audit(
      p_event_type := 'barrier_resolved', p_actor_id := actor, p_task_id := request.task_id,
      p_detail := jsonb_build_object('barrier_id', request.id, 'note', btrim(p_resolution_note))
    );
    perform focus.notify(
      request.raised_by, 'barrier_raised', 'immediate', false, 'Barrier resolved',
      left(btrim(p_resolution_note), 220), request.task_id, request.id, actor,
      focus.barrier_alert(request.impact, request.task_id)
    );
  else
    select
      (select count(*) from public.barriers other
       where other.goal_id = request.goal_id and other.id <> request.id
         and other.source_active and other.status = 'open')
      +
      (select count(*) from public.goal_support_requests legacy
       where legacy.goal_id = request.goal_id and legacy.status <> 'resolved')
    into remaining_goal_requests;
    update public.goals
    set health = case when remaining_goal_requests = 0 then 'on_track' else health end,
        last_meaningful_update_at = now(), version = version + 1
    where id = request.goal_id;
    perform focus.write_goal_audit(
      'goal_support_resolved', actor, request.goal_id,
      (select owner_id from public.goals where id = request.goal_id),
      (select version from public.goals where id = request.goal_id),
      jsonb_build_object('request_id', request.id, 'resolution_note', btrim(p_resolution_note))
    );
    perform focus.notify_goal(
      request.raised_by, 'goal_support_requested', 'digest', false, 'Goal support resolved',
      left(btrim(p_resolution_note), 220), request.goal_id, actor,
      focus.barrier_alert(request.impact, null)
    );
  end if;
  return jsonb_build_object('ok', true, 'code', 'resolved');
end;
$function$;

-- ---------------------------------------------------------------------------
-- Barrier or support involving me: a Goal support request from before v53, resolved.
-- Reproduced from the live definition (20260806000500_goal_operations_v33.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_goal_support(p_support_request_id uuid, p_resolution_note text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  support record;
  goal record;
  other_open integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to resolve support.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into support from public.goal_support_requests
   where id = p_support_request_id for update;
  if not found then return focus.error('not_found', 'This support request no longer exists.'); end if;
  select * into goal from public.goals where id = support.goal_id for update;
  if not focus.can_agree_goal(goal.id) then
    return focus.error('not_authorised', 'Only the authorised manager can resolve Goal support.');
  end if;
  if support.status = 'resolved' then
    return focus.error('invalid_state', 'This support request is already resolved.');
  end if;
  if length(btrim(coalesce(p_resolution_note, ''))) = 0 then
    return focus.error('validation_failed', 'Record how the requested support was resolved.');
  end if;

  update public.goal_support_requests
     set status = 'resolved',
         acknowledged_by = coalesce(acknowledged_by, actor),
         acknowledged_at = coalesce(acknowledged_at, now()),
         resolved_by = actor,
         resolved_at = now(),
         resolution_note = btrim(p_resolution_note)
   where id = support.id;
  select count(*) into other_open from public.goal_support_requests
   where goal_id = goal.id and id <> support.id and status <> 'resolved';
  update public.goals
     set health = case when other_open = 0 then 'on_track' else health end,
         version = version + 1
   where id = goal.id;
  perform focus.write_goal_audit(
    'goal_support_resolved', actor, goal.id, goal.owner_id, goal.version + 1,
    jsonb_build_object('support_request_id', support.id, 'resolution_note', btrim(p_resolution_note))
  );
  perform focus.notify_goal(
    support.requested_by, 'goal_support_requested', 'digest', false,
    'Goal support resolved', goal.title || ': ' || left(btrim(p_resolution_note), 220),
    goal.id, actor, 'barrier_involving_me'
  );
  result := jsonb_build_object('ok', true, 'code', 'goal_support_resolved',
    'version', goal.version + 1);
  return focus.remember_operation(actor, p_idempotency_key, 'resolve_goal_support', result);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Assignment and reassignment: new work assigned.
-- Reproduced from the live definition (20260914001000_v180_assignment_keeps_the_capture.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assign_work_to_people(p_title text, p_description text, p_work_class work_class, p_owner_ids uuid[], p_urgency urgency_level DEFAULT 'normal'::urgency_level, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_due_is_date_only boolean DEFAULT true, p_review_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_idempotency_key text DEFAULT NULL::text, p_work_purpose work_purpose DEFAULT NULL::work_purpose, p_capture_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := focus.current_user_id();
  actor_profile public.user_profiles;
  target_owner uuid;
  owner_profile public.user_profiles;
  capture public.work_captures;
  evidence_rule text := 'optional';
  evidence_instruction text;
  description text := nullif(btrim(coalesce(p_description, '')), '');
  batch_id uuid := extensions.gen_random_uuid();
  new_task_id uuid;
  created_ids uuid[] := '{}';
  task_bucket public.focus_bucket;
  replayed jsonb;
  result jsonb;
begin
  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then
      return replayed;
    end if;
  end if;

  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to assign work.');
  end if;

  select * into actor_profile from public.user_profiles where id = actor;
  if not found or actor_profile.role not in ('manager', 'administrator') then
    return focus.error('not_authorised', 'Only a manager can assign work to somebody else.');
  end if;

  if length(btrim(coalesce(p_title, ''))) = 0 then
    return focus.error('validation_failed', 'Give the work a title.');
  end if;

  if p_owner_ids is null or array_length(p_owner_ids, 1) is null then
    return focus.error('validation_failed', 'Choose at least one person.');
  end if;

  /*
   * The draft New Work saved, when this assignment comes from there.
   *
   * Only the person who wrote it, and only while it is still waiting: a draft
   * already turned into work, or somebody else's, is not something to assign.
   */
  if p_capture_id is not null then
    if array_length(p_owner_ids, 1) <> 1 then
      return focus.error('validation_failed',
        'Work with attachments and an evidence rule can be assigned to one person at a time.');
    end if;

    select * into capture
      from public.work_captures
     where id = p_capture_id
       and captured_by = actor
       and status = 'pending_confirmation'
     for update;
    if not found then
      return focus.error('not_found', 'This work is no longer waiting to be created. Start it again.');
    end if;

    evidence_rule := coalesce(capture.completion_evidence_rule, 'optional');
    evidence_instruction := case
      when evidence_rule = 'optional' then null
      else nullif(btrim(coalesce(capture.completion_evidence_instruction, '')), '')
    end;
    description := coalesce(description, nullif(btrim(coalesce(capture.description, '')), ''));
  end if;

  task_bucket := case p_work_class
    when 'major_project' then 'major'::public.focus_bucket
    when 'self_development' then 'self_development'::public.focus_bucket
    else 'operational'::public.focus_bucket
  end;

  foreach target_owner in array p_owner_ids loop
    select * into owner_profile from public.user_profiles where id = target_owner;
    if not found or owner_profile.status <> 'active' then
      return focus.error('validation_failed', 'One of the selected people is not an active user.');
    end if;

    -- You may only assign to somebody you are authorised to see. Without this,
    -- assignment would be a way to write into a reporting line you cannot read.
    if not focus.can_view_user(target_owner) then
      return focus.error('not_authorised',
        'You can only assign work to people your visibility settings cover.');
    end if;

    insert into public.tasks (
      title, description, next_action,
      status, work_class, focus_bucket, work_purpose, origin, urgency,
      primary_owner_id, created_by, assigned_by, assignment_batch_id,
      due_at, due_is_date_only, review_at,
      classification_rule_code, classification_rule_text,
      completion_evidence_rule, completion_evidence_instruction
    ) values (
      btrim(p_title),
      description,
      -- v41 section 11: no fabricated next action. Assigned work in Available
      -- has not been started, so there is genuinely nothing to do next yet.
      null,
      -- The critical line. Assigned work waits in Available.
      'backlog',
      p_work_class,
      task_bucket,
      -- §11 — asked for at registration. Null is still permitted: an old
      -- client that does not send one creates work that reads as unclassified
      -- rather than work that silently claims to be planned operations.
      p_work_purpose,
      'manager_assigned',
      coalesce(p_urgency, 'normal'),
      target_owner,
      actor,
      actor,
      batch_id,
      p_due_at,
      coalesce(p_due_is_date_only, true),
      p_review_at,
      'manager_assigned',
      format('%s assigned this work and selected the type, urgency and dates.',
             actor_profile.full_name),
      evidence_rule,
      evidence_instruction
    )
    returning id into new_task_id;

    created_ids := created_ids || new_task_id;

    perform focus.write_audit(
      p_event_type := 'task_created',
      p_actor_id := actor,
      p_task_id := new_task_id,
      p_detail := jsonb_build_object(
        'assignment_batch_id', batch_id,
        'assigned_by', actor,
        'primary_owner_id', target_owner,
        'work_class', p_work_class,
        'work_purpose', p_work_purpose,
        'completion_evidence_rule', evidence_rule,
        'capture_id', p_capture_id,
        'status', 'backlog',
        'independent_record', true,
        'classification_rule_code', 'manager_assigned'));

    perform focus.notify(
      target_owner, 'ordinary_assignment', 'immediate', true,
      'New work assigned to you',
      format('%s assigned "%s". It is waiting in Available until you activate it.',
             actor_profile.full_name, btrim(p_title)),
      new_task_id, null, actor,
      focus.work_alert(new_task_id, 'assignment_changes'));
  end loop;

  -- The draft's files become the task's, and the draft is resolved rather than
  -- discarded: discarding is what used to delete the files.
  if p_capture_id is not null then
    insert into public.attachments (
      task_id, storage_bucket, storage_path, file_name, mime_type, byte_size, uploaded_by
    )
    select new_task_id, storage_bucket, storage_path, file_name, mime_type, byte_size, actor
      from public.work_capture_attachments
     where capture_id = capture.id;

    delete from public.work_capture_attachments where capture_id = capture.id;

    update public.work_captures
       set chosen_destination = capture.recommended_destination,
           status = 'confirmed',
           resolved_at = now(),
           created_task_id = new_task_id
     where id = capture.id;
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', 'work_assigned',
    'assignment_batch_id', batch_id,
    'task_ids', to_jsonb(created_ids),
    'created_count', coalesce(array_length(created_ids, 1), 0));

  return focus.remember_operation(actor, p_idempotency_key, 'assign_work_to_people', result);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Assignment and reassignment: the new owner and the previous one.
-- The live body carries v54's rewrite of the authority check.
-- Reproduced from the live definition (20260810015000_v53_execution_operations.sql, as rewritten by 20260811002000_v54).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reassign_task(p_task_id uuid, p_expected_version integer, p_new_owner_id uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  task public.tasks;
  previous_owner uuid;
  new_count integer := 0;
  target integer := 0;
  workload_review_needed boolean := false;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to reassign work.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;
  if not (false
          or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))) then
    return focus.error('not_authorised', 'Only an authorised manager can reassign this work.');
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Terminal work cannot be reassigned.');
  end if;
  if not exists (
    select 1 from public.user_profiles where id = p_new_owner_id and status = 'active'
  ) then
    return focus.error('invalid_owner', 'The new owner must be an active account.');
  end if;
  if p_new_owner_id = task.primary_owner_id then
    return jsonb_build_object(
      'ok', true, 'code', 'unchanged', 'task', focus.task_snapshot(p_task_id),
      'workload_review_needed', false
    );
  end if;
  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This task changed while you were reassigning it. Review the latest information.',
      jsonb_build_object('current_version', task.version)
    );
  end if;

  previous_owner := task.primary_owner_id;
  update public.tasks
  set primary_owner_id = p_new_owner_id,
      last_meaningful_update_at = now(),
      version = version + 1
  where id = p_task_id;

  perform focus.refresh_over_target(previous_owner, task.focus_bucket);
  perform focus.refresh_over_target(p_new_owner_id, task.focus_bucket);

  if task.status = 'active' and task.focus_bucket is not null then
    new_count := focus.active_focus_count(p_new_owner_id, task.focus_bucket);
    target := coalesce(focus.effective_focus_target(p_new_owner_id, task.focus_bucket), 0);
    workload_review_needed := new_count > target;
  end if;

  -- A contribution assigned to the new parent owner is no longer Shared and
  -- must not leave a red notification claiming they owe a contribution.
  update public.notifications
  set requires_action = false
  where requires_action
    and entity_type = 'checklist_item'
    and entity_id in (
      select item.id
      from public.task_checklist_items item
      where item.task_id = p_task_id and item.assigned_to = p_new_owner_id
    );

  event_id := focus.write_audit(
    p_event_type := 'task_reassigned',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_subject_user_id := p_new_owner_id,
    p_bucket := task.focus_bucket,
    p_count_after := new_count,
    p_target := target,
    p_over_target := workload_review_needed,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'previous_owner_id', previous_owner,
      'status_retained', task.status,
      'shared_recalculated', true,
      'workload_review_needed', workload_review_needed
    )
  );

  perform focus.notify(
    p_new_owner_id, 'reassignment', 'immediate', true,
    'Work assigned to you', format('"%s" is now your responsibility.', task.title),
    p_task_id, null, actor,
    focus.work_alert(p_task_id, 'assignment_changes')
  );
  perform focus.notify(
    previous_owner, 'ownership_changed', 'immediate', false,
    'Work reassigned',
    format('"%s" was reassigned to %s.', task.title,
      (select full_name from public.user_profiles where id = p_new_owner_id)),
    p_task_id, null, actor,
    focus.work_alert(p_task_id, 'assignment_changes')
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'reassigned',
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id,
    'status_retained', task.status,
    'active_count', new_count,
    'recommended_target', target,
    'workload_review_needed', workload_review_needed
  );
  return focus.remember_operation(actor, p_idempotency_key, 'reassign_task', result);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Assignment and reassignment: follow-up work from a routine finding.
-- An immediate risk creates mandatory work, so it is sent regardless.
-- Reproduced from the live definition (20260805001200_operations_undo_review_routines.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_routine_finding(p_occurrence_task_id uuid, p_severity finding_severity, p_description text, p_follow_up_owner_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  occurrence record;
  follow_up_id uuid;
  owner_id uuid;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to record a finding.');
  end if;

  select * into occurrence from public.tasks where id = p_occurrence_task_id;
  if not found then return focus.error('not_found', 'This occurrence no longer exists.'); end if;

  if occurrence.work_class <> 'routine_occurrence' then
    return focus.error('invalid_state', 'Findings belong to a routine occurrence.');
  end if;

  if not focus.can_contribute_to_task(p_occurrence_task_id) then
    return focus.error('not_authorised', 'You are not authorised to record a finding here.');
  end if;

  if length(btrim(coalesce(p_description, ''))) = 0 then
    return focus.error('validation_failed', 'Describe the finding.');
  end if;

  if p_severity <> 'minor' then
    owner_id := coalesce(p_follow_up_owner_id, occurrence.primary_owner_id);

    insert into public.tasks (
      title, description, status, work_class, focus_bucket, origin, urgency,
      primary_owner_id, created_by, is_mandatory, mandatory_justification
    ) values (
      format('Follow-up: %s', left(p_description, 150)),
      format('Raised from routine occurrence "%s".', occurrence.title),
      'backlog', 'operational_action', 'operational', 'finding_generated',
      case when p_severity = 'immediate_risk' then 'critical'::public.urgency_level
           else 'high'::public.urgency_level end,
      owner_id, actor,
      p_severity = 'immediate_risk',
      case when p_severity = 'immediate_risk'
           then format('Immediate risk identified during routine "%s".', occurrence.title)
           else null end
    )
    returning id into follow_up_id;

    insert into public.task_relations (task_id, related_task_id, relation, created_by)
    values (p_occurrence_task_id, follow_up_id, 'before', actor);

    perform focus.notify(
      owner_id,
      case when p_severity = 'immediate_risk' then 'mandatory_action'::public.notification_kind
           else 'ordinary_assignment'::public.notification_kind end,
      case when p_severity = 'immediate_risk' then 'immediate'::public.notification_channel
           else 'digest'::public.notification_channel end,
      p_severity = 'immediate_risk',
      case when p_severity = 'immediate_risk' then 'Immediate risk raised'
           else 'Follow-up work created' end,
      format('A %s finding on "%s" created follow-up work.',
             replace(p_severity::text, '_', ' '), occurrence.title),
      follow_up_id, null, actor,
      focus.work_alert(follow_up_id, 'assignment_changes'));
  end if;

  insert into public.routine_findings (
    occurrence_task_id, severity, description, created_task_id, recorded_by
  ) values (
    p_occurrence_task_id, p_severity, p_description, follow_up_id, actor
  );

  perform focus.write_audit(
    p_event_type := 'routine_finding_recorded',
    p_actor_id := actor,
    p_task_id := p_occurrence_task_id,
    p_detail := jsonb_build_object(
      'severity', p_severity, 'created_task_id', follow_up_id));

  return jsonb_build_object('ok', true, 'code', 'finding_recorded',
                            'created_task_id', follow_up_id);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Collaborative handoff: a step given to somebody, or taken from them.
-- Reproduced from the live definition (20260911006000_v161_steps_for_the_owner.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION focus.notify_contribution_assigned()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  parent public.tasks;
  assigner_name text;
  ready boolean;
  actor uuid := focus.current_user_id();
  to_contributor boolean;
begin
  -- Only a genuine change of person.
  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;

  select full_name into assigner_name
    from public.user_profiles where id = actor;

  to_contributor := new.assigned_to is not null
                    and new.assigned_to <> parent.primary_owner_id;

  if to_contributor then
    ready := parent.status = 'active' and new.state = 'ready';

    -- One notification, not two (section 4). Whether it is startable yet belongs
    -- in this message, not in a second one arriving in the same second.
    perform focus.notify(
      new.assigned_to,
      'collaboration_handoff',
      'immediate',
      true,
      'New contribution assigned',
      format('%s · Part of "%s".%s Assigned by %s. %s',
             new.action, parent.title,
             focus.step_due_sentence(new.due_at, parent.due_at),
             coalesce(assigner_name, 'a colleague'),
             case when ready then 'Ready to start.'
                  else 'Waiting for the owner to start.' end),
      new.task_id,
      null,
      actor,
      focus.work_alert(new.task_id, 'collaboration_handoff'));

    update public.notifications
       set entity_type = 'checklist_item', entity_id = new.id
     where recipient_id = new.assigned_to
       and task_id = new.task_id
       and entity_id is null
       and read_at is null;
  elsif new.assigned_to is not null then
    -- v161 - handed to the owner by somebody else: a step on their own work.
    perform focus.notify_step_for_owner(new, parent, actor, assigner_name, 'Assigned to you by');
  end if;

  -- The previous assignee learns it left their list, but is not asked to act -
  -- v161: wherever it went, including back to the owner or to nobody.
  if old.assigned_to is not null
     and old.assigned_to <> parent.primary_owner_id then
    perform focus.notify(
      old.assigned_to,
      'collaboration_handoff',
      'digest',
      false,
      (case when to_contributor then 'Contribution reassigned'
            else 'Contribution withdrawn' end)::text,
      (case when to_contributor
            then format('"%s" has been reassigned. It is no longer on your Shared list.', new.action)
            else format('"%s" is no longer yours to do. It has left your Shared list.', new.action)
       end)::text,
      new.task_id,
      null,
      actor,
      focus.work_alert(new.task_id, 'collaboration_handoff'));
  end if;

  -- Audited as before: an assignment to somebody other than the owner.
  if to_contributor then
    perform focus.write_audit(
      p_event_type := 'checklist_item_assigned',
      p_actor_id := actor,
      p_task_id := new.task_id,
      p_detail := jsonb_build_object(
        'checklist_item_id', new.id,
        'action', new.action,
        'previous_assignee', old.assigned_to,
        'new_assignee', new.assigned_to));
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Collaborative handoff: a step created for somebody.
-- Reproduced from the live definition (20260911006000_v161_steps_for_the_owner.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION focus.notify_contribution_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  parent public.tasks;
  assigner_name text;
begin
  if new.assigned_to is null then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found or new.assigned_to = focus.current_user_id() then
    return new;
  end if;

  select full_name into assigner_name
    from public.user_profiles where id = focus.current_user_id();

  -- v161 - for the owner, on their own work, by somebody else.
  if parent.primary_owner_id = new.assigned_to then
    perform focus.notify_step_for_owner(
      new, parent, focus.current_user_id(), assigner_name, 'Added by');
    return new;
  end if;

  perform focus.notify(
    new.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'New contribution assigned',
    format('%s · Part of "%s".%s Assigned by %s. %s',
           new.action, parent.title,
           focus.step_due_sentence(new.due_at, parent.due_at),
           coalesce(assigner_name, 'a colleague'),
           case when parent.status = 'active' and new.state = 'ready'
                then 'Ready to start.'
                else 'Waiting for the owner to start.' end),
    new.task_id,
    null,
    focus.current_user_id(),
    focus.work_alert(new.task_id, 'collaboration_handoff'));

  update public.notifications
     set entity_type = 'checklist_item', entity_id = new.id
   where recipient_id = new.assigned_to
     and task_id = new.task_id
     and entity_id is null
     and read_at is null;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Collaborative handoff: a waiting step becomes ready.
-- Reproduced from the live definition (20260808006000_v44_handoff_loops.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION focus.notify_contribution_ready()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  parent public.tasks;
begin
  if new.assigned_to is null
     or old.state <> 'waiting'
     or new.state <> 'ready' then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found or parent.primary_owner_id = new.assigned_to then
    return new;
  end if;

  perform focus.notify(
    new.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'Your contribution is ready',
    format('%s · Part of "%s". Nothing is blocking it now.', new.action, parent.title),
    new.task_id,
    null,
    null,
    focus.work_alert(new.task_id, 'collaboration_handoff'));

  update public.notifications
     set entity_type = 'checklist_item', entity_id = new.id
   where recipient_id = new.assigned_to
     and task_id = new.task_id
     and entity_id is null
     and read_at is null;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Collaborative handoff: a step on the owner's own work, put there by somebody else.
-- Reproduced from the live definition (20260911006000_v161_steps_for_the_owner.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION focus.notify_step_for_owner(p_step task_checklist_items, p_parent tasks, p_actor uuid, p_actor_name text, p_verb text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Nobody is told about their own act, and the system tells nobody.
  if p_actor is null or p_actor = p_step.assigned_to then
    return;
  end if;

  if not exists (
    select 1 from public.user_profiles
     where id = p_step.assigned_to and status = 'active'
  ) then
    return;
  end if;

  -- The assignment of the work itself, still unread, already tells them.
  if exists (
    select 1 from public.notifications n
     where n.recipient_id = p_step.assigned_to
       and n.task_id = p_step.task_id
       and n.read_at is null
       and n.kind in ('ordinary_assignment', 'reassignment', 'ownership_changed')
  ) then
    return;
  end if;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, actor_id, entity_type, entity_id, quiet
  ) values (
    p_step.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'New step on your work',
    format('%s · On "%s".%s %s %s.',
           p_step.action, p_parent.title,
           focus.step_due_sentence(p_step.due_at, p_parent.due_at),
           p_verb, coalesce(p_actor_name, 'a colleague')),
    p_step.task_id,
    p_actor,
    'task_step',
    p_step.id,
    -- v186
    not focus.alert_is_on(p_step.assigned_to, focus.work_alert(p_step.task_id, 'collaboration_handoff'))
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Collaborative handoff: completing a step makes the next one ready.
-- Reproduced from the live definition (20260828003000_v82_checklist_step_belongs_to_its_assignee.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_checklist_item(p_item_id uuid, p_completion_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  item record;
  task record;
  has_evidence boolean;
  total_items integer;
  done_items integer;
  new_progress integer;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to complete a step.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into item from public.task_checklist_items where id = p_item_id for update;
  if not found then return focus.error('not_found', 'This step no longer exists.'); end if;

  select * into task from public.tasks where id = item.task_id;

  if not focus.can_complete_checklist_item(item.id) then
    return focus.error('not_authorised', focus.checklist_completion_refusal(item.id, 'complete'));
  end if;

  if item.state = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_completed');
  end if;

  -- Section 13.3 and section 10 both park a step in Waiting, for entirely
  -- different reasons, and the contributor has to be told which.
  if item.state = 'waiting' then
    return focus.error('waiting_on_prerequisite', focus.checklist_waiting_reason(item.id));
  end if;

  -- Section 11.2 — evidence-required steps need an attachment before closing.
  if item.evidence_rule = 'required' then
    select exists (
      select 1 from public.attachments a where a.checklist_item_id = p_item_id
    ) into has_evidence;

    if not has_evidence then
      return focus.error('evidence_missing',
        'This step requires evidence. Attach a file or screenshot before completing it.');
    end if;
  end if;

  update public.task_checklist_items
     set state = 'completed',
         completed_by = actor,
         completed_at = now(),
         completion_note = p_completion_note
   where id = p_item_id;

  -- Section 11.3 — checklist completion is the single progress source.
  select count(*), count(*) filter (where state = 'completed')
    into total_items, done_items
    from public.task_checklist_items
   where task_id = item.task_id;

  new_progress := case when total_items = 0 then task.progress_percent
                       else (done_items * 100) / total_items end;

  update public.tasks
     set progress_percent = new_progress,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = item.task_id;

  event_id := focus.write_audit(
    p_event_type := 'checklist_item_completed',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'checklist_item_id', p_item_id,
      'action', item.action,
      'progress_percent', new_progress,
      'note', p_completion_note)
  );

  -- Section 13.3 — tell whoever now has a ready handoff.
  perform focus.notify(
    ci.assigned_to, 'collaboration_handoff', 'immediate', true,
    'Your step is ready',
    format('"%s" is ready for you on "%s".', ci.action, task.title),
    item.task_id, null, actor,
    focus.work_alert(item.task_id, 'collaboration_handoff'))
  from public.task_checklist_items ci
  where ci.depends_on_item_id = p_item_id
    and ci.state = 'ready'
    and ci.assigned_to is not null;

  result := jsonb_build_object('ok', true, 'code', 'completed',
                               'progress_percent', new_progress,
                               'audit_event_id', event_id);
  return focus.remember_operation(actor, p_idempotency_key, 'complete_checklist_item', result);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Collaborative handoff: completing a step with evidence makes the next one ready.
-- Reproduced from the live definition (20260828003000_v82_checklist_step_belongs_to_its_assignee.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.complete_checklist_item_with_evidence(p_item_id uuid, p_attachments jsonb, p_completion_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  item record;
  task record;
  attachment record;
  replayed jsonb;
  attachment_count integer;
  update_id uuid;
  total_items integer;
  done_items integer;
  new_progress integer;
  event_id uuid;
  result jsonb;
  event_time timestamptz := now();
  clean_note text := nullif(btrim(coalesce(p_completion_note, '')), '');
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to complete this step.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into item
    from public.task_checklist_items
   where id = p_item_id
   for update;
  if not found then return focus.error('not_found', 'This step no longer exists.'); end if;

  select * into task from public.tasks where id = item.task_id for update;
  if not focus.can_complete_checklist_item(item.id) then
    return focus.error('not_authorised', focus.checklist_completion_refusal(item.id, 'complete'));
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed or cancelled work cannot receive checklist evidence.');
  end if;
  if item.state = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_completed');
  end if;
  -- Section 13.3 and section 10 both park a step in Waiting, for entirely
  -- different reasons, and the contributor has to be told which.
  if item.state = 'waiting' then
    return focus.error('waiting_on_prerequisite', focus.checklist_waiting_reason(item.id));
  end if;
  if item.evidence_rule <> 'required' then
    return focus.error('validation_failed', 'This operation is only for an evidence-required step.');
  end if;
  if clean_note is not null and length(clean_note) > 2000 then
    return focus.error('validation_failed', 'Keep the completion note to 2,000 characters or fewer.');
  end if;
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    return focus.error('validation_failed', 'Attachment metadata is malformed.');
  end if;

  attachment_count := jsonb_array_length(coalesce(p_attachments, '[]'::jsonb));
  if attachment_count = 0 then
    return focus.error('evidence_missing', 'Choose a file, photo, or screenshot to complete this step.');
  end if;

  for attachment in
    select *
      from jsonb_to_recordset(p_attachments) as x(
        id uuid,
        storage_path text,
        file_name text,
        mime_type text,
        byte_size bigint,
        is_evidence boolean
      )
  loop
    if attachment.id is null
       or length(btrim(coalesce(attachment.file_name, ''))) = 0
       or attachment.byte_size is null
       or attachment.byte_size <= 0
       or attachment.storage_path not like ('tasks/' || item.task_id::text || '/%')
       or not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'task-attachments'
            and o.name = attachment.storage_path
            and o.owner = actor
       ) then
      return focus.error('validation_failed', 'An uploaded attachment could not be verified.');
    end if;
  end loop;

  insert into public.task_updates (task_id, author_id, body, is_evidence_only, created_at)
  values (item.task_id, actor, clean_note, true, event_time)
  returning id into update_id;

  insert into public.attachments (
    id, task_id, checklist_item_id, update_id, storage_bucket, storage_path,
    file_name, mime_type, byte_size, is_evidence, virus_scan_state, uploaded_by, created_at
  )
  select x.id, item.task_id, item.id, update_id, 'task-attachments', x.storage_path,
         x.file_name, x.mime_type, x.byte_size, true, 'not_scanned', actor, event_time
    from jsonb_to_recordset(p_attachments) as x(
      id uuid,
      storage_path text,
      file_name text,
      mime_type text,
      byte_size bigint,
      is_evidence boolean
    );

  update public.task_checklist_items
     set state = 'completed',
         completed_by = actor,
         completed_at = event_time,
         completion_note = clean_note
   where id = item.id;

  select count(*), count(*) filter (where state = 'completed')
    into total_items, done_items
    from public.task_checklist_items
   where task_id = item.task_id;
  new_progress := (done_items * 100) / total_items;

  update public.tasks
     set progress_percent = new_progress,
         last_meaningful_update_at = event_time,
         version = version + 1
   where id = item.task_id;

  perform focus.write_audit(
    p_event_type := 'update_posted',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'update_id', update_id,
      'evidence_only', true,
      'checklist_item_id', item.id,
      'attachment_count', attachment_count,
      'completion_note', clean_note
    )
  );
  perform focus.write_audit(
    p_event_type := 'attachment_added',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'update_id', update_id,
      'checklist_item_id', item.id,
      'action', item.action,
      'attachment_count', attachment_count
    )
  );
  event_id := focus.write_audit(
    p_event_type := 'checklist_item_completed',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'checklist_item_id', item.id,
      'action', item.action,
      'progress_percent', new_progress,
      'note', clean_note,
      'attachment_count', attachment_count
    )
  );

  perform focus.notify(
    ci.assigned_to, 'collaboration_handoff', 'immediate', true,
    'Your step is ready',
    format('"%s" is ready for you on "%s".', ci.action, task.title),
    item.task_id, null, actor,
    focus.work_alert(item.task_id, 'collaboration_handoff'))
  from public.task_checklist_items ci
  where ci.depends_on_item_id = item.id
    and ci.state = 'ready'
    and ci.assigned_to is not null;

  result := jsonb_build_object(
    'ok', true,
    'code', 'completed_with_evidence',
    'progress_percent', new_progress,
    'attachment_count', attachment_count,
    'audit_event_id', event_id,
    'version', task.version + 1
  );
  return focus.remember_operation(
    actor,
    p_idempotency_key,
    'complete_checklist_item_with_evidence',
    result
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Collaborative handoff: a step removed from somebody's Shared list.
-- Reproduced from the live definition (20260808009100_v45_checklist_step_mutations.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.remove_checklist_step(p_item_id uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  item public.task_checklist_items;
  dependants integer;
  attachments integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to remove this step.');
  end if;

  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then return replayed; end if;
  end if;

  select * into item from public.task_checklist_items where id = p_item_id for update;
  if not found then
    -- Already gone. Say so as a success: the caller wanted it absent, it is.
    result := jsonb_build_object('ok', true, 'code', 'checklist_step_removed',
                                 'item_id', p_item_id);
    return focus.remember_operation(actor, p_idempotency_key, 'remove_checklist_step', result);
  end if;

  if not focus.can_edit_task(item.task_id) then
    return focus.error('not_authorised',
      'Only the owner of this work, or their manager, can remove its steps.');
  end if;

  if item.state = 'completed' then
    return focus.error('invalid_state',
      'This step is already complete. Completed work stays on the record.');
  end if;

  select count(*) into attachments
    from public.attachments where checklist_item_id = p_item_id;
  if attachments > 0 then
    return focus.error('invalid_state',
      'This step has evidence attached. Detach it first if the step is genuinely not needed.');
  end if;

  -- `on delete set null` would silently release every step waiting on this one
  -- and nobody would be told that their prerequisite had evaporated.
  select count(*) into dependants
    from public.task_checklist_items
   where depends_on_item_id = p_item_id;
  if dependants > 0 then
    return focus.error('invalid_state',
      format('%s other step(s) are waiting for this one. Repoint them before removing it.',
             dependants));
  end if;

  perform focus.write_audit(
    p_event_type := 'checklist_item_removed',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_subject_user_id := item.assigned_to,
    p_detail := jsonb_build_object(
      'checklist_item_id', p_item_id,
      'action', item.action,
      'assigned_to', item.assigned_to,
      'state', item.state));

  -- The person who had it on their Shared list learns it is gone, and why it
  -- vanished — otherwise the row simply disappears overnight.
  if item.assigned_to is not null and item.assigned_to <> actor then
    perform focus.notify(
      item.assigned_to,
      'collaboration_handoff', 'digest', false,
      'Contribution removed',
      format('"%s" was removed from the checklist. It is no longer on your Shared list.',
             item.action),
      item.task_id, null, actor,
      focus.work_alert(item.task_id, 'collaboration_handoff'));
  end if;

  delete from public.task_checklist_items where id = p_item_id;

  perform focus.recalculate_checklist_readiness(item.task_id);

  result := jsonb_build_object('ok', true, 'code', 'checklist_step_removed',
                               'item_id', p_item_id);
  return focus.remember_operation(actor, p_idempotency_key, 'remove_checklist_step', result);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Due-today and selection deadlines: mandatory work is told regardless.
-- An owner with the alert off and late mandatory work among ordinary late
-- work is sent one notice, about the mandatory work; the rest is recorded as
-- told, as v185 does for all of it.
-- Reproduced from the live definition (20260915004000_v185_overdue_told.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_overdue_work(p_task_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  batch record;
  notice_id uuid;
  people integer := 0;
  work_count integer := 0;
begin
  -- One run at a time: two firings together would each find the same work
  -- untold.
  perform pg_advisory_xact_lock(hashtextextended('notify_overdue_work', 0));

  for batch in
    select
      t.primary_owner_id as owner_id,
      coalesce(pref.due_today_and_deadlines, true) or t.is_mandatory as wants,
      count(*)::integer as n,
      array_agg(t.id order by t.due_at, t.id) as task_ids,
      array_agg(t.due_at order by t.due_at, t.id) as due_ats,
      array_agg(t.title order by t.due_at, t.id) as titles
    from public.tasks t
    join public.user_profiles owner
      on owner.id = t.primary_owner_id
     and owner.status = 'active'
    left join public.user_alert_preferences pref
      on pref.user_id = t.primary_owner_id
    where t.status in ('active', 'paused', 'backlog')
      and t.deleted_at is null
      and t.work_class <> 'routine_occurrence'
      and t.due_at is not null
      and t.due_at < now()
      and (p_task_ids is null or t.id = any (p_task_ids))
      and not exists (
        select 1
          from public.task_overdue_notices told
         where told.task_id = t.id
           and told.due_at = t.due_at
      )
    group by t.primary_owner_id, coalesce(pref.due_today_and_deadlines, true) or t.is_mandatory
  loop
    notice_id := null;

    if batch.wants then
      insert into public.notifications (
        recipient_id, kind, channel, requires_action, title, body,
        task_id, entity_type, entity_id
      ) values (
        batch.owner_id,
        'work_overdue',
        'immediate',
        true,
        case
          when batch.n = 1 then 'Work overdue'
          else format('%s pieces of work overdue', batch.n)
        end,
        case
          when batch.n = 1 then
            format('%s · It was due %s.', batch.titles[1], focus.short_org_date(batch.due_ats[1]))
          else
            (
              select string_agg(
                       format('"%s" was due %s', batch.titles[i], focus.short_org_date(batch.due_ats[i])),
                       '; '
                       order by i
                     )
                from generate_subscripts(batch.titles, 1) as i
               where i <= 3
            )
            || case when batch.n > 3 then format('; and %s more.', batch.n - 3) else '.' end
        end,
        -- One piece of work opens it. Several carry no record, so the notice
        -- opens My Day, whose Needs attention lists them.
        case when batch.n = 1 then batch.task_ids[1] end,
        case when batch.n = 1 then 'task' end,
        case when batch.n = 1 then batch.task_ids[1] end
      )
      returning id into notice_id;
      people := people + 1;
    end if;

    insert into public.task_overdue_notices (task_id, due_at, recipient_id, notification_id)
    select batch.task_ids[i], batch.due_ats[i], batch.owner_id, notice_id
      from generate_subscripts(batch.task_ids, 1) as i
    on conflict (task_id, due_at) do nothing;

    work_count := work_count + batch.n;
  end loop;

  return jsonb_build_object('ok', true, 'notified', people, 'work', work_count);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Due-today and selection deadlines: a late step on mandatory work is told regardless.
-- Reproduced from the live definition (20260915004000_v185_overdue_told.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_overdue_contributions(p_task_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  told integer;
begin
  with late as (
    select
      item.id,
      item.task_id,
      item.action,
      item.assigned_to,
      parent.title as parent_title,
      coalesce(item.due_at, parent.due_at) as due_at
    from public.task_checklist_items item
    join public.tasks parent on parent.id = item.task_id
    join public.user_profiles assignee
      on assignee.id = item.assigned_to and assignee.status = 'active'
    -- v185 - "Due-today and selection deadlines" in My Alerts.
    left join public.user_alert_preferences pref
      on pref.user_id = item.assigned_to
    where item.assigned_to is not null
      and item.assigned_to <> parent.primary_owner_id
      and item.state <> 'completed'
      and parent.status = 'active'
      and parent.deleted_at is null
      and coalesce(item.due_at, parent.due_at) < now()
      and (coalesce(pref.due_today_and_deadlines, true) or parent.is_mandatory)
      and (p_task_ids is null or item.task_id = any (p_task_ids))
  ),
  inserted as (
    insert into public.notifications (
      recipient_id, kind, channel, requires_action, title, body,
      task_id, entity_type, entity_id, dedupe_key
    )
    select
      late.assigned_to,
      'collaboration_handoff',
      'immediate',
      true,
      'Contribution overdue',
      format('%s · Part of "%s". It was due %s.',
             late.action, late.parent_title, focus.short_org_date(late.due_at)),
      late.task_id,
      'checklist_item',
      late.id,
      format('step_overdue:%s:%s',
             late.id, (late.due_at at time zone focus.org_time_zone())::date)
    from late
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
    returning 1
  )
  select count(*)::integer into told from inserted;

  return jsonb_build_object('ok', true, 'notified', told);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Due-today and selection deadlines: a moved date on mandatory work is told regardless.
-- Reproduced from the live definition (20260915004000_v185_overdue_told.sql).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.change_task_due_date(p_task_id uuid, p_expected_version integer, p_new_due_at timestamp with time zone, p_due_is_date_only boolean, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  task record;
  replayed jsonb;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  event_id uuid;
  result jsonb;
  blocking_step record;
  -- v185
  zone text := focus.org_time_zone();
  postponed boolean;
  late_days integer;
  actor_name text;
  owner_manager uuid;
  from_text text;
  to_text text;
  reason_text text;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change the due date.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select id, title, primary_owner_id, assigned_by, due_at, due_is_date_only, status, version,
         is_mandatory
    into task
    from public.tasks
   where id = p_task_id
   for update;

  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;
  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'Only an authorised task editor can change the due date.');
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed or cancelled work cannot receive a new due date.');
  end if;
  if task.version <> p_expected_version then
    return focus.error('version_conflict', 'This work changed while it was open. Refresh and try again.');
  end if;
  if p_new_due_at is null then
    return focus.error('validation_failed', 'Choose a new due date.');
  end if;

  -- v154 - the work cannot fall due before one of its own open steps. A step
  -- that inherits the task's date moves with it and is never in the way; only
  -- a step given its own date can be, and the person is told which one. This
  -- is also the Monthly Plan's drag, which is exactly where it would be missed.
  select ci.action, ci.due_at
    into blocking_step
    from public.task_checklist_items ci
   where ci.task_id = p_task_id
     and ci.state <> 'completed'
     and ci.due_at is not null
     and (ci.due_at at time zone focus.org_time_zone())::date
         > (p_new_due_at at time zone focus.org_time_zone())::date
   order by ci.due_at desc
   limit 1;
  if found then
    return focus.error('validation_failed', format(
      'The step "%s" is due %s, after that date. Move the step first, or choose a later deadline.',
      blocking_step.action,
      to_char(blocking_step.due_at at time zone focus.org_time_zone(), 'FMDD Mon YYYY')));
  end if;
  if clean_reason is not null and length(clean_reason) > 1000 then
    return focus.error('validation_failed', 'Keep the reason to 1,000 characters or fewer.');
  end if;

  if task.due_at is not distinct from p_new_due_at
     and task.due_is_date_only is not distinct from p_due_is_date_only then
    return jsonb_build_object(
      'ok', true,
      'code', 'due_date_unchanged',
      'due_at', task.due_at,
      'due_is_date_only', task.due_is_date_only,
      'version', task.version,
      'changed', false
    );
  end if;

  update public.tasks
     set due_at = p_new_due_at,
         due_is_date_only = p_due_is_date_only,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  event_id := focus.write_audit(
    p_event_type := 'task_due_date_changed',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'previous_due_at', task.due_at,
      'previous_due_is_date_only', task.due_is_date_only,
      'new_due_at', p_new_due_at,
      'new_due_is_date_only', p_due_is_date_only,
      'reason', clean_reason
    )
  );

  -- v185 - who hears about it.
  postponed := task.due_at is not null and p_new_due_at > task.due_at;
  late_days := case
    when task.due_at is not null and task.due_at < now()
      then (now() at time zone zone)::date - (task.due_at at time zone zone)::date
  end;
  select full_name into actor_name from public.user_profiles where id = actor;
  actor_name := coalesce(actor_name, 'A colleague');
  select reporting_manager_id into owner_manager
    from public.user_profiles
   where id = task.primary_owner_id;
  from_text := coalesce(focus.short_org_date(task.due_at), 'no date');
  to_text := focus.short_org_date(p_new_due_at);
  reason_text := case when clean_reason is null then '' else format(' Reason: "%s".', clean_reason) end;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, actor_id, entity_type, entity_id
  )
  select
    recipient.id,
    'due_date_changed',
    'immediate',
    false,
    case
      when recipient.is_owner then format('Due date changed: %s', left(task.title, 120))
      else format('Due date moved: %s', left(task.title, 120))
    end,
    case
      when recipient.is_owner then
        format('%s changed it from %s to %s.%s', actor_name, from_text, to_text, reason_text)
      else
        format(
          '%s moved it from %s to %s.%s%s',
          actor_name,
          from_text,
          to_text,
          case
            when late_days is null then ''
            when late_days <= 0 then ' It was already overdue.'
            when late_days = 1 then ' It was 1 day overdue.'
            else format(' It was %s days overdue.', late_days)
          end,
          reason_text
        )
    end,
    p_task_id,
    actor,
    'task',
    p_task_id
  from (
    select candidate.id, bool_or(candidate.is_owner) as is_owner
      from (
        values
          (task.primary_owner_id, true),
          (owner_manager, false),
          (task.assigned_by, false)
      ) as candidate (id, is_owner)
     where candidate.id is not null
       and candidate.id <> actor
     group by candidate.id
  ) recipient
  join public.user_profiles person
    on person.id = recipient.id
   and person.status = 'active'
  left join public.user_alert_preferences pref
    on pref.user_id = recipient.id
  where (coalesce(pref.due_today_and_deadlines, true) or task.is_mandatory)
    and (recipient.is_owner or postponed);

  -- A date back in the future answers the owner's overdue notice.
  if p_new_due_at > now() then
    update public.notifications
       set read_at = now()
     where kind = 'work_overdue'
       and task_id = p_task_id
       and read_at is null;
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', 'task_due_date_changed',
    'due_at', p_new_due_at,
    'due_is_date_only', p_due_is_date_only,
    'version', task.version + 1,
    'audit_event_id', event_id,
    'changed', true
  );
  return focus.remember_operation(actor, p_idempotency_key, 'change_task_due_date', result);
end;
$function$;
