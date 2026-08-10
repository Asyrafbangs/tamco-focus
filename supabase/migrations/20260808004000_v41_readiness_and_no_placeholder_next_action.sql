-- ---------------------------------------------------------------------------
-- v41 sections 10, 11 and 24.
--
-- Two changes, both about not letting the system speak as though it were the
-- person doing the work.
--
-- 1. NO FABRICATED NEXT ACTIONS (section 11).
--
--    v40 wrote "Review and activate when ready" into `next_action` on every
--    task that landed in Available. That reads as something the owner decided,
--    and it is not — it is interface guidance wearing task data's clothes. The
--    honest answer for work nobody has started is that there IS no next action,
--    and the screen should say so. Available answers "should I start carrying
--    this?", which needs an Activate button, not an invented sentence.
--
--    The guard below is a trigger rather than a rewrite of every procedure that
--    inserts a task, because it states the invariant in one place: Available
--    work carries no system-authored next action, whichever path created it.
--    A genuine next action typed by a person survives untouched.
--
-- 2. CONTRIBUTION READINESS FOLLOWS THE PARENT (sections 10, 24).
--
--    A checklist item assigned to somebody else must not look startable while
--    the parent is still sitting in Available. The contributor would begin work
--    the owner has not committed to, which is exactly the bypass of the focus
--    model that Available exists to prevent.
--
--    Readiness is therefore a function of the parent's state, so it is
--    recalculated by a trigger on that state changing. Putting it there covers
--    activate, pause, resume and conversion at once, instead of each procedure
--    remembering to do it.
-- ---------------------------------------------------------------------------

-- The exact strings the system has ever written into `next_action` itself.
-- Anything else is a person's words and is never touched.
create or replace function focus.is_system_placeholder_next_action(p_value text)
returns boolean
language sql
immutable
as $$
  select btrim(coalesce(p_value, '')) in (
    'Review and activate when ready',
    'Review and activate when ready.',
    'Complete this action'
  );
$$;

create or replace function focus.clear_placeholder_next_action()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'backlog'
     and focus.is_system_placeholder_next_action(new.next_action) then
    new.next_action := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_no_placeholder_next_action on public.tasks;
create trigger tasks_no_placeholder_next_action
  before insert or update on public.tasks
  for each row execute function focus.clear_placeholder_next_action();

-- Existing rows carrying the placeholder.
update public.tasks
   set next_action = null
 where status = 'backlog'
   and focus.is_system_placeholder_next_action(next_action);

-- ---------------------------------------------------------------------------
-- Checklist readiness (section 10).
--
--   completed                          -> completed  (never reopened here)
--   parent backlog or paused           -> waiting   (contributions only)
--   prerequisite incomplete            -> waiting
--   parent active                      -> ready
--
-- The parent-state gate applies ONLY to contributions — steps assigned to
-- somebody other than the primary owner. Section 10 is about not letting a
-- contributor start work the owner has not committed to; it says nothing about
-- the owner's own steps, and gating those would contradict section 7, which
-- exists so an owner can plan and work through Available work freely.
-- ---------------------------------------------------------------------------

create or replace function focus.recalculate_checklist_readiness(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_status public.task_status;
  parent_owner uuid;
begin
  select status, primary_owner_id into parent_status, parent_owner
    from public.tasks where id = p_task_id;
  if not found then
    return;
  end if;

  update public.task_checklist_items item
     set state = case
           when parent_status <> 'active'
                and item.assigned_to is not null
                and item.assigned_to <> parent_owner
             then 'waiting'::public.checklist_item_state
           when item.depends_on_item_id is not null
                and not exists (
                  select 1 from public.task_checklist_items prerequisite
                   where prerequisite.id = item.depends_on_item_id
                     and prerequisite.state = 'completed'
                ) then 'waiting'::public.checklist_item_state
           else 'ready'::public.checklist_item_state
         end,
         updated_at = now()
   where item.task_id = p_task_id
     and item.state <> 'completed';
end;
$$;

create or replace function focus.readiness_follows_parent_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status is distinct from old.status then
    perform focus.recalculate_checklist_readiness(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_recalculate_checklist_readiness on public.tasks;
create trigger tasks_recalculate_checklist_readiness
  after update of status on public.tasks
  for each row execute function focus.readiness_follows_parent_state();

-- A step added to work that is not active starts Waiting, not Ready. The
-- existing prerequisite trigger already handles the dependency case; this adds
-- the parent-state case alongside it.
create or replace function focus.new_step_follows_parent_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Same narrowing as above: only a contribution to somebody else's result
  -- waits on the parent being started.
  if new.state = 'ready'
     and new.assigned_to is not null
     and exists (
       select 1 from public.tasks t
        where t.id = new.task_id
          and t.status <> 'active'
          and t.primary_owner_id <> new.assigned_to
     )
  then
    new.state := 'waiting';
  end if;
  return new;
end;
$$;

drop trigger if exists task_checklist_items_parent_state on public.task_checklist_items;
create trigger task_checklist_items_parent_state
  before insert on public.task_checklist_items
  for each row execute function focus.new_step_follows_parent_state();

-- Bring existing fixtures in line with the rule they are now governed by.
do $$
declare
  task_row record;
begin
  for task_row in select id from public.tasks loop
    perform focus.recalculate_checklist_readiness(task_row.id);
  end loop;
end;
$$;

grant execute on function focus.recalculate_checklist_readiness(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Shared is a PROJECTION, never a copy (sections 9 and 23).
--
-- A contribution is a checklist item on somebody else's task. It is not another
-- task, and storing a Shared copy of it would create two records that can
-- disagree about whether the work is done. This view selects the original rows
-- and adds the parent context the Shared list needs to render.
--
-- `security_invoker` means RLS on `task_checklist_items` decides what comes
-- back, so the projection cannot widen anybody's visibility.
-- ---------------------------------------------------------------------------

create view public.shared_contributions
with (security_invoker = true)
as
select
  item.id                   as checklist_item_id,
  item.task_id,
  item.action               as title,
  item.assigned_to          as assignee_id,
  item.evidence_rule,
  item.due_at               as item_due_at,
  item.depends_on_item_id,
  item.state,
  item.completed_at,
  item.position,

  parent.title              as parent_title,
  parent.status             as parent_status,
  parent.work_class         as parent_work_class,
  parent.due_at             as parent_due_at,
  parent.due_is_date_only   as parent_due_is_date_only,
  parent.primary_owner_id,
  owner.full_name           as primary_owner_name,

  prerequisite.action       as prerequisite_title,

  -- The readiness reason, derived once here so the list and the drawer cannot
  -- word the same state differently (section 10).
  case
    when item.state = 'completed'                    then 'completed'
    when parent.status = 'backlog'                   then 'waiting_for_owner'
    when parent.status = 'paused'                    then 'waiting_parent_paused'
    when item.depends_on_item_id is not null
         and coalesce(prerequisite.state, 'waiting') <> 'completed'
                                                     then 'waiting_prerequisite'
    when parent.status = 'active'                    then 'ready'
    else 'waiting'
  end as readiness

from public.task_checklist_items item
join public.tasks parent on parent.id = item.task_id
join public.user_profiles owner on owner.id = parent.primary_owner_id
left join public.task_checklist_items prerequisite
       on prerequisite.id = item.depends_on_item_id
where item.assigned_to is not null
  -- The defining condition: somebody else owns the result (section 23).
  and item.assigned_to <> parent.primary_owner_id
  and parent.status <> 'cancelled';

grant select on public.shared_contributions to authenticated;
