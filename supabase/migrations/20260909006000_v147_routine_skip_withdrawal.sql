-- ============================================================================
-- v147 — withdrawing a skip request, deciding it at all, and not deciding a
-- stale one
--
-- Manager and Employee Change Specification §15.
--
-- Two halves of one rule. "While a skip request is pending, the employee can
-- withdraw it and complete the work through the normal flow. Withdrawal and
-- completion must be consistent so the manager cannot accept a stale request
-- afterward."
--
-- The first half did not exist: a request, once raised, could only be accepted
-- or returned by somebody else. An employee who found the site open after all
-- had to ask their manager to return their own request before they could do
-- the work.
--
-- The second half was a live inconsistency. `decide_routine_exception` checked
-- that the REQUEST was still pending but never that the OCCURRENCE was still
-- open, so an employee could complete the inspection, the request would sit
-- there, and a manager reading their queue the next morning could accept it —
-- cancelling a completed occurrence and recording "not required" against work
-- that had been done. Two mutually exclusive outcomes, in that order, with the
-- evidence still attached.
--
-- And a third thing found on the way: `decide_routine_exception` has never
-- worked. Its audit call passes an uncast `case` over two literals, which
-- resolves to `text`, and `focus.write_audit` takes an `audit_event_type` —
-- so every accept and every return since v91 has raised 42883 and rolled back.
-- The fix is one cast. What let it survive nine versions is that no test ever
-- accepted a skip; writing the one §15 asks for is what surfaced it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A withdrawal is not a decision.
--
-- The existing constraint demanded a decider for every state but `pending`,
-- which would have made a retraction look like the manager's doing. Withdrawn
-- rows carry `withdrawn_at` and no decider at all.
-- ----------------------------------------------------------------------------

alter table public.routine_occurrence_exceptions
  add column if not exists withdrawn_at timestamptz;

alter table public.routine_occurrence_exceptions
  drop constraint if exists routine_exception_decision_consistent;

alter table public.routine_occurrence_exceptions
  add constraint routine_exception_decision_consistent check (
    (state = 'pending' and decided_by is null and decided_at is null and withdrawn_at is null)
    or (state = 'withdrawn' and decided_by is null and decided_at is null
        and withdrawn_at is not null)
    or (state in ('accepted', 'returned') and decided_by is not null and decided_at is not null)
  );

-- ----------------------------------------------------------------------------
-- Taking it back.
--
-- Only the person who raised it, and only while nobody has answered. A manager
-- who disagrees has `decide_routine_exception`; withdrawing is the employee
-- saying they were wrong about the occurrence, not a second route to a
-- decision.
-- ----------------------------------------------------------------------------

create or replace function public.withdraw_routine_exception(
  p_exception_id uuid,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  record_row public.routine_occurrence_exceptions;
  task public.tasks;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into record_row
    from public.routine_occurrence_exceptions where id = p_exception_id for update;
  if not found then
    return focus.error('not_found', 'That request no longer exists.');
  end if;

  if record_row.state <> 'pending' then
    /*
     * Already answered, or already taken back. Reported as success so a second
     * click reads as done rather than as a failure — but never as a way to
     * undo an accepted skip, which is a decision somebody made.
     */
    return jsonb_build_object('ok', true, 'code', 'already_resolved');
  end if;

  if record_row.raised_by <> actor then
    return focus.error(
      'not_authorised',
      'Only the person who raised this can take it back.');
  end if;

  select * into task from public.tasks where id = record_row.task_id;
  if not found or task.deleted_at is not null then
    return focus.error('not_found', 'This occurrence no longer exists.');
  end if;

  update public.routine_occurrence_exceptions
     set state = 'withdrawn',
         withdrawn_at = now()
   where id = p_exception_id;

  perform focus.write_audit(
    p_event_type := 'routine_not_required_withdrawn'::public.audit_event_type,
    p_actor_id := actor,
    p_task_id := record_row.task_id,
    p_detail := jsonb_build_object(
      'exception_id', p_exception_id,
      'reason_code', record_row.reason_code));

  result := jsonb_build_object('ok', true, 'code', 'exception_withdrawn');
  return focus.remember_operation(actor, p_idempotency_key, 'withdraw_routine_exception', result);
end;
$$;

revoke all on function public.withdraw_routine_exception(uuid, text) from public, anon;
grant execute on function public.withdraw_routine_exception(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Completing the work answers the question.
--
-- On the row rather than inside `complete_task`, because an occurrence can
-- close through more than one path — completion, completion with evidence,
-- cancellation — and a rule written into one of them is a rule the others do
-- not have. The withdrawal is automatic and says so: the employee did not
-- retract anything, the work simply happened.
-- ----------------------------------------------------------------------------

create or replace function focus.withdraw_exception_on_close()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.work_class = 'routine_occurrence'
     and new.status in ('completed', 'cancelled')
     and old.status is distinct from new.status then
    update public.routine_occurrence_exceptions
       set state = 'withdrawn',
           withdrawn_at = now()
     where task_id = new.id
       and state = 'pending';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_withdraw_exception_on_close on public.tasks;
create trigger tasks_withdraw_exception_on_close
  after update of status on public.tasks
  for each row execute function focus.withdraw_exception_on_close();

-- ----------------------------------------------------------------------------
-- And the decision refuses a closed occurrence outright.
--
-- Belt and braces with the trigger above, deliberately. The trigger keeps the
-- data consistent; this gives the manager a sentence instead of a silent
-- success on a request that no longer means anything.
--
-- Replacing the LATEST definition, which is v91's. Everything else in it is
-- carried over unchanged.
-- ----------------------------------------------------------------------------

create or replace function public.decide_routine_exception(
  p_exception_id uuid,
  p_accept boolean,
  p_note text default null,
  p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  record_row public.routine_occurrence_exceptions;
  task public.tasks;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account.');
  end if;
  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into record_row
    from public.routine_occurrence_exceptions where id = p_exception_id for update;
  if not found then
    return focus.error('not_found', 'That request no longer exists.');
  end if;
  if record_row.state <> 'pending' then
    return jsonb_build_object('ok', true, 'code', 'already_decided');
  end if;

  select * into task from public.tasks where id = record_row.task_id for update;
  if not found or task.deleted_at is not null then
    return focus.error('not_found', 'This occurrence no longer exists.');
  end if;

  /*
   * §15 — a stale request is not a decision waiting to be made.
   *
   * Without this, accepting a request on an occurrence somebody had already
   * completed cancelled the completed row and recorded "not required" against
   * work that was done, with its evidence still attached.
   */
  if task.status in ('completed', 'cancelled') then
    return focus.error(
      'invalid_state',
      'This occurrence has already been closed, so there is nothing left to decide.');
  end if;

  -- The owner's manager, or an administrator. Never the person who raised it:
  -- accepting your own statement that no work was needed is not a review.
  if actor = record_row.raised_by then
    return focus.error(
      'not_authorised',
      'Somebody else has to accept this. You raised it.');
  end if;
  if not (focus.is_admin() or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))) then
    return focus.error(
      'not_authorised',
      'Only this person''s manager can decide whether the work was needed.');
  end if;

  if not p_accept and clean_note is null then
    return focus.error(
      'validation_failed',
      'Say why it is coming back. The person has to know what still needs doing.');
  end if;
  if clean_note is not null and length(clean_note) > 500 then
    return focus.error('validation_failed', 'Keep the note to 500 characters or fewer.');
  end if;

  update public.routine_occurrence_exceptions
     set state = case when p_accept then 'accepted'::public.routine_exception_state
                      else 'returned'::public.routine_exception_state end,
         decided_by = actor,
         decided_at = now(),
         decision_note = clean_note
   where id = p_exception_id;

  if p_accept then
    update public.tasks
       set status = 'cancelled',
           cancelled_at = now(),
           over_focus_target = false,
           last_meaningful_update_at = now(),
           version = version + 1
     where id = record_row.task_id;
    perform focus.deactivate_task_projections(record_row.task_id);
  else
    -- Nothing to undo on the task: it never left `backlog`, so it simply
    -- reappears in Due or Overdue where it always was.
    perform focus.notify(
      p_recipient := record_row.raised_by,
      p_kind := 'work_cannot_continue',
      p_channel := 'immediate',
      p_requires_action := true,
      p_title := format('%s returned - it still needs to be completed', task.title),
      p_body := clean_note,
      p_task_id := record_row.task_id,
      p_actor_id := actor);
  end if;

  /*
   * Cast, and this is not cosmetic.
   *
   * `case when ... then 'a' else 'b' end` over two bare literals resolves to
   * `text`, and there is no `focus.write_audit(p_event_type => text)`. This
   * procedure has therefore thrown 42883 on every accept and every return
   * since v91 — the decision never landed and the manager saw a generic
   * failure. Nothing covered it, because nothing tested accepting a skip.
   */
  perform focus.write_audit(
    p_event_type := (case when p_accept then 'routine_not_required_accepted'
                          else 'routine_not_required_returned' end)::public.audit_event_type,
    p_actor_id := actor,
    p_task_id := record_row.task_id,
    p_detail := jsonb_build_object(
      'exception_id', p_exception_id,
      'reason_code', record_row.reason_code,
      'decision_note', clean_note));

  result := jsonb_build_object(
    'ok', true,
    'code', case when p_accept then 'exception_accepted' else 'exception_returned' end);
  return focus.remember_operation(actor, p_idempotency_key, 'decide_routine_exception', result);
end;
$$;
