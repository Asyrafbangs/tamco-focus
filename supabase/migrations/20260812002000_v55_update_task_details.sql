-- ---------------------------------------------------------------------------
-- v55 — editing a task's own content.
--
-- Task Detail could change a due date, a checklist and attachments, but not
-- the title or the description. Correcting a typo meant cancelling the work
-- and capturing it again, which loses the history the cancellation was
-- supposed to preserve.
--
-- What this deliberately does NOT touch:
--
--   primary_owner_id   Reassignment is `reassign_task`, and it stays separate.
--                      A form that silently moved accountability while
--                      somebody believed they were fixing a title would be a
--                      governance hole, not a convenience (section J).
--   status             Lifecycle transitions have their own procedures, each
--                      with their own rules about what may follow what.
--   focus_bucket       Classification is decided at capture and changed by the
--                      review path, not by editing prose.
--   due_at             `change_task_due_date` already owns this and writes its
--                      own audit event, so folding it in here would produce two
--                      procedures that can both move a deadline and one audit
--                      trail that cannot say which did.
--
-- Authority is `focus.can_edit_task`: the primary owner, or a manager in their
-- reporting line. That is the same predicate the checklist and evidence paths
-- already use, so editing a title needs exactly the authority editing the work
-- already needed.
-- ---------------------------------------------------------------------------

create or replace function public.update_task_details(
  p_task_id uuid,
  p_expected_version integer,
  p_title text,
  p_description text default null,
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
  clean_title text;
  clean_description text;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to edit work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'Only the owner or their manager can edit this work.');
  end if;

  -- Completed and cancelled work is a record of what happened. Editing the
  -- title afterwards would rewrite that record, and the audit trail would show
  -- a result that never carried the name it now has.
  if task.status in ('completed', 'cancelled') then
    return focus.error(
      'invalid_state',
      'Completed and cancelled work cannot be edited. Its record is closed.'
    );
  end if;

  clean_title := btrim(coalesce(p_title, ''));
  if length(clean_title) = 0 then
    return focus.error('validation_failed', 'Give the work a title.');
  end if;
  if length(clean_title) > 200 then
    return focus.error('validation_failed', 'Keep the title to 200 characters or fewer.');
  end if;

  clean_description := nullif(btrim(coalesce(p_description, '')), '');
  if length(coalesce(clean_description, '')) > 4000 then
    return focus.error('validation_failed', 'Keep the details to 4000 characters or fewer.');
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This task changed while you were editing it. Review the latest information.',
      jsonb_build_object('current_version', task.version)
    );
  end if;

  -- An edit that changes nothing should not bump the version or add a line to
  -- the audit trail; a history of no-ops is a history nobody reads.
  if task.title = clean_title and task.description is not distinct from clean_description then
    return jsonb_build_object(
      'ok', true,
      'code', 'unchanged',
      'task', focus.task_snapshot(p_task_id)
    );
  end if;

  update public.tasks
  set title = clean_title,
      description = clean_description,
      last_meaningful_update_at = now(),
      version = version + 1
  where id = p_task_id;

  event_id := focus.write_audit(
    p_event_type := 'task_details_edited',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := task.status,
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1,
    -- The previous title is recorded because "why is this called that?" is a
    -- question the trail should answer without a diff of the whole row.
    p_detail := jsonb_build_object(
      'previous_title', task.title,
      'new_title', clean_title,
      'description_changed', task.description is distinct from clean_description
    )
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'task_updated',
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id
  );
  return focus.remember_operation(actor, p_idempotency_key, 'update_task_details', result);
end;
$$;

revoke all on function public.update_task_details(uuid, integer, text, text, text) from public, anon;
grant execute on function public.update_task_details(uuid, integer, text, text, text) to authenticated;
