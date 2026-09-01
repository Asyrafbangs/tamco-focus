-- v134 — the evidence a completion requires, decided once when the work is set
-- up rather than asked of the employee every time.
--
-- Until now the only evidence rules in the schema were per checklist step. A
-- piece of work with no steps could therefore be completed with nothing at all,
-- and there was no way to say "this one needs the report attached" short of
-- inventing a step whose only purpose was to carry the requirement.
--
-- Three values and no more:
--
--   optional      Attach something if it helps. Most work.
--   file_or_note  Proof is required, and a written result counts where no file
--                 genuinely exists — a discussion, a decision, a phone call.
--   file          A file is required. Inspections, site visits, assessments:
--                 the cases where a document or a photograph is the point.
--
-- `file_or_note` exists because the alternative is worse. A rule that demands
-- an upload for every completion gets one: a blank document, a duplicate
-- photograph, a screenshot of nothing. Requiring proof and accepting a written
-- result where a file cannot exist keeps the evidence that does arrive worth
-- reading.

alter table public.tasks
  add column if not exists completion_evidence_rule text not null default 'optional',
  -- What to attach, in the setter's words, carried to whoever completes it.
  add column if not exists completion_evidence_instruction text;

alter table public.tasks
  drop constraint if exists tasks_completion_evidence_rule_known;
alter table public.tasks
  add constraint tasks_completion_evidence_rule_known
  check (completion_evidence_rule in ('optional', 'file_or_note', 'file'));

alter table public.tasks
  drop constraint if exists tasks_completion_evidence_instruction_length;
alter table public.tasks
  add constraint tasks_completion_evidence_instruction_length
  check (
    completion_evidence_instruction is null
    or length(btrim(completion_evidence_instruction)) between 1 and 500
  );

-- A routine expresses the same idea already, as `routine_templates.
-- evidence_required`. Adding a second column here would be two sources for one
-- rule, and two sources drift: the schedule would say one thing and the
-- occurrence another, with nothing to say which was meant. The boolean is
-- therefore mapped rather than duplicated -- required means a file, and not
-- required means optional. Extending a routine to "file or note" means
-- widening that column and the two routine RPCs that write it, which is a
-- change to the routine contract rather than to this one.

comment on column public.tasks.completion_evidence_rule is
  'What completing this work requires as proof: optional, file_or_note, or file. '
  'Set when the work is created; enforced by complete_task.';
comment on column public.tasks.completion_evidence_instruction is
  'What to attach, in the words of whoever set the rule. Shown at completion.';

-- ---------------------------------------------------------------------------
-- The effective rule, and the evidence a task already holds, where the
-- interface can read them.
-- ---------------------------------------------------------------------------
--
-- An occurrence FOLLOWS its schedule rather than copying it. Copying at
-- generation would freeze the rule at the moment the occurrence was created,
-- so tightening a weekly inspection would leave the next fortnight of already
-- generated occurrences running under the old rule with nothing to show for
-- the change. This is the same derivation `complete_task` already uses for
-- `requires_completion_review`.

create or replace view public.task_overview
with (security_invoker = true) as
  SELECT t.id,
    t.title,
    t.description,
    t.next_action,
    t.status,
    t.work_class,
    t.focus_bucket,
    t.origin,
    t.urgency,
    t.is_mandatory,
    t.progress_percent,
    t.over_focus_target,
    t.activation_reason_code,
    t.activation_reason_note,
    t.review_status,
    t.reviewer_id,
    t.version,
    t.primary_owner_id,
    coalesce(owner.full_name, owner_dir.full_name) AS owner_name,
    coalesce(owner.employee_id, owner_dir.employee_id) AS owner_employee_id,
    owner.department_id AS owner_department_id,
    t.assigned_by,
    coalesce(assigner.full_name, assigner_dir.full_name) AS assigned_by_name,
    t.assignment_batch_id,
    t.classification_rule_code,
    t.classification_rule_text,
    t.routine_template_id,
    t.occurrence_date,
    t.created_at,
    t.state_entered_at,
    t.last_meaningful_update_at,
    t.due_at,
    t.due_is_date_only,
    t.review_at,
    t.completed_at,
    t.cancelled_at,
    t.due_at IS NOT NULL AND (t.status = ANY (ARRAY['backlog'::task_status, 'active'::task_status, 'paused'::task_status])) AND now() > t.due_at AS is_overdue,
    t.status = 'active'::task_status AND t.last_meaningful_update_at < (now() - make_interval(days => focus.stale_threshold_days())) AS is_stale,
    ( SELECT count(*) AS count
           FROM barriers b
          WHERE b.task_id = t.id AND b.status = 'open'::barrier_status) AS open_barrier_count,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id) AS checklist_total,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.state = 'completed'::checklist_item_state) AS checklist_completed,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.state = 'ready'::checklist_item_state) AS checklist_ready,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.evidence_rule = 'required'::evidence_rule AND NOT (EXISTS ( SELECT 1
                   FROM attachments a
                  WHERE a.checklist_item_id = ci.id))) AS missing_evidence_count,
    ( SELECT count(*) AS count
           FROM attachments a
          WHERE a.task_id = t.id) AS attachment_count,
    ( SELECT count(*) AS count
           FROM task_collaborators c
          WHERE c.task_id = t.id) AS collaborator_count,
    -- Appended, not inserted: `create or replace view` may only add columns at
    -- the end, and putting one in the middle renames every column after it.
    case
      when t.routine_template_id is not null then
        case when rt.evidence_required then 'file' else 'optional' end
      else t.completion_evidence_rule
    end AS completion_evidence_rule,
    t.completion_evidence_instruction,
    -- Evidence of any kind already on this work: a step's proof counts towards
    -- the completion rule, so nobody is asked to upload the same file twice.
    ( SELECT count(*) AS count
           FROM attachments a
          WHERE a.task_id = t.id AND a.is_evidence) AS evidence_count
   FROM tasks t
     LEFT JOIN user_profiles owner ON owner.id = t.primary_owner_id
     LEFT JOIN public.person_display owner_dir ON owner_dir.id = t.primary_owner_id
     LEFT JOIN user_profiles assigner ON assigner.id = t.assigned_by
     LEFT JOIN public.person_display assigner_dir ON assigner_dir.id = t.assigned_by
     LEFT JOIN public.routine_templates rt ON rt.id = t.routine_template_id
  WHERE t.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Enforcement.
-- ---------------------------------------------------------------------------
--
-- Replaced wholesale rather than wrapped, because a rule split across two
-- functions is a rule with two answers.
--
-- Copied from v58, which is where this function currently lives - NOT from the
-- original in `operations.sql`. Replacing a function means replacing the
-- LATEST definition of it: taking the first one found silently reverted v58's
-- completion authority, and the only thing that noticed was an integration
-- test asserting a contributor cannot complete somebody else's work.

CREATE OR REPLACE FUNCTION public.complete_task(p_task_id uuid, p_expected_version integer, p_completion_note text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  evidence_rule text;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to complete work.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select * into task from public.tasks where id = p_task_id for update;
  if not found then return focus.error('not_found', 'This work no longer exists.'); end if;

  if not focus.can_complete_task(p_task_id) then
    return focus.error('not_authorised', 'Only the owner of this work, or their manager, can complete it. Contributors complete their own checklist steps.');
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

  -- v134 — the completion evidence rule, decided when the work was set up.
  --
  -- An occurrence follows its schedule rather than a value copied at
  -- generation, so tightening a weekly inspection applies to the occurrences
  -- already sitting in somebody's list rather than only to future ones.
  evidence_rule := coalesce(task.completion_evidence_rule, 'optional');
  if task.routine_template_id is not null then
    select case when rt.evidence_required then 'file' else 'optional' end
      into evidence_rule
      from public.routine_templates rt
     where rt.id = task.routine_template_id;
    evidence_rule := coalesce(evidence_rule, 'optional');
  end if;

  -- Evidence already on the work counts, wherever it arrived: a step's proof
  -- is proof. Demanding a fresh upload when the measurement sheet is already
  -- attached is how a rule teaches people to attach junk.
  if evidence_rule in ('file', 'file_or_note') then
    if not exists (
         select 1 from public.attachments a
          where a.task_id = p_task_id and a.is_evidence
       )
       and not (
         evidence_rule = 'file_or_note'
         and coalesce(btrim(p_completion_note), '') <> ''
       )
    then
      return focus.error(
        'evidence_missing',
        case evidence_rule
          when 'file' then 'This work needs a file attached before it can be completed.'
          else 'This work needs a file attached, or a note describing the result.'
        end,
        jsonb_build_object(
          'incomplete_items', '[]'::jsonb,
          'missing_evidence', to_jsonb(array[
            case evidence_rule
              when 'file' then 'a file is required to complete this work'
              else 'a file or a completion note is required'
            end
          ]))
      );
    end if;
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
$function$;

-- ---------------------------------------------------------------------------
-- Carrying the rule from New Work to the task it creates.
-- ---------------------------------------------------------------------------
--
-- A capture is a draft that `confirm_work_capture` turns into a task, so the
-- rule has to survive that hop. Stored on the draft rather than passed as a
-- parameter because the draft is what the attachments already hang off: one
-- record describing one intended piece of work.
--
-- Before the function, necessarily: it declares `capture` as a
-- `work_captures%rowtype`, which is resolved when the function is created.

alter table public.work_captures
  add column if not exists completion_evidence_rule text not null default 'optional',
  add column if not exists completion_evidence_instruction text;

alter table public.work_captures
  drop constraint if exists work_captures_completion_evidence_rule_known;
alter table public.work_captures
  add constraint work_captures_completion_evidence_rule_known
  check (completion_evidence_rule in ('optional', 'file_or_note', 'file'));

-- Replaced to carry the two new columns onto the task. Copied from v61, the
-- latest definition, which carries the Major Project proposal payload - taking
-- the original would have dropped `success_measure` from every proposal a
-- manager reads.

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
      p_event_type := case when exceeds_target then 'over_target_activation' else 'task_activated' end,
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
