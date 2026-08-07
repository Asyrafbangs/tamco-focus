-- ============================================================================
-- TAMCO Focus — task-detail update and attachment transaction
--
-- Completes the write path required by MASTER_PRODUCT_SPEC.md sections 10.4,
-- 11, 12, 13, 14, and 20. Attachments are uploaded into the private bucket
-- first, then this procedure commits the update, metadata, mentions, task age,
-- and audit events atomically. A narrowly scoped Storage DELETE policy permits
-- the caller to clean up only an upload that never gained an attachment row.
-- ============================================================================

create policy "uncommitted task uploads are removable by their uploader"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and owner = auth.uid()
    and (storage.foldername(name))[1] = 'tasks'
    and focus.can_contribute_to_task(focus.storage_object_task_id(name))
    and not exists (
      select 1
        from public.attachments a
       where a.storage_bucket = bucket_id
         and a.storage_path = name
    )
  );

-- The interface reads these flags but never derives them. A visibility grant
-- may allow reading a task while deliberately allowing no contribution.
create or replace function public.get_task_capabilities(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or not focus.can_view_task(p_task_id) then
      jsonb_build_object(
        'can_view', false,
        'can_contribute', false,
        'can_edit', false,
        'can_review', false
      )
    else jsonb_build_object(
      'can_view', true,
      'can_contribute', focus.can_contribute_to_task(p_task_id),
      'can_edit', focus.can_edit_task(p_task_id),
      'can_review', focus.can_review_task(p_task_id)
    )
  end;
$$;

create or replace function public.post_task_update(
  p_task_id uuid,
  p_body text default null,
  p_is_evidence_only boolean default false,
  p_checklist_item_id uuid default null,
  p_mention_ids uuid[] default '{}'::uuid[],
  p_attachments jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  actor uuid := auth.uid();
  task record;
  checklist_item record;
  attachment record;
  update_id uuid;
  attachment_count integer := 0;
  update_event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to post an update.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_contribute_to_task(p_task_id) then
    return focus.error('not_authorised', 'You are not authorised to update this work.');
  end if;

  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed or cancelled work cannot receive new updates.');
  end if;

  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    return focus.error('validation_failed', 'Attachment metadata is malformed.');
  end if;

  attachment_count := jsonb_array_length(coalesce(p_attachments, '[]'::jsonb));
  if length(btrim(coalesce(p_body, ''))) = 0 and attachment_count = 0 then
    return focus.error('validation_failed', 'Write an update or attach at least one file.');
  end if;

  if p_is_evidence_only and attachment_count = 0 then
    return focus.error('validation_failed', 'An evidence-only update must include a file.');
  end if;

  if p_checklist_item_id is not null then
    select * into checklist_item
      from public.task_checklist_items
     where id = p_checklist_item_id and task_id = p_task_id;
    if not found then
      return focus.error('validation_failed', 'That checklist step does not belong to this task.');
    end if;
  end if;

  -- Every metadata row must name an object that this same actor just uploaded
  -- to this task's exact private path. This prevents metadata from being used
  -- to claim somebody else's object or another task's object.
  for attachment in
    select *
      from jsonb_to_recordset(coalesce(p_attachments, '[]'::jsonb)) as x(
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
       or attachment.storage_path not like ('tasks/' || p_task_id::text || '/%')
       or not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'task-attachments'
            and o.name = attachment.storage_path
            and o.owner = actor
       ) then
      return focus.error('validation_failed', 'An uploaded attachment could not be verified.');
    end if;
  end loop;

  insert into public.task_updates (task_id, author_id, body, is_evidence_only)
  values (
    p_task_id,
    actor,
    nullif(btrim(coalesce(p_body, '')), ''),
    p_is_evidence_only
  )
  returning id into update_id;

  insert into public.attachments (
    id,
    task_id,
    checklist_item_id,
    update_id,
    storage_bucket,
    storage_path,
    file_name,
    mime_type,
    byte_size,
    is_evidence,
    virus_scan_state,
    uploaded_by
  )
  select
    x.id,
    p_task_id,
    p_checklist_item_id,
    update_id,
    'task-attachments',
    x.storage_path,
    x.file_name,
    x.mime_type,
    x.byte_size,
    coalesce(x.is_evidence, false) or p_is_evidence_only or p_checklist_item_id is not null,
    'not_scanned',
    actor
  from jsonb_to_recordset(coalesce(p_attachments, '[]'::jsonb)) as x(
    id uuid,
    storage_path text,
    file_name text,
    mime_type text,
    byte_size bigint,
    is_evidence boolean
  );

  -- Mentions are restricted to people participating in this task. The actor is
  -- excluded, duplicates are absorbed, and inactive accounts are ignored.
  insert into public.task_update_mentions (update_id, user_id)
  select update_id, mentioned.id
    from public.user_profiles mentioned
   where mentioned.id = any(coalesce(p_mention_ids, '{}'::uuid[]))
     and mentioned.id <> actor
     and mentioned.status = 'active'
     and (
       mentioned.id = task.primary_owner_id
       or exists (
         select 1 from public.task_collaborators c
          where c.task_id = p_task_id and c.user_id = mentioned.id
       )
       or exists (
         select 1 from public.task_checklist_items ci
          where ci.task_id = p_task_id and ci.assigned_to = mentioned.id
       )
     )
  on conflict do nothing;

  update public.tasks
     set last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  update_event_id := focus.write_audit(
    p_event_type := 'update_posted',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'update_id', update_id,
      'evidence_only', p_is_evidence_only,
      'checklist_item_id', p_checklist_item_id,
      'attachment_count', attachment_count,
      'mention_count', coalesce(array_length(p_mention_ids, 1), 0)
    )
  );

  if attachment_count > 0 then
    perform focus.write_audit(
      p_event_type := 'attachment_added',
      p_actor_id := actor,
      p_task_id := p_task_id,
      p_task_version := task.version + 1,
      p_detail := jsonb_build_object(
        'update_id', update_id,
        'checklist_item_id', p_checklist_item_id,
        'attachment_count', attachment_count
      )
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', 'update_posted',
    'update_id', update_id,
    'attachment_count', attachment_count,
    'audit_event_id', update_event_id
  );
  return focus.remember_operation(actor, p_idempotency_key, 'post_task_update', result);
end;
$$;

revoke all on function public.get_task_capabilities(uuid) from public;
revoke all on function public.post_task_update(uuid, text, boolean, uuid, uuid[], jsonb, text)
  from public;
grant execute on function public.get_task_capabilities(uuid) to authenticated;
grant execute on function public.post_task_update(uuid, text, boolean, uuid, uuid[], jsonb, text)
  to authenticated;
