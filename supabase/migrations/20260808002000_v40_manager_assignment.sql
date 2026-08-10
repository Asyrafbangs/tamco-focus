-- ---------------------------------------------------------------------------
-- v40 sections 3 and 6 — manager assignment.
--
-- A manager directs work; the employee decides when to carry it. So an
-- assignment lands in `backlog` (shown as Available) and NOT in `active`. This
-- is the whole point: if assignment could set `active`, a manager would be
-- silently spending someone else's 1 / 5 / 1 focus budget, and the employee
-- would lose the only decision the focus model gives them.
--
-- The one exception is mandatory urgent controlled work, which activates
-- immediately by design — and which this procedure deliberately does not
-- create. That path already exists through Capture Work, behind the explicit
-- controlled-action question, and it should stay behind it.
--
-- Multi-person assignment creates INDEPENDENT tasks (section 6). One row per
-- person, each with its own state, progress, due date, evidence and audit
-- trail, sharing only `assignment_batch_id` so the instruction can be traced.
-- They are not one task with several owners: every person separately owes the
-- complete result, and a shared record could not represent that.
-- ---------------------------------------------------------------------------

alter table public.work_captures
  add column if not exists classification_rule_code text,
  add column if not exists classification_rule_text text;

comment on column public.work_captures.classification_rule_code is
  'The deterministic rule that produced the recommendation, kept with the '
  'capture even if the task is never created.';

create or replace function public.assign_work_to_people(
  p_title text,
  p_description text,
  p_work_class public.work_class,
  p_owner_ids uuid[],
  p_urgency public.urgency_level default 'normal',
  p_due_at timestamptz default null,
  p_due_is_date_only boolean default true,
  p_review_at timestamptz default null,
  p_idempotency_key text default null
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

  select * into actor_profile from public.user_profiles where id = actor;
  if not found or actor_profile.status <> 'active' then
    return focus.error('not_authorised', 'Your account cannot assign work.');
  end if;

  -- Assignment is a management act. Section 3.4 keeps VIEW and EDIT authority
  -- apart, and this is squarely EDIT.
  if actor_profile.role not in ('manager', 'administrator') then
    return focus.error('not_authorised', 'Only a manager or administrator can assign work.');
  end if;

  if length(btrim(coalesce(p_title, ''))) = 0 then
    return focus.error('validation_failed', 'Give the work a title.');
  end if;

  if p_owner_ids is null or array_length(p_owner_ids, 1) is null then
    return focus.error('validation_failed', 'Choose at least one person to assign this to.');
  end if;

  if array_length(p_owner_ids, 1) > 25 then
    return focus.error('validation_failed', 'Assign to 25 people or fewer at a time.');
  end if;

  -- Routine work comes from an approved template, and a quick action is
  -- somebody's own same-day errand. Neither is assignable this way.
  if p_work_class not in ('operational_action', 'major_project', 'self_development') then
    return focus.error('validation_failed',
      'Assign an Operational Action, Major Project or Self-Development item.');
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
      status, work_class, focus_bucket, origin, urgency,
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
  timestamptz, boolean, timestamptz, text) from public, anon;

grant execute on function public.assign_work_to_people(
  text, text, public.work_class, uuid[], public.urgency_level,
  timestamptz, boolean, timestamptz, text) to authenticated;
