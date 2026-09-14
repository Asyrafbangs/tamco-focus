-- ---------------------------------------------------------------------------
-- v180 — Work assigned from New Work keeps what was chosen for it
--
-- A manager filling in New Work and choosing somebody else as Primary owner
-- was sent down a different road from everybody else. The form saved a draft —
-- title, completion evidence rule, instruction, the reason for a project, the
-- files — then called assign_work_to_people with the title, dates and purpose
-- only, and threw the draft away. Throwing it away deleted the uploaded files
-- from storage. So "Completion evidence: File required" arrived as optional,
-- the attached photograph was gone, and nothing on screen said either had
-- happened. It was reported as a choice on the form that did nothing.
--
-- assign_work_to_people gains p_capture_id. Given the draft the form saved, it
-- takes the evidence rule, its instruction and the description from that draft,
-- moves the draft's files onto the task — the same rows confirm_work_capture
-- moves, pointing at the same stored objects — and resolves the draft as
-- confirmed, so the client no longer discards it. A draft carries one set of
-- files, so it can be given to one person, not several.
--
-- A new parameter changes the signature, so the function is dropped and
-- recreated and its grant reissued. Callers that do not pass it are unchanged.
-- ---------------------------------------------------------------------------

drop function if exists public.assign_work_to_people(
  text, text, public.work_class, uuid[], public.urgency_level,
  timestamptz, boolean, timestamptz, text, public.work_purpose);

create or replace function public.assign_work_to_people(
  p_title text,
  p_description text,
  p_work_class public.work_class,
  p_owner_ids uuid[],
  p_urgency public.urgency_level default 'normal',
  p_due_at timestamptz default null,
  p_due_is_date_only boolean default true,
  p_review_at timestamptz default null,
  p_idempotency_key text default null,
  p_work_purpose public.work_purpose default null,
  p_capture_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
      new_task_id, null, actor);
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
$$;

comment on function public.assign_work_to_people is
  'Manager assignment. Given the New Work draft (p_capture_id), carries its evidence rule, '
  'instruction, description and files onto the task and resolves the draft.';

revoke all on function public.assign_work_to_people(
  text, text, public.work_class, uuid[], public.urgency_level,
  timestamptz, boolean, timestamptz, text, public.work_purpose, uuid) from public, anon;

grant execute on function public.assign_work_to_people(
  text, text, public.work_class, uuid[], public.urgency_level,
  timestamptz, boolean, timestamptz, text, public.work_purpose, uuid) to authenticated;
