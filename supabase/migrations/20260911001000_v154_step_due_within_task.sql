-- ============================================================================
-- v154 - Trackable Steps, stage 1: a step's date holds
--
-- The Product Owner's model (11 September 2026): a Step stays a child of its
-- task, but once it is somebody's it is trackable - assignee, due date,
-- status, evidence, completion history - and it must never be due after the
-- task it is part of.
--
-- Most of that already existed. `task_checklist_items.due_at` has been there
-- since the first migration, and NULL has always meant "the same as the task":
-- nothing stores a copy of the parent's date, so an inherited step moves with
-- its task by construction. That is the Product Owner's `due_mode = inherited`,
-- and it needs no second column to keep in sync. A non-null date is `custom`,
-- and stays put when the task moves.
--
-- What did not exist is the rule. A step could be given 20 September on a task
-- due the 16th, and a task could be moved to the 8th past a step due the 10th.
-- Both are planning that cannot be true, and nothing said so.
--
-- One rule, in one function, applied in three places:
--
--   the trigger on task_checklist_items   every writer, including Add step,
--                                         which inserts under RLS rather
--                                         than through a procedure
--   update_checklist_step                 asks first, for a sentence instead
--                                         of an exception
--   change_task_due_date                  the task side: refuses to move the
--                                         work earlier than an open step's
--                                         own date, and names the step. The
--                                         Monthly Plan's drag goes through it.
--
-- Dates are compared as organisation-local days. A step due on the 16th is not
-- after a task due at 14:30 on the 16th: a step's date is a day, not an
-- instant, and treating the end of that day as later than half past two would
-- refuse the most ordinary case there is.
--
-- A completed step never blocks: it is a record of what happened, not a plan.
-- Existing rows are not rewritten. A step that already breaks the rule stays as
-- it is until someone next moves it or its task, and is then named.
-- ============================================================================

create or replace function focus.step_due_after_task(p_task_id uuid, p_due_at timestamptz)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select format(
           'A step cannot be due after the task it is part of, which is due %s. '
           'Choose an earlier date for the step, or move the task''s deadline first.',
           to_char(t.due_at at time zone focus.org_time_zone(), 'FMDD Mon YYYY'))
    from public.tasks t
   where t.id = p_task_id
     and p_due_at is not null
     and t.due_at is not null
     and (p_due_at at time zone focus.org_time_zone())::date
         > (t.due_at at time zone focus.org_time_zone())::date;
$$;

comment on function focus.step_due_after_task(uuid, timestamptz) is
  'Why a step may not have this date, or NULL when it may. The one statement of the rule.';

create or replace function focus.guard_step_due_within_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conflict text;
begin
  if new.state = 'completed' then
    return new;
  end if;

  conflict := focus.step_due_after_task(new.task_id, new.due_at);
  if conflict is not null then
    -- The hint marks this as a sentence for the person. Everything else a
    -- database error says is detail the application must not repeat.
    raise exception using
      errcode = 'check_violation',
      message = conflict,
      hint = 'step_due_after_task',
      constraint = 'task_checklist_items_due_within_task';
  end if;

  return new;
end;
$$;

revoke all on function focus.step_due_after_task(uuid, timestamptz) from public;
revoke all on function focus.guard_step_due_within_task() from public;

drop trigger if exists task_checklist_items_due_within_task on public.task_checklist_items;
create trigger task_checklist_items_due_within_task
  before insert or update of due_at, task_id on public.task_checklist_items
  for each row execute function focus.guard_step_due_within_task();

-- ---------------------------------------------------------------------------
-- The two procedures, reproduced from their latest definitions with the check
-- added and nothing else changed:
--   update_checklist_step  from 20260808009100_v45_checklist_step_mutations.sql
--   change_task_due_date   from 20260807001100_task_detail_clarity_v38.sql
-- ---------------------------------------------------------------------------

create or replace function public.update_checklist_step(
  p_item_id uuid,
  p_action text,
  p_assigned_to uuid,
  p_evidence_rule public.evidence_rule,
  p_due_at timestamptz,
  p_depends_on_item_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  item public.task_checklist_items;
  assignee public.user_profiles;
  prerequisite public.task_checklist_items;
  cursor_id uuid;
  hops integer := 0;
  changes jsonb := '{}'::jsonb;
  replayed jsonb;
  result jsonb;
  conflict text;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change this step.');
  end if;

  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then return replayed; end if;
  end if;

  select * into item from public.task_checklist_items where id = p_item_id for update;
  if not found then
    return focus.error('not_found', 'That step no longer exists.');
  end if;

  if not focus.can_edit_task(item.task_id) then
    return focus.error('not_authorised',
      'Only the owner of this work, or their manager, can change its steps.');
  end if;

  -- A completed step is a record of something that happened. Rewriting who did
  -- it, or what it required, would make the record say something that is not
  -- true. Reopening is the honest route, and it is one click away.
  if item.state = 'completed' then
    return focus.error('invalid_state',
      'This step is already complete. Reopen it first if it needs to change.');
  end if;

  if length(btrim(coalesce(p_action, ''))) = 0 then
    return focus.error('validation_failed', 'Describe what needs to be done.');
  end if;

  if length(btrim(p_action)) > 300 then
    return focus.error('validation_failed', 'Keep the step under 300 characters.');
  end if;

  if p_assigned_to is null then
    return focus.error('validation_failed', 'Choose who is responsible for this step.');
  end if;

  select * into assignee from public.user_profiles where id = p_assigned_to;
  if not found or assignee.status <> 'active' then
    return focus.error('validation_failed', 'That person is not an active team member.');
  end if;

  if p_depends_on_item_id is not null then
    if p_depends_on_item_id = p_item_id then
      return focus.error('validation_failed', 'A step cannot wait for itself.');
    end if;

    select * into prerequisite
      from public.task_checklist_items
     where id = p_depends_on_item_id;

    if not found or prerequisite.task_id <> item.task_id then
      return focus.error('validation_failed',
        'The prerequisite must be another step on this same work.');
    end if;

    -- Two steps each waiting for the other are both permanently unstartable,
    -- and nothing downstream would report why. Walk the chain before allowing
    -- the link rather than discovering the deadlock in the readiness pass.
    cursor_id := p_depends_on_item_id;
    while cursor_id is not null and hops < 64 loop
      if cursor_id = p_item_id then
        return focus.error('validation_failed',
          'That would make two steps wait for each other. Neither could ever start.');
      end if;
      select depends_on_item_id into cursor_id
        from public.task_checklist_items where id = cursor_id;
      hops := hops + 1;
    end loop;
  end if;

  -- v154 - a step is not due after the work it is part of. The trigger on the
  -- table refuses the same thing; asking here first returns a sentence the
  -- person can act on instead of an exception.
  conflict := focus.step_due_after_task(item.task_id, p_due_at);
  if conflict is not null then
    return focus.error('validation_failed', conflict);
  end if;

  -- The audit records the fields that actually moved. An event listing every
  -- field on every save is unreadable, and reviewing it is the whole point.
  if btrim(p_action) is distinct from item.action then
    changes := changes || jsonb_build_object('action',
      jsonb_build_object('from', item.action, 'to', btrim(p_action)));
  end if;
  if p_assigned_to is distinct from item.assigned_to then
    changes := changes || jsonb_build_object('assigned_to',
      jsonb_build_object('from', item.assigned_to, 'to', p_assigned_to));
  end if;
  if p_evidence_rule is distinct from item.evidence_rule then
    changes := changes || jsonb_build_object('evidence_rule',
      jsonb_build_object('from', item.evidence_rule, 'to', p_evidence_rule));
  end if;
  if p_due_at is distinct from item.due_at then
    changes := changes || jsonb_build_object('due_at',
      jsonb_build_object('from', item.due_at, 'to', p_due_at));
  end if;
  if p_depends_on_item_id is distinct from item.depends_on_item_id then
    changes := changes || jsonb_build_object('depends_on_item_id',
      jsonb_build_object('from', item.depends_on_item_id, 'to', p_depends_on_item_id));
  end if;

  if changes = '{}'::jsonb then
    result := jsonb_build_object('ok', true, 'code', 'checklist_step_unchanged',
                                 'item_id', p_item_id, 'changed', changes);
    return focus.remember_operation(actor, p_idempotency_key, 'update_checklist_step', result);
  end if;

  update public.task_checklist_items
     set action = btrim(p_action),
         assigned_to = p_assigned_to,
         evidence_rule = p_evidence_rule,
         due_at = p_due_at,
         depends_on_item_id = p_depends_on_item_id
   where id = p_item_id;

  -- Changing a prerequisite changes what is startable, here and downstream.
  perform focus.recalculate_checklist_readiness(item.task_id);

  perform focus.write_audit(
    p_event_type := 'checklist_item_updated',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_subject_user_id := p_assigned_to,
    p_detail := jsonb_build_object(
      'checklist_item_id', p_item_id,
      'changed', changes));

  result := jsonb_build_object('ok', true, 'code', 'checklist_step_updated',
                               'item_id', p_item_id, 'changed', changes);
  return focus.remember_operation(actor, p_idempotency_key, 'update_checklist_step', result);
end;
$$;

create or replace function public.change_task_due_date(
  p_task_id uuid,
  p_expected_version integer,
  p_new_due_at timestamptz,
  p_due_is_date_only boolean,
  p_reason text default null,
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
  clean_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  event_id uuid;
  result jsonb;
  blocking_step record;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change the due date.');
  end if;

  replayed := focus.replay_operation(actor, p_idempotency_key);
  if replayed is not null then return replayed; end if;

  select id, due_at, due_is_date_only, status, version
    into task
    from public.tasks
   where id = p_task_id
   for update;

  if not found then
    return focus.error('not_found', 'This work no longer exists.');
  end if;
  if not focus.can_edit_task(p_task_id) then
    return focus.error('not_authorised', 'Only an authorised task editor can change the due date.');
  end if;
  if task.status in ('completed', 'cancelled') then
    return focus.error('invalid_state', 'Completed or cancelled work cannot receive a new due date.');
  end if;
  if task.version <> p_expected_version then
    return focus.error('version_conflict', 'This work changed while it was open. Refresh and try again.');
  end if;
  if p_new_due_at is null then
    return focus.error('validation_failed', 'Choose a new due date.');
  end if;

  -- v154 - the work cannot fall due before one of its own open steps. A step
  -- that inherits the task's date moves with it and is never in the way; only
  -- a step given its own date can be, and the person is told which one. This
  -- is also the Monthly Plan's drag, which is exactly where it would be missed.
  select ci.action, ci.due_at
    into blocking_step
    from public.task_checklist_items ci
   where ci.task_id = p_task_id
     and ci.state <> 'completed'
     and ci.due_at is not null
     and (ci.due_at at time zone focus.org_time_zone())::date
         > (p_new_due_at at time zone focus.org_time_zone())::date
   order by ci.due_at desc
   limit 1;
  if found then
    return focus.error('validation_failed', format(
      'The step "%s" is due %s, after that date. Move the step first, or choose a later deadline.',
      blocking_step.action,
      to_char(blocking_step.due_at at time zone focus.org_time_zone(), 'FMDD Mon YYYY')));
  end if;
  if clean_reason is not null and length(clean_reason) > 1000 then
    return focus.error('validation_failed', 'Keep the reason to 1,000 characters or fewer.');
  end if;

  if task.due_at is not distinct from p_new_due_at
     and task.due_is_date_only is not distinct from p_due_is_date_only then
    return jsonb_build_object(
      'ok', true,
      'code', 'due_date_unchanged',
      'due_at', task.due_at,
      'due_is_date_only', task.due_is_date_only,
      'version', task.version,
      'changed', false
    );
  end if;

  update public.tasks
     set due_at = p_new_due_at,
         due_is_date_only = p_due_is_date_only,
         last_meaningful_update_at = now(),
         version = version + 1
   where id = p_task_id;

  event_id := focus.write_audit(
    p_event_type := 'task_due_date_changed',
    p_actor_id := actor,
    p_task_id := p_task_id,
    p_task_version := task.version + 1,
    p_detail := jsonb_build_object(
      'previous_due_at', task.due_at,
      'previous_due_is_date_only', task.due_is_date_only,
      'new_due_at', p_new_due_at,
      'new_due_is_date_only', p_due_is_date_only,
      'reason', clean_reason
    )
  );

  result := jsonb_build_object(
    'ok', true,
    'code', 'task_due_date_changed',
    'due_at', p_new_due_at,
    'due_is_date_only', p_due_is_date_only,
    'version', task.version + 1,
    'audit_event_id', event_id,
    'changed', true
  );
  return focus.remember_operation(actor, p_idempotency_key, 'change_task_due_date', result);
end;
$$;
