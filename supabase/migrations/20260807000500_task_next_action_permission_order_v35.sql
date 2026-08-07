-- Keep authorisation ahead of optimistic-version feedback so a view-only user
-- cannot probe the current version of a task they are not allowed to edit.

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
