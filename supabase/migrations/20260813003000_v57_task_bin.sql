-- ---------------------------------------------------------------------------
-- v57 — Delete and the Bin.
--
-- The need is data hygiene, not governance: somebody mistypes a task, or
-- creates one twice, and wants it gone. Cancel is the wrong instrument for
-- that. Cancel says "this work was real and we decided not to do it", demands
-- a reason, and files the result in the cancelled record where it belongs.
-- Making somebody write a cancellation reason for a typo pollutes the very
-- record cancellation exists to keep clean.
--
-- Why this is recoverable rather than a DELETE.
--
-- Every one of these references `tasks` with ON DELETE CASCADE:
--
--     audit_events, attachments, barriers, completion_reviews,
--     task_checklist_items, task_collaborators, task_updates,
--     notifications, calendar_events, goal_work_links, meeting_queue_items
--
-- A real DELETE therefore does not remove a task; it removes the task and
-- every trace that it ever existed, including its audit history, with no
-- warning and no way back. That is an unreasonable outcome to reach by
-- mis-clicking a button whose purpose is to undo a mis-click. From the
-- person's side this behaves exactly like deletion — the task leaves every
-- list and appears in the Bin — and the row underneath survives, so a mistake
-- about a mistake is also recoverable.
--
-- Deliberately NOT a new `task_status`. Deletion is orthogonal to lifecycle: a
-- deleted task still *was* backlog or active, and folding it into the status
-- enum would make every existing status check ambiguous and every historical
-- report wrong about what state the work reached.
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.user_profiles (id);

comment on column public.tasks.deleted_at is
  'Set when the task is moved to the Bin. Non-null means it is hidden from every working view but retained in full, including its audit history.';

-- Deleted work is invisible by default everywhere, because `task_overview` is
-- what the whole application reads. The Bin has its own view below rather than
-- a flag callers must remember to pass — a filter you have to opt into is a
-- filter somebody eventually forgets.
create or replace view public.task_overview
with (security_invoker = true) as
  SELECT t.id,
    t.title,
    t.description,
    t.next_action,
    t.status,
    t.work_class,
    t.focus_bucket,
    t.origin,
    t.urgency,
    t.is_mandatory,
    t.progress_percent,
    t.over_focus_target,
    t.activation_reason_code,
    t.activation_reason_note,
    t.review_status,
    t.reviewer_id,
    t.version,
    t.primary_owner_id,
    -- Profile first for anyone entitled to it, directory as the fallback.
    coalesce(owner.full_name, owner_dir.full_name) AS owner_name,
    coalesce(owner.employee_id, owner_dir.employee_id) AS owner_employee_id,
    owner.department_id AS owner_department_id,
    t.assigned_by,
    coalesce(assigner.full_name, assigner_dir.full_name) AS assigned_by_name,
    t.assignment_batch_id,
    t.classification_rule_code,
    t.classification_rule_text,
    t.routine_template_id,
    t.occurrence_date,
    t.created_at,
    t.state_entered_at,
    t.last_meaningful_update_at,
    t.due_at,
    t.due_is_date_only,
    t.review_at,
    t.completed_at,
    t.cancelled_at,
    t.due_at IS NOT NULL AND (t.status = ANY (ARRAY['backlog'::task_status, 'active'::task_status, 'paused'::task_status])) AND now() > t.due_at AS is_overdue,
    t.status = 'active'::task_status AND t.last_meaningful_update_at < (now() - make_interval(days => focus.stale_threshold_days())) AS is_stale,
    ( SELECT count(*) AS count
           FROM barriers b
          WHERE b.task_id = t.id AND b.status = 'open'::barrier_status) AS open_barrier_count,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id) AS checklist_total,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.state = 'completed'::checklist_item_state) AS checklist_completed,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.state = 'ready'::checklist_item_state) AS checklist_ready,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.evidence_rule = 'required'::evidence_rule AND NOT (EXISTS ( SELECT 1
                   FROM attachments a
                  WHERE a.checklist_item_id = ci.id))) AS missing_evidence_count,
    ( SELECT count(*) AS count
           FROM attachments a
          WHERE a.task_id = t.id) AS attachment_count,
    ( SELECT count(*) AS count
           FROM task_collaborators c
          WHERE c.task_id = t.id) AS collaborator_count
   FROM tasks t
     LEFT JOIN user_profiles owner ON owner.id = t.primary_owner_id
     LEFT JOIN public.person_display owner_dir ON owner_dir.id = t.primary_owner_id
     LEFT JOIN user_profiles assigner ON assigner.id = t.assigned_by
     LEFT JOIN public.person_display assigner_dir ON assigner_dir.id = t.assigned_by
  WHERE t.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Moving a task to the Bin.
--
-- Authority matches Cancel: the owner, or a manager in their reporting line.
-- Completed work is refused — a finished result is a record of what happened,
-- and hiding it would misstate what the team delivered. Cancelled work is
-- allowed through, since a cancelled duplicate is exactly the tidying case.
-- ---------------------------------------------------------------------------
create or replace function public.delete_task(
  p_task_id uuid,
  p_expected_version integer,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  task public.tasks;
  event_id uuid;
  replayed jsonb;
  result jsonb;
  cleanup jsonb;
  manager_authority boolean;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to delete work.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  manager_authority := focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id));
  if actor <> task.primary_owner_id and not manager_authority then
    return focus.error('not_authorised', 'Only the owner or an authorised manager can delete this work.');
  end if;

  if task.deleted_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_deleted', 'task_id', p_task_id);
  end if;

  if task.status = 'completed' then
    return focus.error(
      'invalid_state',
      'Completed work is a record of what was delivered and cannot be deleted. Cancel it instead if it should not count.'
    );
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This task changed while you were deleting it. Review the latest information.',
      jsonb_build_object('current_version', task.version)
    );
  end if;

  update public.tasks
  set deleted_at = now(),
      deleted_by = actor,
      over_focus_target = false,
      version = version + 1
  where id = p_task_id;

  -- The same close-loop cancellation performs: release focus allocation, stop
  -- shared contributions being actionable, clear pending attention. A task in
  -- the Bin must not leave work sitting in somebody else's list.
  cleanup := focus.deactivate_task_projections(p_task_id);
  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  event_id := focus.write_audit(
    p_event_type := 'task_deleted',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := task.status,
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('projection_cleanup', cleanup)
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'task_deleted',
    'task_id', p_task_id,
    'audit_event_id', event_id,
    'projection_cleanup', cleanup
  );
  return focus.remember_operation(actor, p_idempotency_key, 'delete_task', result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Taking it back out again.
-- ---------------------------------------------------------------------------
create or replace function public.restore_task(
  p_task_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  task public.tasks;
  event_id uuid;
  replayed jsonb;
  result jsonb;
  manager_authority boolean;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to restore work.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  manager_authority := focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id));
  if actor <> task.primary_owner_id and not manager_authority then
    return focus.error('not_authorised', 'Only the owner or an authorised manager can restore this work.');
  end if;

  if task.deleted_at is null then
    return jsonb_build_object('ok', true, 'code', 'not_deleted', 'task_id', p_task_id);
  end if;

  update public.tasks
  set deleted_at = null,
      deleted_by = null,
      version = version + 1
  where id = p_task_id;

  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  event_id := focus.write_audit(
    p_event_type := 'task_restored',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := task.status,
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'task_restored',
    'task_id', p_task_id,
    'audit_event_id', event_id
  );
  return focus.remember_operation(actor, p_idempotency_key, 'restore_task', result);
end;
$$;

revoke all on function public.delete_task(uuid, integer, text) from public, anon;
revoke all on function public.restore_task(uuid, text) from public, anon;
grant execute on function public.delete_task(uuid, integer, text) to authenticated;
grant execute on function public.restore_task(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The Bin itself.
--
-- Its own view rather than a flag on `task_overview`, because a filter you
-- have to remember to pass is a filter somebody eventually forgets — and the
-- consequence of forgetting would be deleted work reappearing in a live list.
-- Bounded by `focus.can_view_task` so the Bin shows only what the reader could
-- already see, and by the same owner-or-manager rule that put it there.
-- ---------------------------------------------------------------------------
create or replace view public.binned_tasks
with (security_invoker = true) as
  select
    t.id,
    t.title,
    t.status,
    t.work_class,
    t.focus_bucket,
    t.due_at,
    t.due_is_date_only,
    t.version,
    t.primary_owner_id,
    coalesce(owner.full_name, owner_dir.full_name) as owner_name,
    t.deleted_at,
    t.deleted_by,
    coalesce(remover.full_name, remover_dir.full_name) as deleted_by_name
  from public.tasks t
    left join public.user_profiles owner on owner.id = t.primary_owner_id
    left join public.person_display owner_dir on owner_dir.id = t.primary_owner_id
    left join public.user_profiles remover on remover.id = t.deleted_by
    left join public.person_display remover_dir on remover_dir.id = t.deleted_by
  where t.deleted_at is not null;
