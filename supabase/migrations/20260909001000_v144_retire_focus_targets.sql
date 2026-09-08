-- ============================================================================
-- v144 — the focus target stops being a gate
--
-- Manager and Employee Change Specification §3 and §11.
--
-- "Major 1/1, Operational 6/5, Development 0/1" is removed from every work
-- view because it is not a reliable workload measure: it counts items, and one
-- Major Project, five inspections and a training course are not the same size
-- as each other in any direction. §11 goes further than the display and asks
-- for "any associated enforcement that would contradict the new guidance" to
-- go with it — and the enforcement is here, in `activate_task`, where crossing
-- a number the specification calls unreliable made somebody justify themselves
-- and sent their manager a notification about it.
--
-- What this migration does NOT do is remove any column, enum value or history.
-- §11 is explicit: preserve old values for audit and downstream compatibility,
-- and prefer additive change. So `tasks.over_focus_target`,
-- `activation_reason_code`, `activation_reason_note`, the `activation_reason`
-- enum, the `over_target_activation` audit type and every row already carrying
-- them stay exactly as they are. What changes is that starting work no longer
-- demands a justification and no longer notifies anybody.
--
-- `over_focus_target` is still maintained where it already was — reassignment
-- recalculates both owners through `focus.refresh_over_target`, and that is a
-- fact about a row rather than a judgement shown to anyone. Nothing in the
-- product reads the flag after v144; leaving the bookkeeping alone keeps this
-- migration to the one thing §11 asks for.
--
-- `focus.effective_focus_target` and `focus.active_focus_count` also stay.
-- They are read by `focus_summary`, which other reporting still selects from,
-- and removing a function to delete four lines of arithmetic would be a wider
-- change than the one being asked for.
--
-- The signature keeps `p_reason_code` and `p_reason_note`. Dropping arguments
-- from a function the deployed client calls means a window where the running
-- application is calling a function that no longer exists; the parameters are
-- accepted and ignored instead, which costs two unused arguments and no
-- downtime.
-- ============================================================================

create or replace function public.activate_task(
  p_task_id uuid,
  p_expected_version integer,
  p_reason_code public.activation_reason default null,
  p_reason_note text default null,
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
  count_before integer;
  count_after integer;
  target integer;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to activate work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then
    return replayed;
  end if;

  -- Lock the row for the duration of the transaction. Two concurrent
  -- activations therefore serialise here, and the second reads a count that
  -- already includes the first.
  select * into task from public.tasks where id = p_task_id for update;

  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;

  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised',
      'You can view this work but you are not authorised to activate it.');
  end if;

  if task.status = 'active' then
    -- Already in the requested state. Treat as success so a duplicate click
    -- reads as done rather than as an error.
    return jsonb_build_object(
      'ok', true, 'code', 'already_active', 'task', focus.task_snapshot(p_task_id));
  end if;

  if task.status not in ('backlog', 'paused') then
    return focus.error('invalid_state',
      'Only Available Work or paused work can be activated.');
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This task was updated by another user. Review the latest information before continuing.',
      jsonb_build_object('current_version', task.version));
  end if;

  /*
   * Still counted, and still written to the audit trail.
   *
   * The count is a fact about the moment the work started and it is worth
   * having later; what §3 removes is the verdict drawn from it. So the numbers
   * are recorded and nothing is decided on them: no reason is demanded, no
   * notification is sent, and `over_focus_target` is not set on new rows.
   */
  count_before := coalesce(focus.active_focus_count(task.primary_owner_id, task.focus_bucket), 0);
  target := coalesce(focus.effective_focus_target(task.primary_owner_id, task.focus_bucket), 0);
  count_after := count_before + 1;

  update public.tasks
     set status = 'active',
         activated_by = actor,
         activated_at = now(),
         over_focus_target = false,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  event_id := focus.write_audit(
    p_event_type := 'task_activated'::public.audit_event_type,
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := 'active',
    p_bucket := task.focus_bucket,
    p_count_before := count_before,
    p_count_after := count_after,
    p_target := target,
    p_over_target := false,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('mandatory', task.is_mandatory)
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'activated',
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id,
    'count_before', count_before,
    'count_after', count_after,
    'target', target,
    'over_target', false
  );

  return focus.remember_operation(actor, p_idempotency_key, 'activate_task', result);
end;
$$;

comment on function public.activate_task(uuid, integer, public.activation_reason, text, text) is
  'Move work to Active. v144 (specification sections 3 and 11): the focus '
  'target is recorded in the audit trail and no longer gates anything. '
  'p_reason_code and p_reason_note are accepted and ignored, and are kept only '
  'so a deployed client calling the previous signature does not break.';

-- ----------------------------------------------------------------------------
-- The setting that turned the gate on is retired with it.
--
-- Left in place it would be a switch wired to nothing: an administrator could
-- set "reason required" and no reason would ever be asked for. The row is
-- deleted rather than the key being kept at false, so nothing reads as an
-- available option. Historic reasons already recorded on tasks are untouched.
-- ----------------------------------------------------------------------------
delete from public.org_settings where key = 'focus.reason_required_when_replacing';
