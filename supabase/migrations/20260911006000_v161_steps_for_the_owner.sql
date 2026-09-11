-- ============================================================================
-- v161 - Trackable Steps: who is told when a step is the owner's
--
-- v44 and v158 treat "assigned to the work's owner" as "not a contribution",
-- and stop there. Two people were left out:
--
--   the owner    A manager adding a step to Izzah's work for Izzah, or handing
--                one back to her, told her nothing: "assigned, the assignee is
--                told" held only when the assignee was somebody else.
--   the one      A step taken off Amer and given back to the owner, or to
--   it left      nobody, left his Shared list without a word. Only a move to a
--                third person told him.
--
-- The owner is told with "New step on your work", which opens the work at the
-- step (v158's 'task_step'), unless they did it themselves, the system did
-- it, or they have not yet read the assignment of that same work - which
-- already says so, and would otherwise be followed by one notice per step.
-- The previous assignee is told wherever the step went. Audit is unchanged:
-- update_checklist_step already records every edit, and this trigger's own
-- event still covers assignments to somebody other than the owner.
-- ============================================================================

create or replace function focus.notify_step_for_owner(
  p_step public.task_checklist_items,
  p_parent public.tasks,
  p_actor uuid,
  p_actor_name text,
  p_verb text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Nobody is told about their own act, and the system tells nobody.
  if p_actor is null or p_actor = p_step.assigned_to then
    return;
  end if;

  if not exists (
    select 1 from public.user_profiles
     where id = p_step.assigned_to and status = 'active'
  ) then
    return;
  end if;

  -- The assignment of the work itself, still unread, already tells them.
  if exists (
    select 1 from public.notifications n
     where n.recipient_id = p_step.assigned_to
       and n.task_id = p_step.task_id
       and n.read_at is null
       and n.kind in ('ordinary_assignment', 'reassignment', 'ownership_changed')
  ) then
    return;
  end if;

  insert into public.notifications (
    recipient_id, kind, channel, requires_action, title, body,
    task_id, actor_id, entity_type, entity_id
  ) values (
    p_step.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'New step on your work',
    format('%s · On "%s".%s %s %s.',
           p_step.action, p_parent.title,
           focus.step_due_sentence(p_step.due_at, p_parent.due_at),
           p_verb, coalesce(p_actor_name, 'a colleague')),
    p_step.task_id,
    p_actor,
    'task_step',
    p_step.id
  );
end;
$$;

revoke all on function focus.notify_step_for_owner(
  public.task_checklist_items, public.tasks, uuid, text, text
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- A step written already assigned.
-- ---------------------------------------------------------------------------

create or replace function focus.notify_contribution_created()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
  assigner_name text;
begin
  if new.assigned_to is null then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found or new.assigned_to = focus.current_user_id() then
    return new;
  end if;

  select full_name into assigner_name
    from public.user_profiles where id = focus.current_user_id();

  -- v161 - for the owner, on their own work, by somebody else.
  if parent.primary_owner_id = new.assigned_to then
    perform focus.notify_step_for_owner(
      new, parent, focus.current_user_id(), assigner_name, 'Added by');
    return new;
  end if;

  perform focus.notify(
    new.assigned_to,
    'collaboration_handoff',
    'immediate',
    true,
    'New contribution assigned',
    format('%s · Part of "%s".%s Assigned by %s. %s',
           new.action, parent.title,
           focus.step_due_sentence(new.due_at, parent.due_at),
           coalesce(assigner_name, 'a colleague'),
           case when parent.status = 'active' and new.state = 'ready'
                then 'Ready to start.'
                else 'Waiting for the owner to start.' end),
    new.task_id,
    null,
    focus.current_user_id());

  update public.notifications
     set entity_type = 'checklist_item', entity_id = new.id
   where recipient_id = new.assigned_to
     and task_id = new.task_id
     and entity_id is null
     and read_at is null;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- A step moved from one person to another, to its owner, or to nobody.
-- ---------------------------------------------------------------------------

create or replace function focus.notify_contribution_assigned()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent public.tasks;
  assigner_name text;
  ready boolean;
  actor uuid := focus.current_user_id();
  to_contributor boolean;
begin
  -- Only a genuine change of person.
  if new.assigned_to is not distinct from old.assigned_to then
    return new;
  end if;

  select * into parent from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;

  select full_name into assigner_name
    from public.user_profiles where id = actor;

  to_contributor := new.assigned_to is not null
                    and new.assigned_to <> parent.primary_owner_id;

  if to_contributor then
    ready := parent.status = 'active' and new.state = 'ready';

    -- One notification, not two (section 4). Whether it is startable yet belongs
    -- in this message, not in a second one arriving in the same second.
    perform focus.notify(
      new.assigned_to,
      'collaboration_handoff',
      'immediate',
      true,
      'New contribution assigned',
      format('%s · Part of "%s".%s Assigned by %s. %s',
             new.action, parent.title,
             focus.step_due_sentence(new.due_at, parent.due_at),
             coalesce(assigner_name, 'a colleague'),
             case when ready then 'Ready to start.'
                  else 'Waiting for the owner to start.' end),
      new.task_id,
      null,
      actor);

    update public.notifications
       set entity_type = 'checklist_item', entity_id = new.id
     where recipient_id = new.assigned_to
       and task_id = new.task_id
       and entity_id is null
       and read_at is null;
  elsif new.assigned_to is not null then
    -- v161 - handed to the owner by somebody else: a step on their own work.
    perform focus.notify_step_for_owner(new, parent, actor, assigner_name, 'Assigned to you by');
  end if;

  -- The previous assignee learns it left their list, but is not asked to act -
  -- v161: wherever it went, including back to the owner or to nobody.
  if old.assigned_to is not null
     and old.assigned_to <> parent.primary_owner_id then
    perform focus.notify(
      old.assigned_to,
      'collaboration_handoff',
      'digest',
      false,
      (case when to_contributor then 'Contribution reassigned'
            else 'Contribution withdrawn' end)::text,
      (case when to_contributor
            then format('"%s" has been reassigned. It is no longer on your Shared list.', new.action)
            else format('"%s" is no longer yours to do. It has left your Shared list.', new.action)
       end)::text,
      new.task_id,
      null,
      actor);
  end if;

  -- Audited as before: an assignment to somebody other than the owner.
  if to_contributor then
    perform focus.write_audit(
      p_event_type := 'checklist_item_assigned',
      p_actor_id := actor,
      p_task_id := new.task_id,
      p_detail := jsonb_build_object(
        'checklist_item_id', new.id,
        'action', new.action,
        'previous_assignee', old.assigned_to,
        'new_assignee', new.assigned_to));
  end if;

  return new;
end;
$$;

-- Replaces the definitions in 20260911004000_v158_step_notifications.sql.
