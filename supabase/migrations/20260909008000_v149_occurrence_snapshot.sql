-- ============================================================================
-- v149 — an occurrence keeps the requirements it was generated with
--
-- Manager and Employee Change Specification §14.
--
-- Three things, all from the same mistake: reading a schedule to describe an
-- event that already happened.
--
-- 1. THE SNAPSHOT. `task_overview` computed a routine occurrence's evidence
--    rule live from its template — `case when rt.evidence_required then 'file'
--    else 'optional' end`. So tightening a weekly walk today changed what LAST
--    MONTH'S completed occurrence claims it required, and the record stopped
--    describing the rule the person actually worked to. §14: "Do not silently
--    rewrite completed occurrence instructions, due dates, evidence
--    requirements or results. Snapshot the applicable completion
--    requirements."
--
--    The occurrence carries its own rule and instruction now, copied when it
--    is generated. Template changes reach future occurrences, which is what
--    "affect future occurrences according to existing schedule rules" means.
--
-- 2. THE WINDOW. §14: "Upcoming visibility does not automatically authorize
--    premature completion; preserve the template's allowed completion window."
--    There was no window. Upcoming exists so people can plan, and it also let
--    somebody sign off an inspection scheduled for next month.
--
--    `completion_opens_days_before` defaults to 0, which reads as "from the
--    occurrence date". A schedule that genuinely allows early work — a monthly
--    report that can be written in the last week — sets it higher.
--
-- 3. THE AREA. §14 lists "area where recorded" in the occurrence detail, and
--    §6 requires repeated routine titles to carry it alongside the date. Three
--    rows reading "Weekly workplace safety walk · 19 Aug" are still ambiguous
--    across two production halls.
--
-- All three are inherited by one trigger rather than by the generator, for the
-- reason v145 gave about purpose: occurrences are created by the scheduled run
-- AND by the catch-up when a recurrence changes, and a rule living in one of
-- them is a rule the other forgets.
-- ============================================================================

alter table public.routine_templates
  add column if not exists area text,
  add column if not exists completion_opens_days_before smallint not null default 0;

alter table public.routine_templates
  drop constraint if exists routine_templates_completion_window_sane;
alter table public.routine_templates
  add constraint routine_templates_completion_window_sane
  check (completion_opens_days_before between 0 and 90);

comment on column public.routine_templates.area is
  'Section 14. Where the work is recorded — a hall, a line, a site. Null where '
  'the schedule covers one place and naming it would be noise.';
comment on column public.routine_templates.completion_opens_days_before is
  'Section 14. How many days before its date an occurrence may be completed. '
  '0 means from the date itself.';

alter table public.tasks
  add column if not exists routine_area text,
  add column if not exists routine_completion_opens_on date;

comment on column public.tasks.routine_completion_opens_on is
  'Section 14. Snapshotted when the occurrence is generated, so a later '
  'template edit cannot move the date on work already done.';

-- ----------------------------------------------------------------------------
-- One trigger for everything an occurrence inherits.
--
-- This replaces v145's purpose-only version. Nothing is overwritten: each
-- field is filled only where the row does not already carry one, so a caller
-- that supplied a value keeps it and a re-run changes nothing.
-- ----------------------------------------------------------------------------

create or replace function focus.inherit_routine_template_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  template public.routine_templates;
begin
  if new.routine_template_id is null then
    return new;
  end if;

  select * into template from public.routine_templates where id = new.routine_template_id;
  if not found then
    return new;
  end if;

  if new.work_purpose is null then
    new.work_purpose := template.work_purpose;
  end if;

  if new.routine_area is null then
    new.routine_area := template.area;
  end if;

  /*
   * The evidence rule, snapshotted.
   *
   * `evidence_required` is the template's boolean; the occurrence records the
   * three-valued rule the rest of the product speaks. Only set while the row
   * still carries the column default, because an occurrence created with an
   * explicit rule has already been told what it needs.
   */
  if coalesce(new.completion_evidence_rule, 'optional') = 'optional' then
    new.completion_evidence_rule :=
      case when template.evidence_required then 'file' else 'optional' end;
  end if;

  if new.completion_evidence_instruction is null then
    new.completion_evidence_instruction := template.evidence_instruction;
  end if;

  if new.routine_completion_opens_on is null and new.occurrence_date is not null then
    new.routine_completion_opens_on :=
      new.occurrence_date - coalesce(template.completion_opens_days_before, 0);
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_inherit_routine_work_purpose on public.tasks;
drop trigger if exists tasks_inherit_routine_template_fields on public.tasks;
create trigger tasks_inherit_routine_template_fields
  before insert on public.tasks
  for each row execute function focus.inherit_routine_template_fields();

drop function if exists focus.inherit_routine_work_purpose();

-- ----------------------------------------------------------------------------
-- Existing occurrences take the snapshot they should always have had.
--
-- From their own template, which is the only source there is. It is the same
-- answer the view was computing live a moment ago, so nothing on screen
-- changes today; what changes is that tomorrow's template edit no longer
-- rewrites it.
-- ----------------------------------------------------------------------------

update public.tasks t
   set completion_evidence_rule =
         case when rt.evidence_required then 'file' else 'optional' end,
       completion_evidence_instruction =
         coalesce(t.completion_evidence_instruction, rt.evidence_instruction),
       routine_area = coalesce(t.routine_area, rt.area),
       routine_completion_opens_on =
         coalesce(t.routine_completion_opens_on,
                  t.occurrence_date - coalesce(rt.completion_opens_days_before, 0))
  from public.routine_templates rt
 where rt.id = t.routine_template_id
   and t.work_class = 'routine_occurrence';

-- ----------------------------------------------------------------------------
-- The view stops asking the schedule what a past event required.
--
-- `completion_evidence_rule` and `completion_evidence_instruction` keep their
-- positions and now read the occurrence's own columns; the two new ones are
-- appended, because `create or replace view` may only add at the end.
-- ----------------------------------------------------------------------------

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
    -- v149 §14 — the occurrence's own, not the schedule's current opinion.
    t.completion_evidence_rule,
    t.completion_evidence_instruction,
    ( SELECT count(*) AS count
           FROM attachments a
          WHERE a.task_id = t.id AND a.is_evidence) AS evidence_count,
    t.work_purpose,
    t.routine_area,
    t.routine_completion_opens_on
   FROM tasks t
     LEFT JOIN user_profiles owner ON owner.id = t.primary_owner_id
     LEFT JOIN public.person_display owner_dir ON owner_dir.id = t.primary_owner_id
     LEFT JOIN user_profiles assigner ON assigner.id = t.assigned_by
     LEFT JOIN public.person_display assigner_dir ON assigner_dir.id = t.assigned_by
  WHERE t.deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- Completion refuses to run ahead of the schedule.
--
-- Replacing the LATEST definition, which is v134's, with one check added and
-- nothing else touched.
-- ----------------------------------------------------------------------------

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

  /*
   * v149 section 14 - being able to SEE an occurrence is not permission to
   * tick it.
   *
   * The Upcoming tab lists future occurrences so somebody can plan around
   * them. Without this it also let them sign off next month's inspection
   * today, and the record would say a walk happened on a date nobody walked
   * anything. The window belongs to the schedule, and
   * `routine_completion_opens_on` is snapshotted when the occurrence is
   * generated, so a later template edit cannot move the date on work already
   * done or already in progress.
   */
  if task.routine_completion_opens_on is not null
     and focus.local_today() < task.routine_completion_opens_on then
    return focus.error(
      'too_early',
      format('This occurrence cannot be completed before %s.',
             to_char(task.routine_completion_opens_on, 'FMDD Mon YYYY')),
      jsonb_build_object('opens_on', task.routine_completion_opens_on));
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
