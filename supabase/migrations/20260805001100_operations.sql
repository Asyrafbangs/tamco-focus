-- ============================================================================
-- TAMCO Focus — transactional task operations
--
-- Implements PRODUCTION_LOGIC.md sections 2, 3, 4, 6 and
-- MASTER_PRODUCT_SPEC.md sections 7, 20, 24.
--
-- Every high-impact change lives here rather than in application code, because
-- only the database can offer what section 6 requires at the same time:
--   * a real transaction around multi-row changes
--   * a row lock so two concurrent activations cannot both read the same count
--   * a version comparison that rejects a stale client
--   * an audit event written or rolled back together with the change itself
--
-- Application code calls these and renders the result. It never recomputes a
-- focus count or a permission to decide whether a transition is allowed.
--
-- Return shape is uniform: `ok` plus a machine-readable `code`. Callers branch
-- on `code`, never on message text.
--   ok=true                  the operation committed
--   reason_required          over target; ask the one question (section 7.4)
--   reason_note_required     "Other" was chosen without a note
--   version_conflict         another user changed the record (section 27.6)
--   not_authorised           caller lacks authority for this transition
--   invalid_state            the transition does not apply from this state
--   evidence_missing         required checklist items or evidence are absent
-- ============================================================================

-- Undo is a UI affordance of about ten seconds (section 7.3). The server allows
-- a slightly wider window so a click made at 9.8 seconds does not fail on
-- network latency alone.
insert into public.org_settings (key, value, description, manager_editable)
values ('focus.undo_window_seconds', '30'::jsonb,
        'Server-side grace period during which a reversible action may be undone.', false)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Idempotency (PRODUCTION_LOGIC.md section 6, item 4).
--
-- A repeated click carries the same key and returns the first result rather
-- than performing the action twice. The unique constraint is what makes this
-- race-free: the second concurrent attempt loses the insert and reads the
-- winner's stored result.
-- ---------------------------------------------------------------------------

create table public.operation_log (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_id uuid not null references public.user_profiles (id),
  idempotency_key text not null,
  operation text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),

  constraint operation_log_key_unique unique (actor_id, idempotency_key)
);

create index operation_log_created_idx on public.operation_log (created_at);

alter table public.operation_log enable row level security;

create policy operation_log_select_own on public.operation_log
  for select to authenticated
  using (actor_id = focus.current_user_id());

-- ---------------------------------------------------------------------------
-- Shared internals
-- ---------------------------------------------------------------------------

create or replace function focus.write_audit(
  p_event_type public.audit_event_type,
  p_actor_id uuid,
  p_task_id uuid default null,
  p_subject_user_id uuid default null,
  p_previous_status public.task_status default null,
  p_new_status public.task_status default null,
  p_bucket public.focus_bucket default null,
  p_count_before integer default null,
  p_count_after integer default null,
  p_target integer default null,
  p_over_target boolean default null,
  p_reason_code public.activation_reason default null,
  p_reason_note text default null,
  p_reversal_of uuid default null,
  p_task_version integer default null,
  p_detail jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_id uuid;
begin
  insert into public.audit_events (
    event_type, actor_id, task_id, subject_user_id,
    previous_status, new_status, bucket,
    count_before, count_after, target_at_event, over_target,
    reason_code, reason_note, reversal_of_event_id, task_version, detail
  ) values (
    p_event_type, p_actor_id, p_task_id, p_subject_user_id,
    p_previous_status, p_new_status, p_bucket,
    p_count_before, p_count_after, p_target, p_over_target,
    p_reason_code, p_reason_note, p_reversal_of, p_task_version, p_detail
  )
  returning id into new_id;

  return new_id;
end;
$$;

create or replace function focus.notify(
  p_recipient uuid,
  p_kind public.notification_kind,
  p_channel public.notification_channel,
  p_requires_action boolean,
  p_title text,
  p_body text,
  p_task_id uuid default null,
  p_barrier_id uuid default null,
  p_actor_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Never notify someone about their own action, and never notify a
  -- deactivated account.
  if p_recipient is null or p_recipient = p_actor_id then
    return;
  end if;

  if not exists (
    select 1 from public.user_profiles where id = p_recipient and status = 'active'
  ) then
    return;
  end if;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, barrier_id, actor_id
  ) values (
    p_recipient, p_kind, p_channel, p_requires_action, p_title, p_body,
    p_task_id, p_barrier_id, p_actor_id
  );
end;
$$;

-- Recomputes and clears the over-target flag for a bucket after any change
-- that could have reduced the count (PRODUCTION_LOGIC.md section 2.5).
-- Historical over-target audit events are untouched.
create or replace function focus.refresh_over_target(
  p_owner uuid,
  p_bucket public.focus_bucket
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_count integer;
  current_target integer;
begin
  if p_bucket is null then
    return;
  end if;

  current_count := focus.active_focus_count(p_owner, p_bucket);
  current_target := coalesce(focus.effective_focus_target(p_owner, p_bucket), 0);

  if current_count <= current_target then
    update public.tasks
       set over_focus_target = false
     where primary_owner_id = p_owner
       and focus_bucket = p_bucket
       and status = 'active'
       and over_focus_target = true;
  end if;
end;
$$;

-- Returns a previously stored result for this key, or NULL.
create or replace function focus.replay_operation(p_actor uuid, p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select result
    from public.operation_log
   where actor_id = p_actor
     and idempotency_key = p_key;
$$;

create or replace function focus.remember_operation(
  p_actor uuid,
  p_key text,
  p_operation text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored jsonb;
begin
  if p_key is null then
    return p_result;
  end if;

  insert into public.operation_log (actor_id, idempotency_key, operation, result)
  values (p_actor, p_key, p_operation, p_result)
  on conflict (actor_id, idempotency_key) do nothing;

  -- If the insert lost a race, the winner's result is authoritative.
  select result into stored
    from public.operation_log
   where actor_id = p_actor and idempotency_key = p_key;

  return coalesce(stored, p_result);
end;
$$;

create or replace function focus.task_snapshot(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(row) from (
    select
      t.id,
      t.title,
      t.status,
      t.work_class,
      t.focus_bucket,
      t.primary_owner_id,
      t.due_at,
      t.due_is_date_only,
      t.review_at,
      t.progress_percent,
      t.over_focus_target,
      t.is_mandatory,
      t.review_status,
      t.state_entered_at,
      t.last_meaningful_update_at,
      t.completed_at,
      t.cancelled_at,
      t.version
    from public.tasks t
   where t.id = p_task_id
  ) row;
$$;

create or replace function focus.error(p_code text, p_message text, p_detail jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('ok', false, 'code', p_code, 'message', p_message)
      || jsonb_build_object('detail', p_detail);
$$;

-- ============================================================================
-- Activate (PRODUCTION_LOGIC.md sections 2.3, 2.4, 3.1)
--
-- The rule that matters most: reaching or exceeding the target NEVER disables
-- activation. Over target, the procedure returns `reason_required` once so the
-- interface can ask exactly one question, then proceeds on the retry. No
-- manager approval is involved at any point.
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
  will_exceed boolean;
  event_id uuid;
  replayed jsonb;
  result jsonb;
  manager_id uuid;
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

  count_before := coalesce(focus.active_focus_count(task.primary_owner_id, task.focus_bucket), 0);
  target := coalesce(focus.effective_focus_target(task.primary_owner_id, task.focus_bucket), 0);
  count_after := count_before + 1;

  -- Quick Actions, routine occurrences, and collaborative contributions carry
  -- no bucket, so they can never be over target (section 6.3).
  will_exceed := task.focus_bucket is not null and count_after > target;

  -- Section 4: mandatory safety, legal, compliance, incident, or emergency work
  -- activates immediately even above target, without the reason question.
  if will_exceed and not task.is_mandatory then
    if p_reason_code is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'reason_required',
        'message', format(
          'You already have %s active %s. Activating this will make %s against a target of %s. Why is this additional focus needed now?',
          count_before,
          replace(task.focus_bucket::text, '_', ' '),
          count_after,
          target),
        'detail', jsonb_build_object(
          'count_before', count_before,
          'count_after', count_after,
          'target', target,
          'bucket', task.focus_bucket)
      );
    end if;

    -- Section 7.4: a note is required only for "Other".
    if p_reason_code = 'other' and length(btrim(coalesce(p_reason_note, ''))) = 0 then
      return focus.error('reason_note_required',
        'Add a short note explaining the reason you selected.');
    end if;
  end if;

  update public.tasks
     set status = 'active',
         activated_by = actor,
         activated_at = now(),
         activation_reason_code = case when will_exceed then p_reason_code else null end,
         activation_reason_note = case when will_exceed then p_reason_note else null end,
         over_focus_target = will_exceed,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  event_id := focus.write_audit(
    p_event_type := case when will_exceed then 'over_target_activation'::public.audit_event_type
                         else 'task_activated'::public.audit_event_type end,
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := 'active',
    p_bucket := task.focus_bucket,
    p_count_before := count_before,
    p_count_after := count_after,
    p_target := target,
    p_over_target := will_exceed,
    p_reason_code := case when will_exceed then p_reason_code else null end,
    p_reason_note := case when will_exceed then p_reason_note else null end,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('mandatory', task.is_mandatory)
  );

  -- Section 7.4 / 8: notify the manager, who is informed but does not approve.
  if will_exceed then
    select reporting_manager_id into manager_id
      from public.user_profiles where id = task.primary_owner_id;

    perform focus.notify(
      manager_id,
      'over_target_activation',
      'immediate',
      false,
      'Over focus target',
      format('%s activated "%s", taking %s work to %s against a target of %s.',
             (select full_name from public.user_profiles where id = task.primary_owner_id),
             task.title,
             replace(task.focus_bucket::text, '_', ' '),
             count_after, target),
      p_task_id, null, actor);
  end if;

  result := jsonb_build_object(
    'ok', true,
    'code', case when will_exceed then 'activated_over_target' else 'activated' end,
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id,
    'count_before', count_before,
    'count_after', count_after,
    'target', target,
    'over_target', will_exceed
  );

  return focus.remember_operation(actor, p_idempotency_key, 'activate_task', result);
end;
$$;

-- ============================================================================
-- Move to Available Work (PRODUCTION_LOGIC.md section 3.2)
--
-- One action, `active -> backlog`, preserving owner, bucket, urgency, due date,
-- progress, checklist, comments, evidence, relationships, and history. This is
-- never described as Cancel or Delete.
-- ============================================================================

create or replace function public.move_task_to_available(
  p_task_id uuid,
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
  task record;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to move work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then
    return replayed;
  end if;

  select * into task from public.tasks where id = p_task_id for update;

  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;

  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised',
      'You can view this work but you are not authorised to move it.');
  end if;

  if task.status = 'backlog' then
    return jsonb_build_object(
      'ok', true, 'code', 'already_available', 'task', focus.task_snapshot(p_task_id));
  end if;

  if task.status <> 'active' then
    return focus.error('invalid_state', 'Only Active work can be moved to Available Work.');
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This task was updated by another user. Review the latest information before continuing.',
      jsonb_build_object('current_version', task.version));
  end if;

  update public.tasks
     set status = 'backlog',
         over_focus_target = false,
         activation_reason_code = null,
         activation_reason_note = null,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  event_id := focus.write_audit(
    p_event_type := 'task_moved_to_available',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := 'active',
    p_new_status := 'backlog',
    p_bucket := task.focus_bucket,
    p_count_before := coalesce(focus.active_focus_count(task.primary_owner_id, task.focus_bucket), 0) + 1,
    p_count_after := coalesce(focus.active_focus_count(task.primary_owner_id, task.focus_bucket), 0),
    p_target := focus.effective_focus_target(task.primary_owner_id, task.focus_bucket),
    p_task_version := task.version + 1
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'moved_to_available',
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id
  );

  return focus.remember_operation(actor, p_idempotency_key, 'move_task_to_available', result);
end;
$$;

-- ============================================================================
-- Pause and resume (section 14.3)
-- ============================================================================

create or replace function public.pause_task(
  p_task_id uuid,
  p_expected_version integer,
  p_reason text,
  p_restart_at timestamptz default null,
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
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to pause work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'You are not authorised to pause this work.');
  end if;

  if task.status = 'paused' then
    return jsonb_build_object('ok', true, 'code', 'already_paused',
                              'task', focus.task_snapshot(p_task_id));
  end if;

  if task.status not in ('active', 'backlog') then
    return focus.error('invalid_state', 'Only Active or Available Work can be paused.');
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This task was updated by another user. Review the latest information before continuing.',
      jsonb_build_object('current_version', task.version));
  end if;

  -- Section 14.3: a paused task must carry restart or review information.
  if length(btrim(coalesce(p_reason, ''))) = 0 and p_restart_at is null then
    return focus.error('restart_information_required',
      'Record why this is paused and when it should restart or be reviewed.');
  end if;

  update public.tasks
     set status = 'paused',
         paused_reason = p_reason,
         paused_restart_at = p_restart_at,
         over_focus_target = false,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  event_id := focus.write_audit(
    p_event_type := 'task_paused',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := 'paused',
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('reason', p_reason, 'restart_at', p_restart_at)
  );

  result := jsonb_build_object('ok', true, 'code', 'paused',
                               'task', focus.task_snapshot(p_task_id),
                               'audit_event_id', event_id);
  return focus.remember_operation(actor, p_idempotency_key, 'pause_task', result);
end;
$$;

create or replace function public.resume_task(
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
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to resume work.');
  end if;

  select * into task from public.tasks where id = p_task_id;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if task.status <> 'paused' then
    return focus.error('invalid_state', 'Only paused work can be resumed.');
  end if;

  -- Resuming returns work to Active, so it re-enters focus counting under
  -- exactly the same soft-target rules as any other activation.
  update public.tasks set paused_reason = null, paused_restart_at = null where id = p_task_id;

  return public.activate_task(
    p_task_id, p_expected_version, p_reason_code, p_reason_note, p_idempotency_key);
end;
$$;

-- ============================================================================
-- Complete (section 20.1)
--
-- A task cannot complete while required checklist items or required evidence
-- are missing, and the response must say exactly what is missing.
-- ============================================================================

create or replace function public.complete_task(
  p_task_id uuid,
  p_expected_version integer,
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
  task record;
  missing_items text[];
  missing_evidence text[];
  needs_review boolean;
  reviewer uuid;
  event_id uuid;
  replayed jsonb;
  result jsonb;
  review_classes jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to complete work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_contribute_to_task(p_task_id) then
    return focus.error('not_authorised', 'You are not authorised to complete this work.');
  end if;

  if task.status = 'completed' then
    return jsonb_build_object('ok', true, 'code', 'already_completed',
                              'task', focus.task_snapshot(p_task_id));
  end if;

  if task.status not in ('active', 'backlog', 'paused') then
    return focus.error('invalid_state', 'This work cannot be completed from its current state.');
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This task was updated by another user. Review the latest information before continuing.',
      jsonb_build_object('current_version', task.version));
  end if;

  -- Outstanding checklist steps.
  select array_agg(ci.action order by ci.position)
    into missing_items
    from public.task_checklist_items ci
   where ci.task_id = p_task_id
     and ci.state <> 'completed';

  -- Steps marked as requiring evidence that carry no attachment.
  select array_agg(ci.action order by ci.position)
    into missing_evidence
    from public.task_checklist_items ci
   where ci.task_id = p_task_id
     and ci.evidence_rule = 'required'
     and not exists (
       select 1 from public.attachments a where a.checklist_item_id = ci.id
     );

  if missing_items is not null or missing_evidence is not null then
    return focus.error(
      'evidence_missing',
      'This work cannot be completed yet.',
      jsonb_build_object(
        'incomplete_items', coalesce(to_jsonb(missing_items), '[]'::jsonb),
        'missing_evidence', coalesce(to_jsonb(missing_evidence), '[]'::jsonb))
    );
  end if;

  -- Section 20.3 — review policy is configurable by work type, and mandatory
  -- work always requires review.
  review_classes := focus.setting('review.required_for_work_classes');
  needs_review :=
    (review_classes ? task.work_class::text)
    or (task.is_mandatory and coalesce((focus.setting('review.required_when_mandatory'))::boolean, true));

  -- A routine occurrence follows its template's rule (section 20.7).
  if task.work_class = 'routine_occurrence' then
    select rt.requires_completion_review into needs_review
      from public.routine_templates rt where rt.id = task.routine_template_id;
    needs_review := coalesce(needs_review, false);
  end if;

  if needs_review then
    reviewer := coalesce(
      task.reviewer_id,
      (select reporting_manager_id from public.user_profiles where id = task.primary_owner_id)
    );
  end if;

  update public.tasks
     set status = 'completed',
         completed_at = now(),
         progress_percent = 100,
         over_focus_target = false,
         review_status = case when needs_review then 'pending'::public.review_status
                              else 'not_required'::public.review_status end,
         reviewer_id = coalesce(reviewer, task.reviewer_id),
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  if needs_review then
    insert into public.completion_reviews (task_id, submitted_by, reviewer_id)
    values (p_task_id, actor, reviewer);

    perform focus.notify(
      reviewer, 'completion_review_assigned', 'immediate', true,
      'Completion review needed',
      format('"%s" was completed and needs your review decision.', task.title),
      p_task_id, null, actor);
  end if;

  event_id := focus.write_audit(
    p_event_type := 'completion_submitted',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := 'completed',
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('note', p_completion_note, 'review_required', needs_review)
  );

  result := jsonb_build_object(
    'ok', true,
    'code', case when needs_review then 'completed_pending_review' else 'completed' end,
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id,
    'review_required', needs_review
  );

  return focus.remember_operation(actor, p_idempotency_key, 'complete_task', result);
end;
$$;

-- ============================================================================
-- Cancel (section 6.1 — a terminal archived outcome, never a working column)
-- ============================================================================

create or replace function public.cancel_task(
  p_task_id uuid,
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
  task record;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to cancel work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'You are not authorised to cancel this work.');
  end if;

  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed and cancelled work cannot be cancelled again.');
  end if;

  if length(btrim(coalesce(p_reason, ''))) = 0 then
    return focus.error('reason_required', 'Record why this work is being cancelled.');
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This task was updated by another user. Review the latest information before continuing.',
      jsonb_build_object('current_version', task.version));
  end if;

  update public.tasks
     set status = 'cancelled',
         cancelled_at = now(),
         over_focus_target = false,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  perform focus.refresh_over_target(task.primary_owner_id, task.focus_bucket);

  event_id := focus.write_audit(
    p_event_type := 'task_cancelled',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_previous_status := task.status,
    p_new_status := 'cancelled',
    p_bucket := task.focus_bucket,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('reason', p_reason)
  );

  result := jsonb_build_object('ok', true, 'code', 'cancelled',
                               'task', focus.task_snapshot(p_task_id),
                               'audit_event_id', event_id);
  return focus.remember_operation(actor, p_idempotency_key, 'cancel_task', result);
end;
$$;

-- ============================================================================
-- Reassign (section 3.2; PRODUCTION_LOGIC.md section 2.2 — the count transfers
-- after the new owner's workload is recalculated)
-- ============================================================================

create or replace function public.reassign_task(
  p_task_id uuid,
  p_expected_version integer,
  p_new_owner_id uuid,
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
  previous_owner uuid;
  new_count integer;
  target integer;
  event_id uuid;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to reassign work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  -- Reassignment is a manager act; a view grant never confers it (section 3.4).
  if not (focus.is_admin()
          or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))) then
    return focus.error('not_authorised', 'Only an authorised manager can reassign this work.');
  end if;

  if not exists (
    select 1 from public.user_profiles where id = p_new_owner_id and status = 'active'
  ) then
    return focus.error('invalid_owner', 'The new owner must be an active account.');
  end if;

  if p_new_owner_id = task.primary_owner_id then
    return jsonb_build_object('ok', true, 'code', 'unchanged',
                              'task', focus.task_snapshot(p_task_id));
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This task was updated by another user. Review the latest information before continuing.',
      jsonb_build_object('current_version', task.version));
  end if;

  previous_owner := task.primary_owner_id;

  update public.tasks
     set primary_owner_id = p_new_owner_id,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  -- Recalculate both sides: the previous owner may drop below target, and the
  -- new owner may now be above it.
  perform focus.refresh_over_target(previous_owner, task.focus_bucket);

  if task.status = 'active' and task.focus_bucket is not null then
    new_count := focus.active_focus_count(p_new_owner_id, task.focus_bucket);
    target := coalesce(focus.effective_focus_target(p_new_owner_id, task.focus_bucket), 0);

    if new_count > target then
      update public.tasks set over_focus_target = true where id = p_task_id;
    end if;
  end if;

  event_id := focus.write_audit(
    p_event_type := 'task_reassigned',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_subject_user_id := p_new_owner_id,
    p_bucket := task.focus_bucket,
    p_count_after := new_count,
    p_target := target,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object('previous_owner_id', previous_owner)
  );

  perform focus.notify(
    p_new_owner_id, 'reassignment', 'immediate', true,
    'Work assigned to you',
    format('"%s" is now your responsibility.', task.title),
    p_task_id, null, actor);

  perform focus.notify(
    previous_owner, 'ownership_changed', 'immediate', false,
    'Work reassigned',
    format('"%s" was reassigned to %s.', task.title,
           (select full_name from public.user_profiles where id = p_new_owner_id)),
    p_task_id, null, actor);

  result := jsonb_build_object('ok', true, 'code', 'reassigned',
                               'task', focus.task_snapshot(p_task_id),
                               'audit_event_id', event_id);
  return focus.remember_operation(actor, p_idempotency_key, 'reassign_task', result);
end;
$$;
