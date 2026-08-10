-- ---------------------------------------------------------------------------
-- v45 Part B — editing and removing a checklist step.
--
-- Until now a step was immutable once written. A typo, the wrong person, a due
-- date that moved: each meant deleting the step and writing it again, which
-- discarded its evidence and its history — or, far more often, simply did not
-- happen, and the checklist drifted quietly away from the work it describes.
--
-- Two authorities have to stay apart, and the RLS policy on this table cannot
-- tell them apart on its own:
--
--   completing a step        the assignee's right    (unchanged)
--   changing what the step   the owner's, or their   (enforced below)
--   IS                       manager's, right
--
-- A policy sees either the old row or the new one, never both, so it cannot
-- express "you may update this row but not those columns". A BEFORE UPDATE
-- trigger can, and it guards every route into the table: this function, any
-- future one, and anything a client with a valid session writes directly.
-- ---------------------------------------------------------------------------

create or replace function focus.guard_checklist_structure()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Migrations and seeding run with no session user. There is no one to
  -- authorise, and no UI involved.
  if auth.uid() is null then
    return new;
  end if;

  if (new.action, new.assigned_to, new.evidence_rule, new.due_at,
      new.depends_on_item_id, new.position)
     is distinct from
     (old.action, old.assigned_to, old.evidence_rule, old.due_at,
      old.depends_on_item_id, old.position)
     and not focus.can_edit_task(new.task_id)
  then
    raise exception 'not_authorised: changing a checklist step requires edit rights on the task'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists task_checklist_items_guard_structure on public.task_checklist_items;
create trigger task_checklist_items_guard_structure
  before update on public.task_checklist_items
  for each row execute function focus.guard_checklist_structure();

-- ---------------------------------------------------------------------------
-- Edit a step (§16-22).
--
-- The caller sends the whole intended step, not a patch, because the edit
-- drawer shows the whole step. A null due date or prerequisite therefore means
-- "cleared", which is unambiguous — a patch API would have to distinguish
-- "unchanged" from "cleared" with a second flag per field, and callers get
-- that wrong.
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

revoke all on function public.update_checklist_step(
  uuid, text, uuid, public.evidence_rule, timestamptz, uuid, text) from public, anon;
grant execute on function public.update_checklist_step(
  uuid, text, uuid, public.evidence_rule, timestamptz, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Remove a step (§23).
--
-- Deleting is the one checklist action that destroys evidence of work, so it
-- refuses in exactly the cases where something would be lost silently.
-- ---------------------------------------------------------------------------

create or replace function public.remove_checklist_step(
  p_item_id uuid,
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
  dependants integer;
  attachments integer;
  replayed jsonb;
  result jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to remove this step.');
  end if;

  if p_idempotency_key is not null then
    replayed := focus.replay_operation(actor, p_idempotency_key);
    if replayed is not null then return replayed; end if;
  end if;

  select * into item from public.task_checklist_items where id = p_item_id for update;
  if not found then
    -- Already gone. Say so as a success: the caller wanted it absent, it is.
    result := jsonb_build_object('ok', true, 'code', 'checklist_step_removed',
                                 'item_id', p_item_id);
    return focus.remember_operation(actor, p_idempotency_key, 'remove_checklist_step', result);
  end if;

  if not focus.can_edit_task(item.task_id) then
    return focus.error('not_authorised',
      'Only the owner of this work, or their manager, can remove its steps.');
  end if;

  if item.state = 'completed' then
    return focus.error('invalid_state',
      'This step is already complete. Completed work stays on the record.');
  end if;

  select count(*) into attachments
    from public.attachments where checklist_item_id = p_item_id;
  if attachments > 0 then
    return focus.error('invalid_state',
      'This step has evidence attached. Detach it first if the step is genuinely not needed.');
  end if;

  -- `on delete set null` would silently release every step waiting on this one
  -- and nobody would be told that their prerequisite had evaporated.
  select count(*) into dependants
    from public.task_checklist_items
   where depends_on_item_id = p_item_id;
  if dependants > 0 then
    return focus.error('invalid_state',
      format('%s other step(s) are waiting for this one. Repoint them before removing it.',
             dependants));
  end if;

  perform focus.write_audit(
    p_event_type := 'checklist_item_removed',
    p_actor_id := actor,
    p_task_id := item.task_id,
    p_subject_user_id := item.assigned_to,
    p_detail := jsonb_build_object(
      'checklist_item_id', p_item_id,
      'action', item.action,
      'assigned_to', item.assigned_to,
      'state', item.state));

  -- The person who had it on their Shared list learns it is gone, and why it
  -- vanished — otherwise the row simply disappears overnight.
  if item.assigned_to is not null and item.assigned_to <> actor then
    perform focus.notify(
      item.assigned_to,
      'collaboration_handoff', 'digest', false,
      'Contribution removed',
      format('"%s" was removed from the checklist. It is no longer on your Shared list.',
             item.action),
      item.task_id, null, actor);
  end if;

  delete from public.task_checklist_items where id = p_item_id;

  perform focus.recalculate_checklist_readiness(item.task_id);

  result := jsonb_build_object('ok', true, 'code', 'checklist_step_removed',
                               'item_id', p_item_id);
  return focus.remember_operation(actor, p_idempotency_key, 'remove_checklist_step', result);
end;
$$;

revoke all on function public.remove_checklist_step(uuid, text) from public, anon;
grant execute on function public.remove_checklist_step(uuid, text) to authenticated;
