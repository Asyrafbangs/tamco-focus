-- ============================================================================
-- TAMCO Focus v33 — transactional Goal operations
--
-- Every mutation locks the Goal, checks authority and optimistic version,
-- commits history/evidence/support/audit together, and returns a stable result.
-- ============================================================================

create or replace function focus.insert_goal_milestones(
  p_goal_version_id uuid,
  p_milestones jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
  item_count integer;
  item_index integer := 0;
  base_weight integer;
  remainder integer;
  supplied_weight_count integer;
begin
  if jsonb_typeof(coalesce(p_milestones, '[]'::jsonb)) <> 'array' then
    raise exception 'Milestones must be a JSON array.' using errcode = 'check_violation';
  end if;

  item_count := jsonb_array_length(coalesce(p_milestones, '[]'::jsonb));
  if item_count < 1 or item_count > 10 then
    raise exception 'A goal requires between one and ten milestones.'
      using errcode = 'check_violation';
  end if;

  select count(*) into supplied_weight_count
    from jsonb_to_recordset(p_milestones) as x(weight_percent integer)
   where x.weight_percent is not null;

  if supplied_weight_count not in (0, item_count) then
    raise exception 'Provide every milestone weight or leave every weight blank.'
      using errcode = 'check_violation';
  end if;

  if supplied_weight_count = item_count and (
    select coalesce(sum(x.weight_percent), 0)
      from jsonb_to_recordset(p_milestones) as x(weight_percent integer)
  ) <> 100 then
    raise exception 'Milestone weights must total 100.' using errcode = 'check_violation';
  end if;

  base_weight := floor(100.0 / item_count);
  remainder := 100 - base_weight * item_count;

  for item in
    select *
      from jsonb_to_recordset(p_milestones) as x(
        id uuid,
        source_milestone_id uuid,
        title text,
        completion_definition text,
        weight_percent integer,
        progress_percent integer
      )
  loop
    item_index := item_index + 1;
    if length(btrim(coalesce(item.title, ''))) = 0
       or length(btrim(coalesce(item.completion_definition, ''))) = 0 then
      raise exception 'Every milestone needs a result and completion definition.'
        using errcode = 'check_violation';
    end if;

    if coalesce(item.progress_percent, 0) not between 0 and 100
       or coalesce(item.progress_percent, 0) % 5 <> 0 then
      raise exception 'Milestone progress must use five-percent increments.'
        using errcode = 'check_violation';
    end if;

    insert into public.goal_milestones (
      id, goal_version_id, source_milestone_id, position, title,
      completion_definition, weight_percent, progress_percent,
      completed_by, completed_at
    ) values (
      coalesce(item.id, extensions.gen_random_uuid()),
      p_goal_version_id,
      item.source_milestone_id,
      item_index,
      btrim(item.title),
      btrim(item.completion_definition),
      coalesce(item.weight_percent, base_weight + case when item_index <= remainder then 1 else 0 end),
      coalesce(item.progress_percent, 0),
      case when coalesce(item.progress_percent, 0) = 100 then auth.uid() else null end,
      case when coalesce(item.progress_percent, 0) = 100 then now() else null end
    );
  end loop;

  return item_count;
end;
$$;

create or replace function focus.verify_goal_attachments(
  p_goal_id uuid,
  p_actor uuid,
  p_attachments jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  attachment record;
  attachment_count integer;
begin
  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Attachment metadata is malformed.' using errcode = 'check_violation';
  end if;
  attachment_count := jsonb_array_length(coalesce(p_attachments, '[]'::jsonb));

  for attachment in
    select * from jsonb_to_recordset(coalesce(p_attachments, '[]'::jsonb)) as x(
      id uuid,
      storage_path text,
      file_name text,
      mime_type text,
      byte_size bigint
    )
  loop
    if attachment.id is null
       or length(btrim(coalesce(attachment.file_name, ''))) = 0
       or attachment.byte_size is null
       or attachment.byte_size <= 0
       or attachment.storage_path not like ('goals/' || p_goal_id::text || '/%')
       or not exists (
         select 1 from storage.objects o
          where o.bucket_id = 'task-attachments'
            and o.name = attachment.storage_path
            and o.owner = p_actor
       ) then
      raise exception 'An uploaded Goal attachment could not be verified.'
        using errcode = 'check_violation';
    end if;
  end loop;
  return attachment_count;
end;
$$;

create or replace function public.create_goal(
  p_owner_id uuid,
  p_expected_result text,
  p_success_measure text,
  p_target_date date,
  p_employee_approach text default null,
  p_support_agreed text default null,
  p_dependencies text default null,
  p_baseline text default null,
  p_purpose text default null,
  p_weight_percent integer default 0,
  p_category text default 'performance',
  p_milestones jsonb default '[]'::jsonb,
  p_activate boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  owner_profile record;
  goal_id uuid;
  goal_version_id uuid;
  milestone_count integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to create a goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  if not focus.is_manager_or_admin() or actor = p_owner_id
     or (not focus.is_admin() and not focus.is_manager_of(p_owner_id)) then
    return focus.error('not_authorised', 'Only an authorised manager can set an employee goal.');
  end if;

  select * into owner_profile from public.user_profiles
   where id = p_owner_id and status = 'active';
  if not found then return focus.error('invalid_owner', 'Select an active employee.'); end if;

  if length(btrim(coalesce(p_expected_result, ''))) = 0
     or length(btrim(coalesce(p_success_measure, ''))) = 0
     or p_target_date is null
     or p_target_date < current_date
     or p_weight_percent not between 0 and 100
     or p_category not in ('performance', 'improvement', 'development') then
    return focus.error('validation_failed', 'Add a clear result, success measure and valid target date.');
  end if;

  begin
    if jsonb_array_length(coalesce(p_milestones, '[]'::jsonb)) < 1 then
      return focus.error('validation_failed', 'Define at least one milestone together.');
    end if;
  exception when others then
    return focus.error('validation_failed', 'Milestone details are malformed.');
  end;

  goal_id := extensions.gen_random_uuid();
  goal_version_id := extensions.gen_random_uuid();

  insert into public.goals (
    id, owner_id, manager_id, created_by, title, category, status, health,
    target_date, weight_percent, checkin_due_at, active_version_id,
    pending_version_id, agreed_at
  ) values (
    goal_id, p_owner_id, actor, actor, btrim(p_expected_result), p_category,
    (case when p_activate then 'active' else 'pending_discussion' end)::public.goal_status,
    'on_track', p_target_date, p_weight_percent,
    case when p_activate then now() + interval '30 days' else null end,
    null, null, case when p_activate then now() else null end
  );

  insert into public.goal_versions (
    id, goal_id, version_number, status, title, expected_result, success_measure,
    employee_approach, support_agreed, dependencies, baseline, purpose,
    target_date, weight_percent, proposed_by, activated_at
  ) values (
    goal_version_id, goal_id, 1,
    (case when p_activate then 'active' else 'pending' end)::public.goal_version_status,
    btrim(p_expected_result), btrim(p_expected_result), btrim(p_success_measure),
    nullif(btrim(coalesce(p_employee_approach, '')), ''),
    nullif(btrim(coalesce(p_support_agreed, '')), ''),
    nullif(btrim(coalesce(p_dependencies, '')), ''),
    nullif(btrim(coalesce(p_baseline, '')), ''),
    nullif(btrim(coalesce(p_purpose, '')), ''),
    p_target_date, p_weight_percent, actor,
    case when p_activate then now() else null end
  );

  milestone_count := focus.insert_goal_milestones(goal_version_id, p_milestones);

  update public.goals
     set active_version_id = case when p_activate then goal_version_id else null end,
         pending_version_id = case when p_activate then null else goal_version_id end
   where id = goal_id;

  insert into public.goal_participants (goal_id, user_id, participant_role, added_by)
  values
    (goal_id, p_owner_id, 'employee', actor),
    (goal_id, actor, 'manager', actor);

  if p_activate then
    insert into public.goal_agreements (
      goal_id, goal_version_id, employee_id, manager_id, agreed_by,
      detail
    ) values (
      goal_id, goal_version_id, p_owner_id, actor, actor,
      jsonb_build_object('mode', 'manager_employee_discussion')
    );
  else
    perform focus.notify_goal(
      p_owner_id, 'goal_version_ready', 'immediate', true,
      'Goal ready for discussion',
      'Review the expected result, approach and milestones with your manager.',
      goal_id, actor
    );
  end if;

  perform focus.write_goal_audit(
    'goal_created', actor, goal_id, p_owner_id, 1,
    jsonb_build_object(
      'activated', p_activate,
      'milestone_count', milestone_count,
      'target_date', p_target_date,
      'weight_percent', p_weight_percent
    )
  );
  if p_activate then
    perform focus.write_goal_audit(
      'goal_version_agreed', actor, goal_id, p_owner_id, 1,
      jsonb_build_object('goal_version_id', goal_version_id, 'version_number', 1)
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', case when p_activate then 'goal_activated' else 'goal_saved_for_discussion' end,
    'goal_id', goal_id,
    'goal_version_id', goal_version_id,
    'version', 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'create_goal', result);
exception
  when check_violation or unique_violation then
    return focus.error('validation_failed', sqlerrm);
end;
$$;

create or replace function public.post_goal_update(
  p_goal_id uuid,
  p_expected_version integer,
  p_progress integer,
  p_what_changed text,
  p_next_step text default null,
  p_support_requested boolean default false,
  p_support_details text default null,
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
  goal record;
  goal_update_id uuid;
  attachment_count integer;
  support_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to update a goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This goal no longer exists.'); end if;
  if not focus.can_update_goal(p_goal_id) then
    return focus.error('not_authorised', 'You are not authorised to update this goal.');
  end if;
  if goal.status <> 'active' then
    return focus.error('invalid_state', 'Only an active agreed goal can receive progress updates.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This goal changed while you were updating it. Review the latest version and try again.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;
  if p_progress not between 0 and 100 or p_progress % 5 <> 0
     or length(btrim(coalesce(p_what_changed, ''))) = 0
     or (p_support_requested and length(btrim(coalesce(p_support_details, ''))) = 0) then
    return focus.error(
      'validation_failed',
      'Choose a five-percent progress value, record what changed, and describe requested support.'
    );
  end if;

  begin
    attachment_count := focus.verify_goal_attachments(p_goal_id, actor, p_attachments);
  exception when check_violation then
    return focus.error('validation_failed', sqlerrm);
  end;

  insert into public.goal_updates (
    goal_id, goal_version_id, author_id, previous_reported_progress,
    new_reported_progress, what_changed, next_step, support_requested,
    support_details
  ) values (
    p_goal_id, goal.active_version_id, actor, goal.reported_progress,
    p_progress, btrim(p_what_changed),
    nullif(btrim(coalesce(p_next_step, '')), ''), p_support_requested,
    nullif(btrim(coalesce(p_support_details, '')), '')
  ) returning id into goal_update_id;

  insert into public.goal_attachments (
    id, goal_id, goal_update_id, storage_bucket, storage_path, file_name,
    mime_type, byte_size, uploaded_by
  )
  select x.id, p_goal_id, goal_update_id, 'task-attachments', x.storage_path,
         x.file_name, x.mime_type, x.byte_size, actor
    from jsonb_to_recordset(coalesce(p_attachments, '[]'::jsonb)) as x(
      id uuid, storage_path text, file_name text, mime_type text, byte_size bigint
    );

  if p_support_requested then
    insert into public.goal_support_requests (
      goal_id, goal_update_id, requested_by, manager_id, details
    ) values (
      p_goal_id, goal_update_id, actor, goal.manager_id, btrim(p_support_details)
    ) returning id into support_id;

    perform focus.notify_goal(
      goal.manager_id, 'goal_support_requested', 'immediate', true,
      'Goal support requested',
      goal.title || ': ' || left(btrim(p_support_details), 220),
      p_goal_id, actor
    );
  end if;

  update public.goals
     set reported_progress = p_progress,
         health = case when p_support_requested then 'support_requested' else health end,
         last_meaningful_update_at = now(),
         checkin_due_at = now() + interval '30 days',
         update_requested_at = null,
         version = version + 1
   where id = p_goal_id;

  perform focus.write_goal_audit(
    'goal_update_posted', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'goal_update_id', goal_update_id,
      'previous_progress', goal.reported_progress,
      'new_progress', p_progress,
      'attachment_count', attachment_count,
      'support_requested', p_support_requested,
      'support_request_id', support_id
    )
  );
  if p_support_requested then
    perform focus.write_goal_audit(
      'goal_support_requested', actor, p_goal_id, goal.owner_id, goal.version + 1,
      jsonb_build_object('support_request_id', support_id, 'goal_update_id', goal_update_id)
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', 'goal_update_posted',
    'goal_update_id', goal_update_id,
    'attachment_count', attachment_count,
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'post_goal_update', result);
end;
$$;

create or replace function public.post_goal_milestone_update(
  p_goal_id uuid,
  p_milestone_id uuid,
  p_expected_version integer,
  p_progress integer,
  p_comment text default null,
  p_mark_complete boolean default false,
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
  goal record;
  milestone record;
  milestone_update_id uuid;
  attachment_count integer;
  all_complete boolean;
  replayed jsonb;
  result jsonb;
  final_progress integer;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to update a milestone.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This goal no longer exists.'); end if;
  if not focus.can_update_goal(p_goal_id) then
    return focus.error('not_authorised', 'You are not authorised to update this milestone.');
  end if;
  if goal.status <> 'active' or goal.active_version_id is null then
    return focus.error('invalid_state', 'Only an active agreed goal can receive milestone updates.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This goal changed while you were updating it. Review the latest version and try again.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;

  select * into milestone from public.goal_milestones
   where id = p_milestone_id and goal_version_id = goal.active_version_id
   for update;
  if not found then
    return focus.error('validation_failed', 'That milestone is not part of the active agreement.');
  end if;

  final_progress := case when p_mark_complete then 100 else p_progress end;
  if final_progress not between 0 and 100 or final_progress % 5 <> 0 then
    return focus.error('validation_failed', 'Milestone progress must use five-percent increments.');
  end if;

  begin
    attachment_count := focus.verify_goal_attachments(p_goal_id, actor, p_attachments);
  exception when check_violation then
    return focus.error('validation_failed', sqlerrm);
  end;

  if final_progress = milestone.progress_percent
     and length(btrim(coalesce(p_comment, ''))) = 0
     and attachment_count = 0 then
    return focus.error('validation_failed', 'Change progress, add a comment, or attach evidence.');
  end if;

  update public.goal_milestones
     set progress_percent = final_progress,
         completed_by = case when final_progress = 100 then actor else null end,
         completed_at = case when final_progress = 100 then coalesce(completed_at, now()) else null end,
         last_update_at = now()
   where id = p_milestone_id;

  insert into public.goal_milestone_updates (
    goal_id, milestone_id, author_id, previous_progress, new_progress,
    comment, marked_complete
  ) values (
    p_goal_id, p_milestone_id, actor, milestone.progress_percent,
    final_progress, nullif(btrim(coalesce(p_comment, '')), ''),
    p_mark_complete or final_progress = 100
  ) returning id into milestone_update_id;

  insert into public.goal_attachments (
    id, goal_id, milestone_update_id, storage_bucket, storage_path, file_name,
    mime_type, byte_size, uploaded_by
  )
  select x.id, p_goal_id, milestone_update_id, 'task-attachments', x.storage_path,
         x.file_name, x.mime_type, x.byte_size, actor
    from jsonb_to_recordset(coalesce(p_attachments, '[]'::jsonb)) as x(
      id uuid, storage_path text, file_name text, mime_type text, byte_size bigint
    );

  select bool_and(progress_percent = 100) into all_complete
    from public.goal_milestones where goal_version_id = goal.active_version_id;

  update public.goals
     set status = case when all_complete then 'completed' else status end,
         health = case when all_complete then 'completed' else health end,
         completed_at = case when all_complete then coalesce(completed_at, now()) else completed_at end,
         last_meaningful_update_at = now(),
         checkin_due_at = case when all_complete then null else now() + interval '30 days' end,
         update_requested_at = null,
         version = version + 1
   where id = p_goal_id;

  perform focus.write_goal_audit(
    (case when final_progress = 100 then 'goal_milestone_completed'
         else 'goal_milestone_updated' end)::public.audit_event_type,
    actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'milestone_id', p_milestone_id,
      'milestone_update_id', milestone_update_id,
      'previous_progress', milestone.progress_percent,
      'new_progress', final_progress,
      'attachment_count', attachment_count,
      'goal_completed', all_complete
    )
  );

  if final_progress = 100 then
    perform focus.notify_goal(
      case when actor = goal.owner_id then goal.manager_id else goal.owner_id end,
      'goal_milestone_completed', 'digest', false,
      'Goal milestone completed', goal.title || ': ' || milestone.title,
      p_goal_id, actor
    );
  end if;
  if all_complete then
    perform focus.write_goal_audit(
      'goal_completed', actor, p_goal_id, goal.owner_id, goal.version + 1,
      jsonb_build_object('completion_source', 'all_milestones_complete')
    );
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', case when all_complete then 'goal_completed' else 'milestone_updated' end,
    'milestone_update_id', milestone_update_id,
    'attachment_count', attachment_count,
    'derived_progress', focus.goal_weighted_progress(p_goal_id),
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'post_goal_milestone_update', result);
end;
$$;

create or replace function public.propose_goal_version(
  p_goal_id uuid,
  p_expected_version integer,
  p_expected_result text,
  p_success_measure text,
  p_target_date date,
  p_employee_approach text default null,
  p_support_agreed text default null,
  p_dependencies text default null,
  p_baseline text default null,
  p_purpose text default null,
  p_weight_percent integer default 0,
  p_milestones jsonb default '[]'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal record;
  pending_id uuid := extensions.gen_random_uuid();
  next_version_number integer;
  milestone_count integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to propose changes.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This goal no longer exists.'); end if;
  if not focus.can_edit_goal_structure(p_goal_id) then
    return focus.error('not_authorised', 'You are not authorised to propose Goal changes.');
  end if;
  if goal.status not in ('active', 'pending_discussion') then
    return focus.error('invalid_state', 'This goal cannot receive structural changes in its current state.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This goal changed while you were editing it. Review the latest version and try again.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;
  if goal.pending_version_id is not null then
    return focus.error('invalid_state', 'A version is already waiting for discussion.');
  end if;
  if length(btrim(coalesce(p_expected_result, ''))) = 0
     or length(btrim(coalesce(p_success_measure, ''))) = 0
     or p_target_date is null
     or p_weight_percent not between 0 and 100 then
    return focus.error('validation_failed', 'Add a clear result, success measure and valid target.');
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version_number
    from public.goal_versions where goal_id = p_goal_id;

  begin
    -- Keep the candidate version and all of its milestones in one exception
    -- subtransaction. Invalid milestone payloads must not leave a pending
    -- version behind and block the next legitimate proposal.
    insert into public.goal_versions (
      id, goal_id, version_number, status, title, expected_result, success_measure,
      employee_approach, support_agreed, dependencies, baseline, purpose,
      target_date, weight_percent, proposed_by
    ) values (
      pending_id, p_goal_id, next_version_number, 'pending',
      btrim(p_expected_result), btrim(p_expected_result), btrim(p_success_measure),
      nullif(btrim(coalesce(p_employee_approach, '')), ''),
      nullif(btrim(coalesce(p_support_agreed, '')), ''),
      nullif(btrim(coalesce(p_dependencies, '')), ''),
      nullif(btrim(coalesce(p_baseline, '')), ''),
      nullif(btrim(coalesce(p_purpose, '')), ''),
      p_target_date, p_weight_percent, actor
    );

    milestone_count := focus.insert_goal_milestones(pending_id, p_milestones);
  exception when check_violation then
    return focus.error('validation_failed', sqlerrm);
  end;

  update public.goals
     set pending_version_id = pending_id,
         version = version + 1
   where id = p_goal_id;

  perform focus.write_goal_audit(
    'goal_version_proposed', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'pending_version_id', pending_id,
      'version_number', next_version_number,
      'milestone_count', milestone_count,
      'active_version_unchanged', goal.active_version_id
    )
  );
  perform focus.notify_goal(
    case when actor = goal.owner_id then goal.manager_id else goal.owner_id end,
    'goal_version_ready', 'immediate', true,
    'Goal changes ready for discussion',
    goal.title || ' has a proposed milestone or target revision.',
    p_goal_id, actor
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'goal_version_proposed',
    'pending_version_id', pending_id,
    'version_number', next_version_number,
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'propose_goal_version', result);
exception
  when check_violation or unique_violation then
    return focus.error('validation_failed', sqlerrm);
end;
$$;

create or replace function public.agree_goal_version(
  p_goal_id uuid,
  p_pending_version_id uuid,
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
  goal record;
  pending record;
  milestone_count integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to agree Goal changes.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This goal no longer exists.'); end if;
  if not focus.can_agree_goal(p_goal_id) then
    return focus.error('not_authorised', 'Only the authorised manager can agree Goal changes.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error(
      'version_conflict',
      'This goal changed before agreement. Review the latest version and try again.',
      jsonb_build_object('current_version', goal.version)
    );
  end if;
  if goal.pending_version_id is distinct from p_pending_version_id then
    return focus.error('invalid_state', 'That pending version is no longer awaiting agreement.');
  end if;

  select * into pending from public.goal_versions
   where id = p_pending_version_id and goal_id = p_goal_id and status = 'pending'
   for update;
  if not found then return focus.error('invalid_state', 'No pending Goal version is available.'); end if;

  select count(*) into milestone_count
    from public.goal_milestones where goal_version_id = pending.id;
  if milestone_count < 1 then
    return focus.error('validation_failed', 'Agree at least one jointly defined milestone first.');
  end if;

  if goal.active_version_id is not null then
    update public.goal_versions
       set status = 'superseded', superseded_at = now(), version = version + 1
     where id = goal.active_version_id;
  end if;
  update public.goal_versions
     set status = 'active', activated_at = now(), version = version + 1
   where id = pending.id;

  update public.goals
     set title = pending.title,
         target_date = pending.target_date,
         weight_percent = pending.weight_percent,
         active_version_id = pending.id,
         pending_version_id = null,
         manager_id = actor,
         status = 'active',
         health = case when health = 'completed' then 'on_track' else health end,
         agreed_at = now(),
         completed_at = null,
         closed_at = null,
         checkin_due_at = now() + interval '30 days',
         version = version + 1
   where id = p_goal_id;

  insert into public.goal_agreements (
    goal_id, goal_version_id, employee_id, manager_id, agreed_by, detail
  ) values (
    p_goal_id, pending.id, goal.owner_id, actor, actor,
    jsonb_build_object(
      'previous_active_version_id', goal.active_version_id,
      'mode', 'explicit_manager_employee_agreement'
    )
  );

  perform focus.write_goal_audit(
    'goal_version_agreed', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object(
      'goal_version_id', pending.id,
      'version_number', pending.version_number,
      'previous_active_version_id', goal.active_version_id,
      'milestone_count', milestone_count,
      'employee_id', goal.owner_id,
      'manager_id', actor
    )
  );
  perform focus.notify_goal(
    goal.owner_id, 'goal_version_ready', 'digest', false,
    'Goal changes agreed', pending.title || ' is now the active agreed version.',
    p_goal_id, actor
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'goal_version_agreed',
    'active_version_id', pending.id,
    'version_number', pending.version_number,
    'version', goal.version + 1
  );
  return focus.remember_operation(actor, p_idempotency_key, 'agree_goal_version', result);
end;
$$;

create or replace function public.request_goal_update(
  p_goal_id uuid,
  p_expected_version integer,
  p_message text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal record;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to request an update.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This goal no longer exists.'); end if;
  if not focus.can_agree_goal(p_goal_id) then
    return focus.error('not_authorised', 'Only the authorised manager can request a Goal update.');
  end if;
  if goal.status <> 'active' then
    return focus.error('invalid_state', 'Only an active Goal can receive an update request.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error('version_conflict', 'This goal changed. Review it and try again.');
  end if;

  update public.goals
     set update_requested_at = now(), health = 'need_attention', version = version + 1
   where id = p_goal_id;
  perform focus.notify_goal(
    goal.owner_id, 'goal_update_requested', 'immediate', true,
    'Goal update requested',
    coalesce(nullif(btrim(coalesce(p_message, '')), ''),
      'Your manager requested a progress update for ' || goal.title || '.'),
    p_goal_id, actor
  );
  perform focus.write_goal_audit(
    'goal_update_requested', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object('message', nullif(btrim(coalesce(p_message, '')), ''))
  );
  result := jsonb_build_object('ok', true, 'code', 'goal_update_requested',
    'version', goal.version + 1);
  return focus.remember_operation(actor, p_idempotency_key, 'request_goal_update', result);
end;
$$;

create or replace function public.resolve_goal_support(
  p_support_request_id uuid,
  p_resolution_note text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  support record;
  goal record;
  other_open integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to resolve support.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into support from public.goal_support_requests
   where id = p_support_request_id for update;
  if not found then return focus.error('not_found', 'This support request no longer exists.'); end if;
  select * into goal from public.goals where id = support.goal_id for update;
  if not focus.can_agree_goal(goal.id) then
    return focus.error('not_authorised', 'Only the authorised manager can resolve Goal support.');
  end if;
  if support.status = 'resolved' then
    return focus.error('invalid_state', 'This support request is already resolved.');
  end if;
  if length(btrim(coalesce(p_resolution_note, ''))) = 0 then
    return focus.error('validation_failed', 'Record how the requested support was resolved.');
  end if;

  update public.goal_support_requests
     set status = 'resolved',
         acknowledged_by = coalesce(acknowledged_by, actor),
         acknowledged_at = coalesce(acknowledged_at, now()),
         resolved_by = actor,
         resolved_at = now(),
         resolution_note = btrim(p_resolution_note)
   where id = support.id;
  select count(*) into other_open from public.goal_support_requests
   where goal_id = goal.id and id <> support.id and status <> 'resolved';
  update public.goals
     set health = case when other_open = 0 then 'on_track' else health end,
         version = version + 1
   where id = goal.id;
  perform focus.write_goal_audit(
    'goal_support_resolved', actor, goal.id, goal.owner_id, goal.version + 1,
    jsonb_build_object('support_request_id', support.id, 'resolution_note', btrim(p_resolution_note))
  );
  perform focus.notify_goal(
    support.requested_by, 'goal_support_requested', 'digest', false,
    'Goal support resolved', goal.title || ': ' || left(btrim(p_resolution_note), 220),
    goal.id, actor
  );
  result := jsonb_build_object('ok', true, 'code', 'goal_support_resolved',
    'version', goal.version + 1);
  return focus.remember_operation(actor, p_idempotency_key, 'resolve_goal_support', result);
end;
$$;

create or replace function public.link_goal_work(
  p_goal_id uuid,
  p_task_id uuid,
  p_milestone_id uuid default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal record;
  link_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to link work.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This goal no longer exists.'); end if;
  if not focus.can_edit_goal_structure(p_goal_id) or not focus.can_view_task(p_task_id) then
    return focus.error('not_authorised', 'You are not authorised to link this work.');
  end if;
  if p_expected_version is not null and goal.version <> p_expected_version then
    return focus.error('version_conflict', 'This goal changed. Review it and try again.');
  end if;
  if p_milestone_id is not null and not exists (
    select 1 from public.goal_milestones
     where id = p_milestone_id and goal_version_id = goal.active_version_id
  ) then
    return focus.error('validation_failed', 'That milestone is not part of the active agreement.');
  end if;

  -- The Goal row lock serialises link changes for this Goal. Resolve an
  -- existing link with NULL-safe equality before inserting so an idempotent
  -- repeat does not create another audit event or increment the version.
  select id into link_id
    from public.goal_work_links
   where goal_id = p_goal_id
     and task_id = p_task_id
     and milestone_id is not distinct from p_milestone_id;
  if link_id is not null then
    result := jsonb_build_object(
      'ok', true,
      'code', 'goal_work_already_linked',
      'link_id', link_id,
      'version', goal.version
    );
    return focus.remember_operation(actor, p_idempotency_key, 'link_goal_work', result);
  end if;

  insert into public.goal_work_links (goal_id, milestone_id, task_id, linked_by)
  values (p_goal_id, p_milestone_id, p_task_id, actor)
  returning id into link_id;
  update public.goals set version = version + 1 where id = p_goal_id;
  perform focus.write_goal_audit(
    'goal_work_linked', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object('link_id', link_id, 'task_id', p_task_id,
      'milestone_id', p_milestone_id, 'progress_changed', false)
  );
  result := jsonb_build_object('ok', true, 'code', 'goal_work_linked',
    'link_id', link_id, 'version', goal.version + 1);
  return focus.remember_operation(actor, p_idempotency_key, 'link_goal_work', result);
end;
$$;

create or replace function public.record_goal_attachment_view(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  attachment record;
  goal record;
begin
  select * into attachment from public.goal_attachments where id = p_attachment_id;
  if not found or actor is null or not focus.can_view_goal(attachment.goal_id) then
    return focus.error('not_authorised', 'This attachment is not available.');
  end if;
  select * into goal from public.goals where id = attachment.goal_id;
  insert into public.goal_attachment_views (attachment_id, viewer_id)
  values (p_attachment_id, actor);
  perform focus.write_goal_audit(
    'attachment_opened', actor, goal.id, goal.owner_id, goal.version,
    jsonb_build_object('goal_attachment_id', p_attachment_id)
  );
  return jsonb_build_object('ok', true, 'code', 'attachment_view_recorded');
end;
$$;

create or replace function public.close_goal(
  p_goal_id uuid,
  p_expected_version integer,
  p_reason text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  goal record;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to close a goal.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;
  select * into goal from public.goals where id = p_goal_id for update;
  if not found then return focus.error('not_found', 'This goal no longer exists.'); end if;
  if not focus.can_agree_goal(p_goal_id) then
    return focus.error('not_authorised', 'Only the authorised manager can close this goal.');
  end if;
  if goal.status not in ('active', 'completed') then
    return focus.error('invalid_state', 'This goal cannot be closed in its current state.');
  end if;
  if goal.version <> p_expected_version then
    return focus.error('version_conflict', 'This goal changed. Review it and try again.');
  end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return focus.error('validation_failed', 'Record why this goal is being closed.');
  end if;
  update public.goals
     set status = 'closed', health = 'completed',
         completed_at = coalesce(completed_at, now()), closed_at = now(),
         checkin_due_at = null, update_requested_at = null, version = version + 1
   where id = p_goal_id;
  perform focus.write_goal_audit(
    'goal_closed', actor, p_goal_id, goal.owner_id, goal.version + 1,
    jsonb_build_object('reason', btrim(p_reason))
  );
  result := jsonb_build_object('ok', true, 'code', 'goal_closed',
    'version', goal.version + 1);
  return focus.remember_operation(actor, p_idempotency_key, 'close_goal', result);
end;
$$;

revoke all on function public.create_goal(uuid,text,text,date,text,text,text,text,text,integer,text,jsonb,boolean,text) from public;
revoke all on function public.post_goal_update(uuid,integer,integer,text,text,boolean,text,jsonb,text) from public;
revoke all on function public.post_goal_milestone_update(uuid,uuid,integer,integer,text,boolean,jsonb,text) from public;
revoke all on function public.propose_goal_version(uuid,integer,text,text,date,text,text,text,text,text,integer,jsonb,text) from public;
revoke all on function public.agree_goal_version(uuid,uuid,integer,text) from public;
revoke all on function public.request_goal_update(uuid,integer,text,text) from public;
revoke all on function public.resolve_goal_support(uuid,text,text) from public;
revoke all on function public.link_goal_work(uuid,uuid,uuid,integer,text) from public;
revoke all on function public.record_goal_attachment_view(uuid) from public;
revoke all on function public.close_goal(uuid,integer,text,text) from public;

grant execute on function public.create_goal(uuid,text,text,date,text,text,text,text,text,integer,text,jsonb,boolean,text) to authenticated;
grant execute on function public.post_goal_update(uuid,integer,integer,text,text,boolean,text,jsonb,text) to authenticated;
grant execute on function public.post_goal_milestone_update(uuid,uuid,integer,integer,text,boolean,jsonb,text) to authenticated;
grant execute on function public.propose_goal_version(uuid,integer,text,text,date,text,text,text,text,text,integer,jsonb,text) to authenticated;
grant execute on function public.agree_goal_version(uuid,uuid,integer,text) to authenticated;
grant execute on function public.request_goal_update(uuid,integer,text,text) to authenticated;
grant execute on function public.resolve_goal_support(uuid,text,text) to authenticated;
grant execute on function public.link_goal_work(uuid,uuid,uuid,integer,text) to authenticated;
grant execute on function public.record_goal_attachment_view(uuid) to authenticated;
grant execute on function public.close_goal(uuid,integer,text,text) to authenticated;
