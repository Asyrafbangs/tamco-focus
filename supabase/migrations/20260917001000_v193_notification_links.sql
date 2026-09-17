-- ============================================================================
-- TAMCO Focus v193 — Every notice links to the right place
--
-- Found by reconciling Production's notifications on 17 September 2026 (see
-- docs/notification-debug-v193.md). Recipients were right and emails went out
-- within a minute; three things about where a notice leads were not:
--
-- 1. Wrong links. Three step triggers created their notice and then linked it
--    with an update matching EVERY unread, unlinked notice the person had on
--    that work. A "Decision needed", "Discussion scheduled", "Work reassigned"
--    or "Over focus target" notice sitting unread was re-pointed at a step.
--    Production holds three such notices.
-- 2. Dead links. "Work reassigned", "Contribution reassigned", "Contribution
--    withdrawn" and "Contribution removed" linked to work the recipient had
--    just lost, so the button opened "not found".
-- 3. Barrier notices on work carried `barrier_id` but no entity, so "Decision
--    needed" opened the work, not the decision. Goal barriers were already
--    linked.
--
-- `focus.notify_notice` is `focus.notify` that also takes the notice's link
-- and returns its id. `focus.notify` keeps its signature and calls it, and a
-- notice about a barrier is now linked to that barrier.
-- ============================================================================

create or replace function focus.notify_notice(
  p_recipient uuid,
  p_kind notification_kind,
  p_channel notification_channel,
  p_requires_action boolean,
  p_title text,
  p_body text,
  p_task_id uuid default null,
  p_barrier_id uuid default null,
  p_actor_id uuid default null,
  p_alert text default null,
  p_entity_type text default null,
  p_entity_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  notice_id uuid;
  link_type text := coalesce(p_entity_type, case when p_barrier_id is not null then 'barrier' end);
  link_id uuid := case when p_entity_type is not null then p_entity_id else p_barrier_id end;
begin
  -- Never notify someone about their own action, and never notify a
  -- deactivated account.
  if p_recipient is null or p_recipient = p_actor_id then
    return null;
  end if;

  if not exists (
    select 1 from public.user_profiles where id = p_recipient and status = 'active'
  ) then
    return null;
  end if;

  -- v186 - `p_alert` names the My Alerts switch this notice answers to. Off,
  -- the notice stays in the bell and is not emailed.
  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, barrier_id, actor_id, quiet, entity_type, entity_id
  ) values (
    p_recipient, p_kind, p_channel, p_requires_action, p_title, p_body,
    p_task_id, p_barrier_id, p_actor_id,
    not focus.alert_is_on(p_recipient, p_alert),
    case when link_id is null then null else link_type end,
    case when link_type is null then null else link_id end
  )
  returning id into notice_id;

  return notice_id;
end;
$$;

comment on function focus.notify_notice(uuid, notification_kind, notification_channel, boolean, text, text, uuid, uuid, uuid, text, text, uuid) is
  'v193 - focus.notify with an explicit link, returning the notice id. A notice about a barrier links to it unless told otherwise.';

revoke all on function focus.notify_notice(uuid, notification_kind, notification_channel, boolean, text, text, uuid, uuid, uuid, text, text, uuid) from public, anon, authenticated;

create or replace function focus.notify(
  p_recipient uuid,
  p_kind notification_kind,
  p_channel notification_channel,
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
  perform focus.notify_notice(
    p_recipient, p_kind, p_channel, p_requires_action, p_title, p_body,
    p_task_id, p_barrier_id, p_actor_id, p_alert);
end;
$$;

-- ---------------------------------------------------------------------------
-- The step triggers, reassignment and step removal: v190/v186 bodies, each
-- notice linked where it is written.
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

  -- v193 - the notice carries its own step. It used to be linked afterwards by
  -- an update matching every unread, unlinked notice this person had on the
  -- work, which re-pointed a barrier or reassignment notice at the step.
  perform focus.notify_notice(
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
    focus.work_alert(new.task_id, 'collaboration_handoff'),
    'checklist_item',
    new.id);

  return new;
end;
$function$;

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

  -- v193 - linked to its own step, not by a broad update (see
  -- notify_contribution_created).
  perform focus.notify_notice(
    new.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'Your contribution is ready',
    format('%s · Part of "%s". Nothing is blocking it now.', new.action, parent.title),
    new.task_id,
    null,
    null,
    focus.work_alert(new.task_id, 'collaboration_handoff'),
    'checklist_item',
    new.id);

  return new;
end;
$function$;

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
    -- v193 - linked to its own step, not by a broad update.
    perform focus.notify_notice(
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
      focus.work_alert(new.task_id, 'collaboration_handoff'),
      'checklist_item',
      new.id);
  elsif new.assigned_to is not null then
    -- v161 - handed to the owner by somebody else: a step on their own work.
    perform focus.notify_step_for_owner(new, parent, actor, assigner_name, 'Assigned to you by');
  end if;

  -- The previous assignee learns it left their list, but is not asked to act -
  -- v161: wherever it went, including back to the owner or to nobody.
  if old.assigned_to is not null
     and old.assigned_to <> parent.primary_owner_id then
    -- v193 - it has left their list, and usually their sight: the link goes to
    -- their Shared list, not to work they can no longer open.
    perform focus.notify_notice(
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
      focus.work_alert(new.task_id, 'collaboration_handoff'),
      'released_contribution',
      new.id);
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
  -- v193 - the previous owner can no longer open it: the link goes to their
  -- own work, not to a page that says the work does not exist.
  perform focus.notify_notice(
    previous_owner, 'ownership_changed', 'immediate', false,
    'Work reassigned',
    format('"%s" was reassigned to %s.', task.title,
      (select full_name from public.user_profiles where id = p_new_owner_id)),
    p_task_id, null, actor,
    focus.work_alert(p_task_id, 'assignment_changes'),
    'released_task',
    p_task_id
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
    -- v193 - the step is about to be deleted: the link goes to their Shared list.
    perform focus.notify_notice(
      item.assigned_to,
      'collaboration_handoff', 'digest', false,
      'Contribution removed',
      format('"%s" was removed from the checklist. It is no longer on your Shared list.',
             item.action),
      item.task_id, null, actor,
      focus.work_alert(item.task_id, 'collaboration_handoff'),
      'released_contribution',
      item.id);
  end if;

  delete from public.task_checklist_items where id = p_item_id;

  perform focus.recalculate_checklist_readiness(item.task_id);

  result := jsonb_build_object('ok', true, 'code', 'checklist_step_removed',
                               'item_id', p_item_id);
  return focus.remember_operation(actor, p_idempotency_key, 'remove_checklist_step', result);
end;
$function$;


-- ---------------------------------------------------------------------------
-- Existing notices. Emails already sent cannot be changed; the bell can.
-- ---------------------------------------------------------------------------

-- Barrier notices on work: link to the barrier, including those re-pointed at
-- a step by the broad update.
update public.notifications
   set entity_type = 'barrier', entity_id = barrier_id
 where barrier_id is not null
   and (entity_type is null or entity_type = 'checklist_item');

-- Work that left somebody: their own lists.
update public.notifications
   set entity_type = 'released_task', entity_id = task_id
 where title = 'Work reassigned'
   and task_id is not null
   and (entity_type is null or entity_type = 'checklist_item');

update public.notifications
   set entity_type = 'released_contribution', entity_id = task_id
 where title in ('Contribution reassigned', 'Contribution withdrawn', 'Contribution removed')
   and task_id is not null
   and (entity_type is null or entity_type = 'checklist_item');

-- Anything else re-pointed at a step that is not about a step goes back to
-- its work.
update public.notifications
   set entity_type = null, entity_id = null
 where entity_type = 'checklist_item'
   and barrier_id is null
   and kind not in ('collaboration_handoff', 'due_soon', 'due_date_changed');
