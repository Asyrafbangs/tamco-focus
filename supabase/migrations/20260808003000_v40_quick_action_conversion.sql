-- ---------------------------------------------------------------------------
-- v40 section 10 — converting a Quick Action into an Operational Action.
--
-- A Quick Action is a same-day errand with no focus slot and almost no
-- governance. Sometimes one turns out to be none of those things: it needs
-- several days, or evidence, or somebody else's help, or a barrier gets in the
-- way. Conversion is the honest response — rather than growing the Quick Action
-- UI until it is an Operational Action wearing a smaller name.
--
-- Conversion changes the WORK CLASS, which is a genuine change of what the work
-- is, and it lands in `backlog`. It does not activate: taking on sustained work
-- is a focus decision, and the person makes it from Available like any other
-- (v40 sections 2, 11, 15).
-- ---------------------------------------------------------------------------

create or replace function public.convert_quick_action(
  p_task_id uuid,
  p_expected_version integer,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := focus.current_user_id();
  task public.tasks;
  replayed jsonb;
  result jsonb;
begin
  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then
      return replayed;
    end if;
  end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then
    return focus.error('not_found', 'That work no longer exists.');
  end if;

  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'You cannot change this work.');
  end if;

  if task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This work changed while you were looking at it. Reopen it and try again.');
  end if;

  if task.work_class <> 'quick_action' then
    return focus.error('invalid_state', 'Only a Quick Action can be converted.');
  end if;

  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'This work is already finished.');
  end if;

  update public.tasks
     set work_class = 'operational_action',
         focus_bucket = 'operational',
         -- Back to Available. Conversion is not activation: the person still
         -- chooses when to carry it, and the focus count is theirs to spend.
         status = 'backlog',
         -- v41 section 11: a genuine next action survives conversion; nothing
         -- is invented to fill the gap when there is none.
         next_action = next_action,
         activated_by = null,
         activated_at = null,
         over_focus_target = false,
         activation_reason_code = null,
         activation_reason_note = null,
         classification_rule_code = 'converted_from_quick_action',
         classification_rule_text = coalesce(
           nullif(btrim(coalesce(p_reason, '')), ''),
           'Converted from a Quick Action because it needs more than one day.'),
         state_entered_at = now(),
         last_meaningful_update_at = now(),
         updated_at = now(),
         version = version + 1
   where id = p_task_id;

  perform focus.write_audit(
    p_event_type := 'task_classified',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_detail := jsonb_build_object(
      'from_work_class', 'quick_action',
      'to_work_class', 'operational_action',
      'status', 'backlog',
      'reason', nullif(btrim(coalesce(p_reason, '')), ''),
      'classification_rule_code', 'converted_from_quick_action'));

  result := jsonb_build_object(
    'ok', true,
    'code', 'quick_action_converted',
    'task_id', p_task_id,
    'version', task.version + 1);

  return focus.remember_operation(actor, p_idempotency_key, 'convert_quick_action', result);
end;
$$;

revoke all on function public.convert_quick_action(uuid, integer, text, text) from public, anon;
grant execute on function public.convert_quick_action(uuid, integer, text, text) to authenticated;
