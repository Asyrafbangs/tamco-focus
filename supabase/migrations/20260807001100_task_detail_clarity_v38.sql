-- ============================================================================
-- TAMCO Focus v38 — quieter task detail with trustworthy commitments
--
-- Adds two authoritative operations:
--   * versioned due-date changes with immutable before/after history
--   * evidence upload metadata + required checklist completion in one transaction
-- It also enforces checklist-derived task progress for existing and future rows.
-- ============================================================================

create or replace function focus.sync_task_checklist_progress()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected_task_id uuid;
  total_items integer;
  done_items integer;
begin
  affected_task_id := case when tg_op = 'DELETE' then old.task_id else new.task_id end;
  select count(*), count(*) filter (where state = 'completed')
    into total_items, done_items
    from public.task_checklist_items
   where task_id = affected_task_id;

  if total_items > 0 then
    update public.tasks
       set progress_percent = (done_items * 100) / total_items
     where id = affected_task_id
       and progress_percent is distinct from (done_items * 100) / total_items;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists task_checklist_items_sync_progress on public.task_checklist_items;
create trigger task_checklist_items_sync_progress
  after insert or delete or update of state on public.task_checklist_items
  for each row execute function focus.sync_task_checklist_progress();

revoke all on function focus.sync_task_checklist_progress()
  from public, anon, authenticated;

-- Bring pre-existing data into agreement before the new interface exposes the
-- checklist as the explicit progress source.
with derived as (
  select task_id,
         (count(*) filter (where state = 'completed') * 100) / count(*) as progress_percent
    from public.task_checklist_items
   group by task_id
)
update public.tasks t
   set progress_percent = derived.progress_percent
  from derived
 where t.id = derived.task_id
   and t.progress_percent is distinct from derived.progress_percent;

create or replace function public.change_task_due_date(
  p_task_id uuid,
  p_expected_version integer,
  p_new_due_at timestamptz,
  p_due_is_date_only boolean,
  p_reason text default null,
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
  replayed jsonb;
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  event_id uuid;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change the due date.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select id, due_at, due_is_date_only, status, version
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
$$;

create or replace function public.complete_checklist_item_with_evidence(
  p_item_id uuid,
  p_attachments jsonb,
  p_completion_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
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
  if not (focus.can_contribute_to_task(item.task_id) or item.assigned_to = actor) then
    return focus.error('not_authorised', 'You are not authorised to complete this step.');
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed or cancelled work cannot receive checklist evidence.');
  end if;
  if item.state = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_completed');
  end if;
  if item.state = 'waiting' then
    return focus.error('waiting_on_prerequisite', 'An earlier step must be completed first.');
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
    item.task_id, null, actor)
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
$$;

revoke all on function public.change_task_due_date(
  uuid, integer, timestamptz, boolean, text, text
) from public, anon, authenticated;
revoke all on function public.complete_checklist_item_with_evidence(
  uuid, jsonb, text, text
) from public, anon, authenticated;

grant execute on function public.change_task_due_date(
  uuid, integer, timestamptz, boolean, text, text
) to authenticated;
grant execute on function public.complete_checklist_item_with_evidence(
  uuid, jsonb, text, text
) to authenticated;

comment on function public.change_task_due_date(uuid, integer, timestamptz, boolean, text, text)
  is 'Changes a non-terminal task due date with optimistic locking and immutable previous/new audit detail.';
comment on function public.complete_checklist_item_with_evidence(uuid, jsonb, text, text)
  is 'Atomically records required evidence, completes one checklist item, derives task progress, and writes aligned audit events.';
