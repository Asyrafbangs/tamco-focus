-- ============================================================================
-- v148 — "Report urgent issue" has never created anything
--
-- Found while writing the §15 skip tests, which turned up the same fault in
-- `decide_routine_exception`: an audit call whose event type is an uncast
-- `case` over two literals. Postgres resolves that to `text`,
-- `focus.write_audit` declares `p_event_type public.audit_event_type`, and no
-- function matches — 42883, raised inside the procedure, rolling back the
-- whole transaction.
--
-- The branch it sits in runs only for `mandatory_operational_action`, which is
-- the destination behind "Urgent safety or compliance issue?" on New Work. So
-- the ordinary capture paths were fine and the urgent one silently created
-- nothing, which is the worst possible distribution of this bug.
--
-- Nothing caught it because the only test of that destination asserts a
-- REFUSAL — the urgency question unanswered — and returns before reaching the
-- audit call.
--
-- `confirm_work_capture` is replaced whole because a plpgsql body cannot be
-- patched in place. This is v134's definition, which is the latest, with two
-- lines changed and nothing else touched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.confirm_work_capture(p_capture_id uuid, p_destination capture_destination, p_parent_task_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor uuid := auth.uid();
  capture public.work_captures%rowtype;
  profile public.user_profiles%rowtype;
  parent public.tasks%rowtype;
  new_task_id uuid;
  new_proposal_id uuid;
  task_class public.work_class;
  task_bucket public.focus_bucket;
  task_status public.task_status;
  task_origin public.work_origin := 'self_initiated';
  count_before integer := 0;
  count_after integer := 0;
  target integer := 0;
  exceeds_target boolean := false;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to create work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into profile from public.user_profiles where id = actor for update;
  select * into capture from public.work_captures where id = p_capture_id for update;

  if not found then
    return focus.error('not_found', 'This captured work no longer exists.');
  end if;
  if capture.captured_by <> actor then
    return focus.error('not_authorised', 'You can confirm only work you captured.');
  end if;
  if capture.status = 'confirmed' then
    return jsonb_build_object('ok', true, 'code', 'already_confirmed',
      'task_id', capture.created_task_id, 'proposal_id', capture.created_proposal_id);
  end if;
  if capture.status <> 'pending_confirmation' then
    return focus.error('invalid_state', 'This capture is no longer awaiting confirmation.');
  end if;
  if p_destination = 'mandatory_operational_action'
     and not (capture.urgency_question_asked and capture.urgency_question_answer is true) then
    return focus.error('invalid_state',
      'Mandatory work requires an explicit yes to the urgent controlled-action question.');
  end if;

  if p_destination in ('major_project_request', 'routine_template_request') then
    insert into public.work_proposals (kind, title, rationale, proposed_by, payload)
    values (
      case when p_destination = 'major_project_request' then 'major_project' else 'routine_template' end,
      capture.title,
      capture.description,
      actor,
      jsonb_build_object('capture_id', capture.id, 'timing_choice', capture.timing_choice,
        'due_at', capture.due_at, 'due_is_date_only', capture.due_is_date_only,
        'recommended_destination', capture.recommended_destination,
        'success_measure', capture.success_measure,
        'expected_months', capture.expected_months)
    ) returning id into new_proposal_id;

    update public.work_captures
       set chosen_destination = p_destination, status = 'confirmed', resolved_at = now(),
           created_proposal_id = new_proposal_id
     where id = capture.id;

    perform focus.write_audit(
      p_event_type := 'task_classified', p_actor_id := actor,
      p_detail := jsonb_build_object('capture_id', capture.id, 'proposal_id', new_proposal_id,
        'recommended_destination', capture.recommended_destination,
        'chosen_destination', p_destination));

    perform focus.notify(profile.reporting_manager_id, 'manager_decision_required', 'immediate', true,
      'Work proposal needs review', format('%s proposed "%s".', profile.full_name, capture.title),
      null, null, actor);

    result := jsonb_build_object('ok', true, 'code', 'proposal_created',
      'proposal_id', new_proposal_id, 'destination', p_destination);
    return focus.remember_operation(actor, p_idempotency_key, 'confirm_work_capture', result);
  end if;

  case p_destination
    when 'quick_action' then
      task_class := 'quick_action'; task_bucket := null; task_status := 'active';
    when 'operational_available_work' then
      task_class := 'operational_action'; task_bucket := 'operational'; task_status := 'backlog';
    when 'self_development_plan' then
      task_class := 'self_development'; task_bucket := 'self_development'; task_status := 'backlog';
    when 'collaborative_contribution' then
      task_class := 'collaborative_contribution'; task_bucket := null; task_status := 'active';
      if p_parent_task_id is null then
        return focus.error('validation_failed', 'Choose the existing task this contribution supports.');
      end if;
      select * into parent from public.tasks where id = p_parent_task_id for update;
      if not found or not focus.can_view_task(p_parent_task_id) or parent.primary_owner_id = actor
         or parent.status in ('completed', 'cancelled') then
        return focus.error('invalid_state', 'Choose active work owned by someone else.');
      end if;
      task_origin := 'collaborative';
    when 'mandatory_operational_action' then
      task_class := 'operational_action'; task_bucket := 'operational'; task_status := 'active';
      count_before := focus.active_focus_count(actor, 'operational');
      target := focus.effective_focus_target(actor, 'operational');
      count_after := count_before + 1;
      exceeds_target := count_after > target;
    else
      return focus.error('validation_failed', 'Choose a supported work type.');
  end case;

  insert into public.tasks (
    title, description, next_action, status, work_class, focus_bucket, origin, urgency,
    primary_owner_id, created_by, due_at, due_is_date_only, is_mandatory,
    mandatory_justification, activated_by, activated_at, over_focus_target,
    classification_rule_code, classification_rule_text,
    completion_evidence_rule, completion_evidence_instruction
  ) values (
    capture.title, capture.description,
    case when p_destination = 'mandatory_operational_action'
      then 'Apply immediate control and update the manager'
      when task_status = 'active' then 'Complete this action'
      else 'Review and activate when ready' end,
    task_status, task_class, task_bucket, task_origin,
    case when p_destination = 'mandatory_operational_action'
      then 'critical'::public.urgency_level else 'normal'::public.urgency_level end,
    actor, actor, capture.due_at, capture.due_is_date_only,
    p_destination = 'mandatory_operational_action',
    case when p_destination = 'mandatory_operational_action' then capture.recommendation_reason else null end,
    case when task_status = 'active' then actor else null end,
    case when task_status = 'active' then now() else null end,
    exceeds_target,
    capture.classification_rule_code, capture.classification_rule_text,
    -- v134 - decided by whoever set the work up, carried to whoever completes it.
    coalesce(capture.completion_evidence_rule, 'optional'),
    nullif(btrim(coalesce(capture.completion_evidence_instruction, '')), '')
  ) returning id into new_task_id;

  if p_destination = 'collaborative_contribution' then
    insert into public.task_collaborators (task_id, user_id, added_by)
    values (p_parent_task_id, actor, actor) on conflict (task_id, user_id) do nothing;
    insert into public.task_relations (task_id, related_task_id, relation, created_by)
    values (new_task_id, p_parent_task_id, 'related', actor);
  end if;

  insert into public.attachments (
    task_id, storage_bucket, storage_path, file_name, mime_type, byte_size, uploaded_by
  )
  select new_task_id, storage_bucket, storage_path, file_name, mime_type, byte_size, actor
    from public.work_capture_attachments where capture_id = capture.id;
  delete from public.work_capture_attachments where capture_id = capture.id;

  update public.work_captures
     set chosen_destination = p_destination, parent_task_id = p_parent_task_id,
         status = 'confirmed', resolved_at = now(), created_task_id = new_task_id
   where id = capture.id;

  perform focus.write_audit(p_event_type := 'task_created', p_actor_id := actor,
    p_task_id := new_task_id, p_new_status := task_status, p_bucket := task_bucket,
    p_task_version := 1, p_detail := jsonb_build_object('capture_id', capture.id));
  perform focus.write_audit(p_event_type := 'task_classified', p_actor_id := actor,
    p_task_id := new_task_id, p_new_status := task_status, p_bucket := task_bucket,
    p_task_version := 1, p_detail := jsonb_build_object(
      'capture_id', capture.id, 'recommended_destination', capture.recommended_destination,
      'chosen_destination', p_destination));

  if p_destination = 'mandatory_operational_action' then
    perform focus.write_audit(
      /*
       * v148 — cast, and one event type rather than two.
       *
       * `case when ... then 'a' else 'b' end` over two bare literals resolves
       * to `text`, and `focus.write_audit` takes an `audit_event_type`. This
       * line has raised 42883 and rolled the whole confirmation back on every
       * urgent report since the route existed, so "Report urgent issue"
       * created nothing at all.
       *
       * It writes `task_activated` unconditionally now. v144 (§3) retired the
       * focus target as a thing the product draws conclusions from, and
       * `activate_task` already stopped emitting `over_target_activation`;
       * emitting it from here would be the one place still doing it.
       */
      p_event_type := 'task_activated'::public.audit_event_type,
      p_actor_id := actor, p_task_id := new_task_id, p_new_status := 'active',
      p_bucket := 'operational', p_count_before := count_before, p_count_after := count_after,
      p_target := target, p_over_target := exceeds_target, p_task_version := 1,
      p_detail := jsonb_build_object('mandatory', true, 'capture_id', capture.id));
    perform focus.notify(profile.reporting_manager_id, 'mandatory_action', 'immediate', true,
      'Mandatory action created', format('%s created mandatory work: "%s".', profile.full_name, capture.title),
      new_task_id, null, actor);
  end if;

  result := jsonb_build_object('ok', true, 'code', 'work_created', 'task_id', new_task_id,
    'destination', p_destination, 'over_target', exceeds_target);
  return focus.remember_operation(actor, p_idempotency_key, 'confirm_work_capture', result);
end;
$function$;
