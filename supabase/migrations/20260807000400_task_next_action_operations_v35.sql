-- v35: one authoritative Next-action command shared by direct Overview edits
-- and progress updates. The existing post_task_update name and named arguments
-- remain compatible; p_next_action is an optional additive argument.

create or replace function focus.apply_task_next_action(
  p_task_id uuid,
  p_actor uuid,
  p_next_action text,
  p_mark_done boolean,
  p_source text,
  p_increment_version boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  task record;
  previous_action text;
  new_action text;
  final_version integer;
  event_type public.audit_event_type;
  event_id uuid;
begin
  if p_actor is null or p_actor is distinct from auth.uid() then
    return focus.error('not_authorised', 'Sign in with an active account to change the Next action.');
  end if;

  select id, next_action, status, version
    into task
    from public.tasks
   where id = p_task_id
   for update;

  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;
  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'Only an authorised task editor can change the Next action.');
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed or cancelled work cannot receive a new Next action.');
  end if;

  previous_action := nullif(btrim(coalesce(task.next_action, '')), '');

  if p_mark_done then
    if previous_action is null then
      return focus.error('invalid_state', 'There is no current Next action to mark done.');
    end if;
    new_action := null;
    event_type := 'next_action_completed';
  else
    new_action := nullif(btrim(coalesce(p_next_action, '')), '');
    if new_action is null or length(new_action) > 180 then
      return focus.error('validation_failed', 'Write one clear Next action of 180 characters or fewer.');
    end if;
    if lower(regexp_replace(new_action, '[[:punct:][:space:]]+$', '', 'g')) in (
      'continue next action',
      'continue the next action'
    ) then
      return focus.error('validation_failed', 'Replace the generic placeholder with one practical action.');
    end if;
    if previous_action is not distinct from new_action then
      return jsonb_build_object(
        'ok', true,
        'code', 'next_action_unchanged',
        'next_action', new_action,
        'version', task.version,
        'changed', false
      );
    end if;
    event_type := 'next_action_changed';
  end if;

  final_version := task.version + case when p_increment_version then 1 else 0 end;

  update public.tasks
     set next_action = new_action,
         last_meaningful_update_at = now(),
         version = final_version
   where id = p_task_id;

  event_id := focus.write_audit(
    p_event_type := event_type,
    p_actor_id := p_actor,
    p_task_id := p_task_id,
    p_task_version := final_version,
    p_detail := jsonb_build_object(
      'source', p_source,
      'previous_next_action', previous_action,
      'next_action', new_action,
      'completed_action', case when p_mark_done then previous_action else null end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'code', case when p_mark_done then 'next_action_completed' else 'next_action_changed' end,
    'next_action', new_action,
    'completed_action', case when p_mark_done then previous_action else null end,
    'version', final_version,
    'audit_event_id', event_id,
    'changed', true
  );
end;
$$;

revoke all on function focus.apply_task_next_action(uuid, uuid, text, boolean, text, boolean)
  from public, anon, authenticated;

create or replace function public.set_task_next_action(
  p_task_id uuid,
  p_expected_version integer,
  p_next_action text default null,
  p_mark_done boolean default false,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  replayed jsonb;
  current_version integer;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change the Next action.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select version into current_version
    from public.tasks
   where id = p_task_id
   for update;
  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;
  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'Only an authorised task editor can change the Next action.');
  end if;
  if current_version <> p_expected_version then
    return focus.error('version_conflict', 'This work changed while it was open. Refresh and try again.');
  end if;

  result := focus.apply_task_next_action(
    p_task_id,
    actor,
    p_next_action,
    p_mark_done,
    case when p_mark_done then 'checklist' else 'overview' end,
    true
  );
  if not coalesce((result ->> 'ok')::boolean, false) then
    return result;
  end if;
  return focus.remember_operation(actor, p_idempotency_key, 'set_task_next_action', result);
end;
$$;

alter function public.post_task_update(uuid, text, boolean, uuid, uuid[], jsonb, text)
  rename to post_task_update_v34_internal;

create or replace function public.post_task_update(
  p_task_id uuid,
  p_body text default null,
  p_is_evidence_only boolean default false,
  p_checklist_item_id uuid default null,
  p_mention_ids uuid[] default '{}'::uuid[],
  p_attachments jsonb default '[]'::jsonb,
  p_idempotency_key text default null,
  p_next_action text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  actor uuid := auth.uid();
  replayed jsonb;
  clean_next_action text := nullif(btrim(coalesce(p_next_action, '')), '');
  combined_result jsonb;
  next_action_result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to post an update.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  if clean_next_action is not null then
    if length(clean_next_action) > 180 then
      return focus.error('validation_failed', 'Keep What happens next to 180 characters or fewer.');
    end if;
    if lower(regexp_replace(clean_next_action, '[[:punct:][:space:]]+$', '', 'g')) in (
      'continue next action',
      'continue the next action'
    ) then
      return focus.error('validation_failed', 'Replace the generic placeholder with one practical action.');
    end if;
    if not focus.can_edit_task(p_task_id) then
      return focus.error('not_authorised', 'Only an authorised task editor can change the Next action.');
    end if;
  end if;

  combined_result := public.post_task_update_v34_internal(
    p_task_id,
    p_body,
    p_is_evidence_only,
    p_checklist_item_id,
    p_mention_ids,
    p_attachments,
    p_idempotency_key
  );
  if not coalesce((combined_result ->> 'ok')::boolean, false) then
    return combined_result;
  end if;

  if clean_next_action is not null then
    next_action_result := focus.apply_task_next_action(
      p_task_id,
      actor,
      clean_next_action,
      false,
      'progress_update',
      false
    );
    if not coalesce((next_action_result ->> 'ok')::boolean, false) then
      raise exception 'Next action update failed: %',
        coalesce(next_action_result ->> 'message', 'unknown error');
    end if;
    combined_result := combined_result || jsonb_build_object(
      'next_action', next_action_result -> 'next_action',
      'next_action_changed', coalesce((next_action_result ->> 'changed')::boolean, false)
    );
    if p_idempotency_key is not null then
      update public.operation_log
         set result = combined_result
       where actor_id = actor
         and idempotency_key = p_idempotency_key;
    end if;
  end if;

  return combined_result;
end;
$$;

revoke all on function public.post_task_update_v34_internal(
  uuid, text, boolean, uuid, uuid[], jsonb, text
) from public, anon, authenticated;
revoke all on function public.set_task_next_action(uuid, integer, text, boolean, text) from public;
revoke all on function public.post_task_update(
  uuid, text, boolean, uuid, uuid[], jsonb, text, text
) from public;

grant execute on function public.set_task_next_action(uuid, integer, text, boolean, text)
  to authenticated;
grant execute on function public.post_task_update(
  uuid, text, boolean, uuid, uuid[], jsonb, text, text
) to authenticated;

comment on function public.set_task_next_action(uuid, integer, text, boolean, text)
  is 'Sets, edits, or completes the current task Next action with optimistic locking and immutable audit.';
comment on function public.post_task_update(uuid, text, boolean, uuid, uuid[], jsonb, text, text)
  is 'Posts a task update and optionally refreshes Next action in the same transaction.';
