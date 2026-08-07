-- PostgreSQL resolves the conditional milestone audit name as text. Recreate
-- the operation with the event explicitly typed so the whole transaction can
-- commit atomically on existing v33 databases.

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
