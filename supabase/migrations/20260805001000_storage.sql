-- ============================================================================
-- TAMCO Focus — private attachment storage
--
-- Implements MASTER_PRODUCT_SPEC.md section 28.1 and the attachment
-- requirements of ONE_SHOT_LOCAL_BUILD_PROMPT.md.
--
-- The bucket is PRIVATE. No object is ever reachable by URL guessing; the
-- application exchanges an authorised `attachments` row for a short-lived
-- signed URL, and the policies below independently re-derive the same
-- authorisation from the object's own path.
--
-- Path convention, which the policies depend on:
--   tasks/<task_id>/<attachment_id>-<sanitised file name>
--   captures/<capture_id>/<uuid>-<sanitised file name>
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments',
  'task-attachments',
  false,
  10485760,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A malformed path must fail closed, not raise. An unparseable segment yields
-- NULL, and every policy below then evaluates to false.
create or replace function focus.try_uuid(candidate text)
returns uuid
language plpgsql
immutable
as $$
begin
  return candidate::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

-- Resolves the task an object belongs to, whether it was uploaded directly
-- against a task or staged during Capture Work.
create or replace function focus.storage_object_task_id(object_name text)
returns uuid
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select case (storage.foldername(object_name))[1]
    when 'tasks' then focus.try_uuid((storage.foldername(object_name))[2])
    when 'captures' then (
      select c.created_task_id
        from public.work_captures c
       where c.id = focus.try_uuid((storage.foldername(object_name))[2])
    )
    else null
  end;
$$;

-- True when the caller owns the Capture Work draft the object is staged under.
create or replace function focus.owns_capture_object(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select
    (storage.foldername(object_name))[1] = 'captures'
    and exists (
      select 1
        from public.work_captures c
       where c.id = focus.try_uuid((storage.foldername(object_name))[2])
         and c.captured_by = auth.uid()
    );
$$;

-- ---------------------------------------------------------------------------
-- Object policies.
--
-- These mirror the `attachments` table policies exactly: view follows
-- `can_view_task`, upload follows `can_contribute_to_task`. Evidence is never
-- rewritten or deleted, so there is no UPDATE or DELETE policy — the same
-- retention stance the application tables take.
-- ---------------------------------------------------------------------------

create policy "task attachments are readable by authorised viewers"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and (
         focus.owns_capture_object(name)
      or focus.can_view_task(focus.storage_object_task_id(name))
    )
  );

create policy "task attachments are writable by authorised contributors"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and owner = auth.uid()
    and (
         focus.owns_capture_object(name)
      or focus.can_contribute_to_task(focus.storage_object_task_id(name))
    )
  );

-- A Capture Work draft that is discarded before confirmation leaves staged
-- files with no task. Only the person who staged them may clear them up.
create policy "capture staging files are removable by their owner"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and focus.owns_capture_object(name)
  );
