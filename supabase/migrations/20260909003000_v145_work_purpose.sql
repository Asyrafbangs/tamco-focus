-- ============================================================================
-- v145 — why a piece of work exists, in plain language
--
-- Manager and Employee Change Specification §11.
--
-- The product classified work as Major Project / Operational Action /
-- Self-Development. Those are shapes and sizes; none of them answers the
-- question a manager and an employee actually discuss, which is why this work
-- is happening at all. §11 replaces the prominent classification with three
-- plain-language purposes:
--
--   Reactive work              responding to an incident, breakdown or an
--                              unexpected problem
--   Planned operations         keeping existing responsibilities running —
--                              planned inspections, reporting, training
--   Improvement & development  improving controls, systems, or individual and
--                              team capability
--
-- "Reactive work" and not "Firefighting", because at TAMCO firefighting also
-- means actual emergency response. Not Q1/Q2 either: planned operations can be
-- important and unhurried, improvement work can turn urgent, and urgency is a
-- separate flag that already exists on the row.
--
-- ADDITIVE, as §11 requires. `work_class` and `focus_bucket` keep every value
-- they have and every feature that depends on them — goals, proposals,
-- routines, reporting — continues to read them. Purpose is a new, independent
-- axis alongside lifecycle status (Available / Active / Completed) and
-- involvement (owned / shared).
--
-- The backfill is deliberately small. §11: "Do not blindly map every old
-- Operational Action to Planned operations: some are reactive", and do not
-- guess from titles. Two mappings are safe by definition and nothing else is:
--
--   * Self-development work IS capability improvement.
--   * A routine occurrence exists because a schedule says so, which is what
--     "keeping existing responsibilities running" means.
--
-- Everything else stays null and shows as not recorded, which is a true
-- statement about an old row rather than a guess presented as a fact.
-- ============================================================================

create type public.work_purpose as enum (
  'reactive',
  'planned_operations',
  'improvement_development'
);

comment on type public.work_purpose is
  'Why work exists (specification section 11). Independent of work_class, of '
  'lifecycle status and of urgency.';

alter table public.tasks add column if not exists work_purpose public.work_purpose;
alter table public.routine_templates add column if not exists work_purpose public.work_purpose;
alter table public.work_captures add column if not exists work_purpose public.work_purpose;

comment on column public.tasks.work_purpose is
  'Section 11. Null means nobody has recorded one yet — shown as not recorded '
  'rather than guessed.';

-- Filtering "what has not been classified" over a large task table.
create index if not exists tasks_work_purpose_unset_idx
  on public.tasks (primary_owner_id)
  where work_purpose is null and deleted_at is null;

-- ----------------------------------------------------------------------------
-- The two unambiguous backfills.
-- ----------------------------------------------------------------------------

-- A routine template exists because something has to happen on a schedule.
-- That is what "keeping existing responsibilities running" means, and it is
-- true of every template in the system regardless of what it inspects.
update public.routine_templates
   set work_purpose = 'planned_operations'
 where work_purpose is null;

update public.tasks
   set work_purpose = 'improvement_development'
 where work_purpose is null
   and focus_bucket = 'self_development';

update public.tasks
   set work_purpose = 'planned_operations'
 where work_purpose is null
   and work_class = 'routine_occurrence';

-- ----------------------------------------------------------------------------
-- A routine occurrence inherits its template's purpose (§11).
--
-- On the row rather than in the generator, because occurrences are created in
-- more than one place — the scheduled generator, and the catch-up run when a
-- template's recurrence changes — and a rule that lives in one of them is a
-- rule the other can forget.
-- ----------------------------------------------------------------------------

create or replace function focus.inherit_routine_work_purpose()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.work_purpose is null and new.routine_template_id is not null then
    select rt.work_purpose into new.work_purpose
      from public.routine_templates rt
     where rt.id = new.routine_template_id;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_inherit_routine_work_purpose on public.tasks;
create trigger tasks_inherit_routine_work_purpose
  before insert on public.tasks
  for each row execute function focus.inherit_routine_work_purpose();

-- ----------------------------------------------------------------------------
-- Work captured by the person doing it carries its purpose to the task.
--
-- `confirm_work_capture` is not touched. It has four generations across four
-- migrations and copying the newest one to add a single assignment is how a
-- previous fix silently reverted an older one. The capture already records the
-- task it became, so the copy happens when that link is made.
-- ----------------------------------------------------------------------------

create or replace function focus.apply_capture_work_purpose()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_task_id is not null
     and new.work_purpose is not null
     and new.created_task_id is distinct from old.created_task_id then
    update public.tasks
       set work_purpose = new.work_purpose
     where id = new.created_task_id
       and work_purpose is null;
  end if;
  return new;
end;
$$;

drop trigger if exists work_captures_apply_work_purpose on public.work_captures;
create trigger work_captures_apply_work_purpose
  after update of created_task_id on public.work_captures
  for each row execute function focus.apply_capture_work_purpose();

-- ----------------------------------------------------------------------------
-- Recording or changing a purpose.
--
-- Anybody who may edit the work may classify it: §11 says defaults "must
-- remain visible and editable by permitted users", and the person doing the
-- work is usually the one who knows whether it was reactive.
--
-- Null is accepted, and means "not recorded". A classification chosen by
-- mistake should be removable rather than replaced by a second guess.
-- ----------------------------------------------------------------------------

create or replace function public.set_work_purpose(
  p_task_id uuid,
  p_purpose public.work_purpose,
  p_expected_version integer default null,
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
  replayed jsonb;
  result jsonb;
  event_id uuid;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to classify work.');
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
      'You can view this work but you are not authorised to change how it is classified.');
  end if;

  if p_expected_version is not null and task.version <> p_expected_version then
    return focus.error('version_conflict',
      'This task was updated by another user. Review the latest information before continuing.',
      jsonb_build_object('current_version', task.version));
  end if;

  if task.work_purpose is not distinct from p_purpose then
    return jsonb_build_object(
      'ok', true, 'code', 'unchanged', 'task', focus.task_snapshot(p_task_id));
  end if;

  update public.tasks
     set work_purpose = p_purpose,
         version = version + 1
   where id = p_task_id;

  /*
   * The version moves; `last_meaningful_update_at` does not.
   *
   * Saying what kind of work something is is not progress on it, and a task
   * that has stalled for six weeks must not look freshly updated because
   * somebody classified it during a tidy-up.
   */
  event_id := focus.write_audit(
    p_event_type := 'work_purpose_set'::public.audit_event_type,
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'from', task.work_purpose,
      'to', p_purpose)
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'work_purpose_set',
    'task', focus.task_snapshot(p_task_id),
    'audit_event_id', event_id
  );

  return focus.remember_operation(actor, p_idempotency_key, 'set_work_purpose', result);
end;
$$;

revoke all on function public.set_work_purpose(uuid, public.work_purpose, integer, text)
  from public, anon;
grant execute on function public.set_work_purpose(uuid, public.work_purpose, integer, text)
  to authenticated;

-- ----------------------------------------------------------------------------
-- Assignment asks for it.
--
-- Dropped and recreated rather than overloaded: `create or replace` with an
-- extra defaulted parameter makes a SECOND function, and a nine-argument call
-- would then match both and be rejected as ambiguous. The new parameter has a
-- default and the same name-based call from the previously deployed client
-- still resolves, so there is no window where assignment is broken.
-- ----------------------------------------------------------------------------

drop function if exists public.assign_work_to_people(
  text, text, public.work_class, uuid[], public.urgency_level,
  timestamptz, boolean, timestamptz, text);

create or replace function public.assign_work_to_people(
  p_title text,
  p_description text,
  p_work_class public.work_class,
  p_owner_ids uuid[],
  p_urgency public.urgency_level default 'normal',
  p_due_at timestamptz default null,
  p_due_is_date_only boolean default true,
  p_review_at timestamptz default null,
  p_idempotency_key text default null,
  p_work_purpose public.work_purpose default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := focus.current_user_id();
  actor_profile public.user_profiles;
  target_owner uuid;
  owner_profile public.user_profiles;
  batch_id uuid := extensions.gen_random_uuid();
  new_task_id uuid;
  created_ids uuid[] := '{}';
  task_bucket public.focus_bucket;
  replayed jsonb;
  result jsonb;
begin
  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then
      return replayed;
    end if;
  end if;

  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to assign work.');
  end if;

  select * into actor_profile from public.user_profiles where id = actor;
  if not found or actor_profile.role not in ('manager', 'administrator') then
    return focus.error('not_authorised', 'Only a manager can assign work to somebody else.');
  end if;

  if length(btrim(coalesce(p_title, ''))) = 0 then
    return focus.error('validation_failed', 'Give the work a title.');
  end if;

  if p_owner_ids is null or array_length(p_owner_ids, 1) is null then
    return focus.error('validation_failed', 'Choose at least one person.');
  end if;

  task_bucket := case p_work_class
    when 'major_project' then 'major'::public.focus_bucket
    when 'self_development' then 'self_development'::public.focus_bucket
    else 'operational'::public.focus_bucket
  end;

  foreach target_owner in array p_owner_ids loop
    select * into owner_profile from public.user_profiles where id = target_owner;
    if not found or owner_profile.status <> 'active' then
      return focus.error('validation_failed', 'One of the selected people is not an active user.');
    end if;

    -- You may only assign to somebody you are authorised to see. Without this,
    -- assignment would be a way to write into a reporting line you cannot read.
    if not focus.can_view_user(target_owner) then
      return focus.error('not_authorised',
        'You can only assign work to people your visibility settings cover.');
    end if;

    insert into public.tasks (
      title, description, next_action,
      status, work_class, focus_bucket, work_purpose, origin, urgency,
      primary_owner_id, created_by, assigned_by, assignment_batch_id,
      due_at, due_is_date_only, review_at,
      classification_rule_code, classification_rule_text
    ) values (
      btrim(p_title),
      nullif(btrim(coalesce(p_description, '')), ''),
      -- v41 section 11: no fabricated next action. Assigned work in Available
      -- has not been started, so there is genuinely nothing to do next yet.
      null,
      -- The critical line. Assigned work waits in Available.
      'backlog',
      p_work_class,
      task_bucket,
      -- §11 — asked for at registration. Null is still permitted: an old
      -- client that does not send one creates work that reads as unclassified
      -- rather than work that silently claims to be planned operations.
      p_work_purpose,
      'manager_assigned',
      coalesce(p_urgency, 'normal'),
      target_owner,
      actor,
      actor,
      batch_id,
      p_due_at,
      coalesce(p_due_is_date_only, true),
      p_review_at,
      'manager_assigned',
      format('%s assigned this work and selected the type, urgency and dates.',
             actor_profile.full_name)
    )
    returning id into new_task_id;

    created_ids := created_ids || new_task_id;

    perform focus.write_audit(
      p_event_type := 'task_created',
      p_actor_id := actor,
      p_task_id := new_task_id,
      p_detail := jsonb_build_object(
        'assignment_batch_id', batch_id,
        'assigned_by', actor,
        'primary_owner_id', target_owner,
        'work_class', p_work_class,
        'work_purpose', p_work_purpose,
        'status', 'backlog',
        'independent_record', true,
        'classification_rule_code', 'manager_assigned'));

    perform focus.notify(
      target_owner, 'ordinary_assignment', 'immediate', true,
      'New work assigned to you',
      format('%s assigned "%s". It is waiting in Available until you activate it.',
             actor_profile.full_name, btrim(p_title)),
      new_task_id, null, actor);
  end loop;

  result := jsonb_build_object(
    'ok', true,
    'code', 'work_assigned',
    'assignment_batch_id', batch_id,
    'task_ids', to_jsonb(created_ids),
    'created_count', coalesce(array_length(created_ids, 1), 0));

  return focus.remember_operation(actor, p_idempotency_key, 'assign_work_to_people', result);
end;
$$;

revoke all on function public.assign_work_to_people(
  text, text, public.work_class, uuid[], public.urgency_level,
  timestamptz, boolean, timestamptz, text, public.work_purpose) from public, anon;

grant execute on function public.assign_work_to_people(
  text, text, public.work_class, uuid[], public.urgency_level,
  timestamptz, boolean, timestamptz, text, public.work_purpose) to authenticated;

-- ----------------------------------------------------------------------------
-- The view every list reads.
--
-- Appended, not inserted: `create or replace view` may only add columns at the
-- end, and putting one in the middle renames every column after it.
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
          WHERE a.task_id = t.id AND a.is_evidence) AS evidence_count,
    -- v145 §11 — why this work exists, independent of what shape it is.
    t.work_purpose
   FROM tasks t
     LEFT JOIN user_profiles owner ON owner.id = t.primary_owner_id
     LEFT JOIN public.person_display owner_dir ON owner_dir.id = t.primary_owner_id
     LEFT JOIN user_profiles assigner ON assigner.id = t.assigned_by
     LEFT JOIN public.person_display assigner_dir ON assigner_dir.id = t.assigned_by
     LEFT JOIN public.routine_templates rt ON rt.id = t.routine_template_id
  WHERE t.deleted_at IS NULL;
