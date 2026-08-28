-- ---------------------------------------------------------------------------
-- v82 - a checklist step belongs to the person it was given to.
--
-- 1. WHO MAY TICK IT.
--
--    Authorisation was `focus.can_contribute_to_task(...) or assigned_to =
--    actor`, and the first half of that is task-wide: holding any step on a
--    task, or being a collaborator on it, authorised completing every other
--    step on it too. Three people each given "Give input on project and
--    improvement" could tick each other's, and the record would then say a
--    person had done work they never did.
--
--    Contribute authority is right for the things it was written for -- posting
--    an update, raising a barrier, attaching a file -- which are about the task
--    as a whole. Completing a step is not one of those. It is a claim about one
--    named person's work, so only that person may make it, or the owner who
--    assigned it (their manager included, since managers can already edit the
--    work). Restructuring the step was already owner-only at v45; this brings
--    ticking it into line.
--
--    Reopening moves the same way. Undoing somebody's completion is a stronger
--    act than making one, not a weaker one.
--
-- 2. WHY IT SAYS WAITING.
--
--    Two unrelated rules park a step in Waiting: a prerequisite that is not
--    finished (section 13.3), and a parent task the owner has not activated
--    yet (section 10, added at v41). Both procedures reported the first one
--    regardless -- "An earlier step must be completed first" -- so a
--    contributor waiting on their owner was sent looking for a prerequisite
--    that does not exist, on a screen with no button and no explanation.
--
--    Nothing about when a step becomes ready changes here. The rule in section
--    10 is deliberate: a contributor must not start work the owner has not
--    committed to. It is the silence that was the defect.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Who may complete or reopen one step.
-- ---------------------------------------------------------------------------

create or replace function focus.can_complete_checklist_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.task_checklist_items ci
     where ci.id = p_item_id
       and (
            -- The person it was given to.
            ci.assigned_to = auth.uid()
            -- Or whoever may edit the work: the owner who assigned it, and
            -- their manager. An unassigned step has only this second route.
         or focus.can_edit_task(ci.task_id)
       )
  );
$$;

comment on function focus.can_complete_checklist_item is
  'True for the step assignee and for anybody who can edit the parent task. Deliberately narrower than can_contribute_to_task, which is task-wide.';

grant execute on function focus.can_complete_checklist_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The two sentences the procedures need, kept next to the rule they describe.
-- ---------------------------------------------------------------------------

create or replace function focus.checklist_completion_refusal(p_item_id uuid, p_verb text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when ci.assigned_to is null then
      format('This step is not assigned to anybody, so only %s, who owns this work, can %s it.',
             coalesce(op.full_name, 'its owner'), p_verb)
    else
      format('This step belongs to %s. Only they, or the owner of this work, can %s it.',
             coalesce(ap.full_name, 'somebody else'), p_verb)
  end
  from public.task_checklist_items ci
  join public.tasks t on t.id = ci.task_id
  left join public.user_profiles op on op.id = t.primary_owner_id
  left join public.user_profiles ap on ap.id = ci.assigned_to
  where ci.id = p_item_id;
$$;

grant execute on function focus.checklist_completion_refusal(uuid, text) to authenticated;

create or replace function focus.checklist_waiting_reason(p_item_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- The branches are in the same order as focus.recalculate_checklist_readiness,
  -- so the sentence names the rule that actually put the step here.
  select case
    when t.status <> 'active'
         and ci.assigned_to is not null
         and ci.assigned_to <> t.primary_owner_id then
      format('%s has not started this work yet. Your step opens when they activate it.',
             coalesce(op.full_name, 'The owner'))
    when ci.depends_on_item_id is not null then
      'An earlier step must be completed before this one becomes ready.'
    else
      'This step is not ready to be completed yet.'
  end
  from public.task_checklist_items ci
  join public.tasks t on t.id = ci.task_id
  left join public.user_profiles op on op.id = t.primary_owner_id
  where ci.id = p_item_id;
$$;

grant execute on function focus.checklist_waiting_reason(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The three procedures, unchanged apart from the authorisation test and the
-- Waiting sentence.
-- ---------------------------------------------------------------------------

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

  if not focus.can_complete_checklist_item(item.id) then
    return focus.error('not_authorised', focus.checklist_completion_refusal(item.id, 'reopen'));
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
