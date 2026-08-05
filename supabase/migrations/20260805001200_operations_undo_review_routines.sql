-- ============================================================================
-- TAMCO Focus — Undo, checklist, barriers, completion review, routines
--
-- Implements MASTER_PRODUCT_SPEC.md sections 11, 14, 16, 20, 24.3 and
-- PRODUCTION_LOGIC.md sections 3.3, 4.
-- ============================================================================

-- ============================================================================
-- Undo (section 24.3; PRODUCTION_LOGIC.md section 3.3)
--
-- Undo NEVER deletes history. It performs the inverse transition and writes a
-- new audit event carrying `reversal_of_event_id`, so both the original action
-- and its reversal remain readable forever.
-- ============================================================================

create or replace function public.undo_event(
  p_event_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  event record;
  task record;
  window_seconds integer;
  restored_status public.task_status;
  reversal_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to undo.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into event from public.audit_events where id = p_event_id;
  if not found then return focus.error('not_found', 'That action is no longer available to undo.'); end if;

  -- Only the person who performed the action may undo it.
  if event.actor_id is distinct from actor then
    return focus.error('not_authorised', 'Only the person who made this change can undo it.');
  end if;

  window_seconds := coalesce((focus.setting('focus.undo_window_seconds'))::integer, 30);
  if event.occurred_at < now() - make_interval(secs => window_seconds) then
    return focus.error('undo_window_expired',
      'The undo period for this action has passed. Make the change directly instead.');
  end if;

  if exists (select 1 from public.audit_events where reversal_of_event_id = p_event_id) then
    return focus.error('already_reversed', 'This action has already been undone.');
  end if;

  -- Which transitions can be reversed, and to what.
  restored_status := case event.event_type
    when 'task_activated'            then event.previous_status
    when 'over_target_activation'    then event.previous_status
    when 'task_moved_to_available'   then 'active'::public.task_status
    when 'task_paused'               then event.previous_status
    else null
  end;

  if restored_status is null and event.event_type <> 'checklist_item_completed' then
    return focus.error('not_reversible', 'This kind of change cannot be undone automatically.');
  end if;

  -- Checklist completion reverses through the reopen path (section 11.4), which
  -- also returns any dependent handoff to Waiting.
  if event.event_type = 'checklist_item_completed' then
    update public.task_checklist_items
       set state = 'ready', completed_by = null, completed_at = null, completion_note = null
     where id = (event.detail ->> 'checklist_item_id')::uuid;

    reversal_id := focus.write_audit(
      p_event_type := 'event_reversed',
      p_actor_id := actor,
      p_task_id := event.task_id,
      p_reversal_of := p_event_id,
      p_detail := event.detail || jsonb_build_object('reversed_event_type', event.event_type)
    );

    result := jsonb_build_object('ok', true, 'code', 'undone',
                                 'audit_event_id', reversal_id);
    return focus.remember_operation(actor, p_idempotency_key, 'undo_event', result);
  end if;

  select * into task from public.tasks where id = event.task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_edit_task(task.id) then
    return focus.error('not_authorised', 'You are not authorised to change this work.');
  end if;

  update public.tasks
     set status = restored_status,
         over_focus_target = false,
         activation_reason_code = null,
         activation_reason_note = null,
         activated_at = case when restored_status = 'active' then activated_at else null end,
         activated_by = case when restored_status = 'active' then activated_by else null end,
         version = version + 1
   where id = task.id;

  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  -- Restoring to Active can legitimately re-create an over-target condition;
  -- recalculate rather than assume.
  if restored_status = 'active' and task.focus_bucket is not null then
    if focus.active_focus_count(task.primary_owner_id, task.focus_bucket)
       > coalesce(focus.effective_focus_target(task.primary_owner_id, task.focus_bucket), 0)
    then
      update public.tasks set over_focus_target = true where id = task.id;
    end if;
  end if;

  reversal_id := focus.write_audit(
    p_event_type := 'event_reversed',
    p_actor_id := actor,
    p_task_id := task.id,
    p_previous_status := task.status,
    p_new_status := restored_status,
    p_bucket := task.focus_bucket,
    p_count_after := focus.active_focus_count(task.primary_owner_id, task.focus_bucket),
    p_target := focus.effective_focus_target(task.primary_owner_id, task.focus_bucket),
    p_reversal_of := p_event_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('reversed_event_type', event.event_type)
  );

  result := jsonb_build_object('ok', true, 'code', 'undone',
                               'task', focus.task_snapshot(task.id),
                               'audit_event_id', reversal_id);
  return focus.remember_operation(actor, p_idempotency_key, 'undo_event', result);
end;
$$;

-- ============================================================================
-- Checklist completion (section 11.2, 11.3)
--
-- When a checklist exists it is the single progress source, so this procedure
-- also recomputes `progress_percent`. The interface never asks for a conflicting
-- manual percentage on a task that has a checklist.
-- ============================================================================

create or replace function public.complete_checklist_item(
  p_item_id uuid,
  p_completion_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  if not (focus.can_contribute_to_task(item.task_id) or item.assigned_to = actor) then
    return focus.error('not_authorised', 'You are not authorised to complete this step.');
  end if;

  if item.state = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_completed');
  end if;

  -- Section 13.3 — a step waiting on a prerequisite is not yet actionable.
  if item.state = 'waiting' then
    return focus.error('waiting_on_prerequisite',
      'An earlier step must be completed before this one becomes ready.');
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
    item.task_id, null, actor)
  from public.task_checklist_items ci
  where ci.depends_on_item_id = p_item_id
    and ci.state = 'ready'
    and ci.assigned_to is not null;

  result := jsonb_build_object('ok', true, 'code', 'completed',
                               'progress_percent', new_progress,
                               'audit_event_id', event_id);
  return focus.remember_operation(actor, p_idempotency_key, 'complete_checklist_item', result);
end;
$$;

-- Section 11.4 — reopening creates a reversal event and does not erase the
-- original completion event.
create or replace function public.reopen_checklist_item(
  p_item_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  item record;
  total_items integer;
  done_items integer;
  new_progress integer;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to reopen a step.');
  end if;

  select * into item from public.task_checklist_items where id = p_item_id for update;
  if not found then return focus.error('not_found', 'This step no longer exists.'); end if;

  if not focus.can_contribute_to_task(item.task_id) then
    return focus.error('not_authorised', 'You are not authorised to reopen this step.');
  end if;

  if item.state <> 'completed' then
    return focus.error('invalid_state', 'Only a completed step can be reopened.');
  end if;

  update public.task_checklist_items
     set state = 'ready', completed_by = null, completed_at = null, completion_note = null
   where id = p_item_id;

  select count(*), count(*) filter (where state = 'completed')
    into total_items, done_items
    from public.task_checklist_items where task_id = item.task_id;

  new_progress := case when total_items = 0 then 0 else (done_items * 100) / total_items end;

  update public.tasks
     set progress_percent = new_progress,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = item.task_id;

  perform focus.write_audit(
    p_event_type := 'checklist_item_reopened',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_detail := jsonb_build_object(
      'checklist_item_id', p_item_id, 'action', item.action, 'reason', p_reason)
  );

  return jsonb_build_object('ok', true, 'code', 'reopened', 'progress_percent', new_progress);
end;
$$;

-- ============================================================================
-- Barriers (section 14)
--
-- A barrier does NOT automatically pause a task. Only an explicit statement
-- that work cannot continue changes the state.
-- ============================================================================

create or replace function public.raise_barrier(
  p_task_id uuid,
  p_description text,
  p_support_needed text,
  p_impact public.barrier_impact,
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
  manager_id uuid;
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
      'Describe the barrier and the support needed before submitting.');
  end if;

  insert into public.barriers (
    task_id, description, support_needed, impact, add_to_meeting_queue, raised_by
  ) values (
    p_task_id, p_description, p_support_needed, p_impact, p_add_to_meeting_queue, actor
  )
  returning id into barrier_id;

  blocks_work := p_impact = 'cannot_continue';

  -- Section 14.3 — pause only when work genuinely cannot continue, and record
  -- the review information the paused state requires.
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

  select reporting_manager_id into manager_id
    from public.user_profiles where id = task.primary_owner_id;

  perform focus.notify(
    manager_id,
    case when blocks_work then 'work_cannot_continue'::public.notification_kind
         else 'barrier_raised'::public.notification_kind end,
    'immediate', true,
    case when blocks_work then 'Work cannot continue' else 'Barrier raised' end,
    format('%s raised a barrier on "%s": %s',
           (select full_name from public.user_profiles where id = actor),
           task.title, p_description),
    p_task_id, barrier_id, actor);

  -- The owner needs to know too, when a collaborator raised it.
  perform focus.notify(
    task.primary_owner_id, 'barrier_raised', 'immediate', true,
    'Barrier raised on your work',
    format('%s raised a barrier on "%s".',
           (select full_name from public.user_profiles where id = actor), task.title),
    p_task_id, barrier_id, actor);

  event_id := focus.write_audit(
    p_event_type := 'barrier_raised',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := case when blocks_work and task.status = 'active'
                         then 'paused'::public.task_status else task.status end,
    p_detail := jsonb_build_object(
      'barrier_id', barrier_id, 'impact', p_impact, 'paused_task', blocks_work)
  );

  result := jsonb_build_object('ok', true, 'code', 'barrier_raised',
                               'barrier_id', barrier_id,
                               'task_paused', blocks_work and task.status = 'active',
                               'task', focus.task_snapshot(p_task_id),
                               'audit_event_id', event_id);
  return focus.remember_operation(actor, p_idempotency_key, 'raise_barrier', result);
end;
$$;

create or replace function public.resolve_barrier(
  p_barrier_id uuid,
  p_resolution_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  barrier record;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to resolve a barrier.');
  end if;

  select * into barrier from public.barriers where id = p_barrier_id for update;
  if not found then return focus.error('not_found', 'This barrier no longer exists.'); end if;

  if not focus.can_edit_task(barrier.task_id) then
    return focus.error('not_authorised', 'You are not authorised to resolve this barrier.');
  end if;

  if barrier.status = 'resolved' then
    return jsonb_build_object('ok', true, 'code', 'already_resolved');
  end if;

  if length(btrim(coalesce(p_resolution_note, ''))) = 0 then
    return focus.error('validation_failed', 'Record how the barrier was resolved.');
  end if;

  update public.barriers
     set status = 'resolved', resolved_by = actor,
         resolved_at = now(), resolution_note = p_resolution_note
   where id = p_barrier_id;

  update public.tasks
     set last_meaningful_update_at = now(), version = version + 1
   where id = barrier.task_id;

  perform focus.notify(
    barrier.raised_by, 'barrier_raised', 'immediate', false,
    'Barrier resolved',
    format('The barrier you raised was resolved: %s', p_resolution_note),
    barrier.task_id, p_barrier_id, actor);

  perform focus.write_audit(
    p_event_type := 'barrier_resolved',
    p_actor_id := actor,
    p_task_id := barrier.task_id,
    p_detail := jsonb_build_object('barrier_id', p_barrier_id, 'note', p_resolution_note)
  );

  -- A resolved barrier leaves the task paused on purpose: resuming is an
  -- explicit decision by the owner under the ordinary focus rules, not an
  -- automatic side effect (section 15.3 — relationships and events must not
  -- silently change status).
  return jsonb_build_object('ok', true, 'code', 'resolved');
end;
$$;

-- ============================================================================
-- Completion review (section 20.5, 20.6)
--
-- Viewing evidence is logged automatically and is NOT acceptance. The reviewer
-- must make an explicit decision here.
-- ============================================================================

create or replace function public.record_attachment_view(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  attachment record;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account.');
  end if;

  select * into attachment from public.attachments where id = p_attachment_id;
  if not found then return focus.error('not_found', 'This attachment no longer exists.'); end if;

  if not focus.can_view_task(attachment.task_id) then
    return focus.error('not_authorised', 'You are not authorised to open this attachment.');
  end if;

  insert into public.attachment_views (attachment_id, viewer_id)
  values (p_attachment_id, actor);

  perform focus.write_audit(
    p_event_type := 'attachment_opened',
    p_actor_id := actor,
    p_task_id := attachment.task_id,
    p_detail := jsonb_build_object(
      'attachment_id', p_attachment_id, 'file_name', attachment.file_name)
  );

  return jsonb_build_object('ok', true, 'code', 'view_recorded');
end;
$$;

create or replace function public.decide_completion_review(
  p_task_id uuid,
  p_decision public.review_decision,
  p_note text default null,
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
  review record;
  outcome text;
  restored_status public.task_status;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to review work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_review_task(p_task_id) then
    return focus.error('not_authorised',
      'Only an independent reviewer can decide this completion.');
  end if;

  select * into review
    from public.completion_reviews
   where task_id = p_task_id and decision is null
   for update;

  if not found then
    return focus.error('invalid_state', 'This work has no review awaiting a decision.');
  end if;

  update public.completion_reviews
     set reviewer_id = actor, decision = p_decision,
         decision_note = p_note, decided_at = now()
   where id = review.id;

  if p_decision = 'accepted' then
    update public.tasks
       set review_status = 'decided', reviewer_id = actor, version = version + 1
     where id = p_task_id;

    event_id := focus.write_audit(
      p_event_type := 'completion_accepted',
      p_actor_id := actor, p_task_id := p_task_id,
      p_task_version := task.version + 1,
      p_detail := jsonb_build_object('note', p_note));

    perform focus.notify(
      task.primary_owner_id, 'completion_review_assigned', 'digest', false,
      'Completion accepted',
      format('Your completion of "%s" was accepted.', task.title),
      p_task_id, null, actor);

    result := jsonb_build_object('ok', true, 'code', 'accepted',
                                 'task', focus.task_snapshot(p_task_id),
                                 'audit_event_id', event_id);
  else
    -- Section 20.6 — the outcome is read from Settings, never invented here.
    outcome := coalesce(focus.setting('review.request_changes_outcome') #>> '{}',
                        'return_to_available');
    restored_status := case outcome
      when 'reopen_active' then 'active'::public.task_status
      else 'backlog'::public.task_status
    end;

    update public.tasks
       set status = restored_status,
           completed_at = null,
           review_status = 'decided',
           reviewer_id = actor,
           last_meaningful_update_at = now(),
           version = version + 1
     where id = p_task_id;

    -- Reopening to Active can put the owner above target; recalculate rather
    -- than assume, and never block the reviewer's decision on it.
    if restored_status = 'active' and task.focus_bucket is not null then
      if focus.active_focus_count(task.primary_owner_id, task.focus_bucket)
         > coalesce(focus.effective_focus_target(task.primary_owner_id, task.focus_bucket), 0)
      then
        update public.tasks set over_focus_target = true where id = p_task_id;
      end if;
    end if;

    event_id := focus.write_audit(
      p_event_type := 'changes_requested',
      p_actor_id := actor, p_task_id := p_task_id,
      p_previous_status := 'completed', p_new_status := restored_status,
      p_task_version := task.version + 1,
      p_detail := jsonb_build_object('note', p_note, 'outcome', outcome));

    perform focus.notify(
      task.primary_owner_id, 'completion_review_assigned', 'immediate', true,
      'Changes requested',
      format('"%s" needs more work: %s', task.title, coalesce(p_note, 'see review note')),
      p_task_id, null, actor);

    result := jsonb_build_object('ok', true, 'code', 'changes_requested',
                                 'outcome', outcome,
                                 'task', focus.task_snapshot(p_task_id),
                                 'audit_event_id', event_id);
  end if;

  return focus.remember_operation(actor, p_idempotency_key, 'decide_completion_review', result);
end;
$$;

-- ============================================================================
-- Routine occurrence generation (section 16.1, 16.3)
--
-- Generation is idempotent: the unique index on
-- (routine_template_id, occurrence_date) means a repeated or overlapping run
-- inserts nothing new. Only current and near-term occurrences are created, so
-- future cycles do not flood the interface (section 16.3).
-- ============================================================================

create or replace function focus.next_occurrence_date(
  p_template public.routine_templates,
  p_after date
)
returns date
language plpgsql
immutable
as $$
declare
  candidate date;
  target_dom integer;
begin
  case p_template.frequency
    when 'daily' then
      candidate := p_after + (p_template.interval_count || ' days')::interval;

    when 'weekly' then
      -- Advance to the next occurrence of the template's weekday, then add any
      -- additional whole intervals (2 = fortnightly).
      candidate := p_after + 1;
      while extract(isodow from candidate)::integer <> p_template.weekday loop
        candidate := candidate + 1;
      end loop;
      candidate := candidate + ((p_template.interval_count - 1) * 7);

    when 'monthly' then
      candidate := (date_trunc('month', p_after)
                    + (p_template.interval_count || ' months')::interval)::date;
      -- Clamp 29-31 to the last day of a short month rather than rolling into
      -- the next one.
      target_dom := least(
        p_template.day_of_month,
        extract(day from (date_trunc('month', candidate)
                          + interval '1 month - 1 day'))::integer
      );
      candidate := candidate + (target_dom - 1);
  end case;

  return candidate;
end;
$$;

create or replace function public.generate_routine_occurrences(
  p_through date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  template record;
  horizon date;
  cursor_date date;
  new_task_id uuid;
  created integer := 0;
  lead_days integer;
begin
  -- Callable by an authorised maintainer, or by the scheduled worker running as
  -- the service role (for which auth.uid() is null).
  if auth.uid() is not null and not focus.is_manager_or_admin() then
    return focus.error('not_authorised',
      'Only a manager or administrator can generate routine occurrences.');
  end if;

  lead_days := coalesce((focus.setting('routine.occurrence_lead_days'))::integer, 14);
  horizon := coalesce(p_through, (current_date + lead_days));

  for template in
    select * from public.routine_templates where is_active = true
  loop
    cursor_date := coalesce(template.generated_through, current_date - 1);

    loop
      cursor_date := focus.next_occurrence_date(template, cursor_date);
      exit when cursor_date > horizon;

      insert into public.tasks (
        title, description, next_action, status, work_class, focus_bucket, origin,
        urgency, primary_owner_id, created_by,
        due_at, due_is_date_only,
        routine_template_id, occurrence_date
      ) values (
        template.title, template.description, null, 'backlog', 'routine_occurrence', null,
        'routine_generated', 'normal', template.default_owner_id, template.created_by,
        -- The occurrence is due at the template's local time of day on its
        -- cycle date, stored as an absolute instant.
        (cursor_date + template.due_time) at time zone
          coalesce(current_setting('focus.org_timezone', true), 'Asia/Kuala_Lumpur'),
        false,
        template.id, cursor_date
      )
      on conflict (routine_template_id, occurrence_date) do nothing
      returning id into new_task_id;

      if new_task_id is not null then
        -- Copy the template's steps on to this occurrence.
        insert into public.task_checklist_items (task_id, position, action, evidence_rule)
        select new_task_id, ti.position, ti.action, ti.evidence_rule
          from public.routine_template_items ti
         where ti.template_id = template.id;

        perform focus.write_audit(
          p_event_type := 'routine_occurrence_generated',
          p_actor_id := auth.uid(),
          p_task_id := new_task_id,
          p_detail := jsonb_build_object(
            'template_id', template.id, 'occurrence_date', cursor_date));

        created := created + 1;
        new_task_id := null;
      end if;
    end loop;

    update public.routine_templates
       set generated_through = horizon
     where id = template.id;
  end loop;

  return jsonb_build_object('ok', true, 'code', 'generated', 'created', created);
end;
$$;

-- ============================================================================
-- Routine findings (section 16.4)
--
-- A significant finding creates linked Operational AVAILABLE Work. The new
-- owner then decides activation under the ordinary focus rules — the finding
-- never activates anything on their behalf. An immediate serious risk creates
-- mandatory work, which section 4 allows to activate above target.
-- ============================================================================

create or replace function public.record_routine_finding(
  p_occurrence_task_id uuid,
  p_severity public.finding_severity,
  p_description text,
  p_follow_up_owner_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      follow_up_id, null, actor);
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
$$;
