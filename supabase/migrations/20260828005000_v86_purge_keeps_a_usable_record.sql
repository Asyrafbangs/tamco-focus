-- ---------------------------------------------------------------------------
-- v86 - what a permanently deleted record leaves behind.
--
-- Emptying the Bin already keeps the row: `purge_task` sets `purged_at` and
-- the views filter on it, so nothing is destroyed, and `audit_events` is
-- append-only by trigger. What it wrote, though, was two fields - the title
-- and when it was binned - which is not enough to answer "what was that, and
-- whose was it" a year later.
--
-- The record now carries who created it, who owned it, what kind of work it
-- was, the state it was in, and whether anybody else had been given a step on
-- it. That last one matters most: work another person contributed to is work
-- somebody else can be asked about.
--
-- No change to who may purge, or to what a purge does. Deleting is already the
-- creator's alone, and completed work cannot be deleted at all - it is a
-- record of what was delivered.
-- ---------------------------------------------------------------------------

create or replace function public.purge_task(
  p_task_id uuid,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  actor uuid := auth.uid();
  task public.tasks%rowtype;
  replayed jsonb;
  result jsonb;
  contributor_count integer;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to empty the Bin.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id;
  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;

  if task.purged_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_purged', 'task_id', p_task_id);
  end if;

  -- Only from the Bin. Emptying is the second half of deleting, never a
  -- shortcut past it: live work has to be deleted first, and that step is the
  -- one that can be undone.
  if task.deleted_at is null then
    return focus.error(
      'invalid_state',
      'Only work that is already in the Bin can be permanently deleted.');
  end if;

  -- The same authority as deleting: the person who created it, or an
  -- administrator. Ownership can move; authorship cannot.
  if not focus.can_delete_task(p_task_id) then
    return focus.error(
      'not_authorised',
      'Only the person who created this work can permanently delete it.');
  end if;

  select count(*) into contributor_count
    from public.task_checklist_items ci
   where ci.task_id = p_task_id
     and ci.assigned_to is not null
     and ci.assigned_to <> task.created_by;

  update public.tasks
     set purged_at = now(), purged_by = actor, updated_at = now()
   where id = p_task_id;

  -- Enough to identify the work and the people attached to it, long after the
  -- row has stopped being visible anywhere in the application.
  perform focus.write_audit(
    p_event_type := 'task_purged',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := task.status,
    p_bucket := task.focus_bucket,
    p_detail := jsonb_build_object(
      'title', task.title,
      'work_class', task.work_class,
      'status_when_purged', task.status,
      'created_by', task.created_by,
      'primary_owner_id', task.primary_owner_id,
      'is_mandatory', task.is_mandatory,
      'deleted_at', task.deleted_at,
      'deleted_by', task.deleted_by,
      'contributor_step_count', contributor_count));

  result := jsonb_build_object('ok', true, 'code', 'task_purged', 'task_id', p_task_id);
  return focus.remember_operation(actor, p_idempotency_key, 'purge_task', result);
end;
$fn$;

comment on function public.purge_task is
  'Removes binned work from every view and keeps an audit record identifying it, its people and whether anybody else had a step on it. Never deletes the row.';
