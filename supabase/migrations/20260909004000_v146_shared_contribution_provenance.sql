-- ============================================================================
-- v146 — who asked for this contribution
--
-- Manager and Employee Change Specification §10: a shared contribution must
-- show "parent task, primary owner, assigned contribution, who assigned it,
-- due date and actionable state". Five of those six were already on the row.
--
-- The missing one is not a display detail. A step that appears in somebody's
-- Shared list is a request from a named person, and without the name the only
-- honest reading is "the system decided this is yours" — which is exactly the
-- impression §10 exists to prevent. It also matters when the request is wrong:
-- the person who can withdraw or re-aim it is the one who made it.
--
-- Recorded by a trigger rather than at each call site. A step is assigned from
-- two places today — a direct insert when a step is added, and
-- `update_checklist_step` when one is re-aimed — and a third would be added
-- eventually without anybody remembering this. `auth.uid()` is read from the
-- request, so it is the person acting even inside a SECURITY DEFINER
-- procedure.
--
-- Existing rows keep a null assigner. There is no way to recover who assigned
-- a step months ago, and inventing one — the task creator, say — would be a
-- guess presented as provenance. The row simply does not claim it.
-- ============================================================================

alter table public.task_checklist_items
  add column if not exists assigned_by uuid references public.user_profiles (id),
  add column if not exists assigned_at timestamptz;

comment on column public.task_checklist_items.assigned_by is
  'Section 10. Who aimed this step at its assignee. Null for steps assigned '
  'before v146, and for steps that have never had an assignee.';

create or replace function focus.record_checklist_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  /*
   * Only when the assignee actually changes.
   *
   * An edit to a step's wording or due date must not restamp the provenance:
   * "assigned by" answers who asked for it, not who last touched the row.
   */
  if tg_op = 'INSERT' then
    if new.assigned_to is not null then
      new.assigned_by := coalesce(new.assigned_by, auth.uid());
      new.assigned_at := coalesce(new.assigned_at, now());
    end if;
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    if new.assigned_to is null then
      new.assigned_by := null;
      new.assigned_at := null;
    else
      new.assigned_by := auth.uid();
      new.assigned_at := now();
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists checklist_items_record_assignment on public.task_checklist_items;
create trigger checklist_items_record_assignment
  before insert or update of assigned_to on public.task_checklist_items
  for each row execute function focus.record_checklist_assignment();

-- ----------------------------------------------------------------------------
-- The Shared list reads the name, not the id.
--
-- Through `team_directory`, which is the names-only projection: knowing who
-- assigned you a step must not widen what of theirs you can read (v45 §1-2).
-- ----------------------------------------------------------------------------

create or replace view public.shared_contributions
with (security_invoker = true)
as
select
  item.id as checklist_item_id,
  item.task_id,
  item.action as title,
  item.assigned_to as assignee_id,
  item.evidence_rule,
  item.due_at as item_due_at,
  item.depends_on_item_id,
  item.state,
  item.completed_at,
  item.position,
  parent.title as parent_title,
  parent.status as parent_status,
  parent.work_class as parent_work_class,
  parent.due_at as parent_due_at,
  parent.due_is_date_only as parent_due_is_date_only,
  parent.primary_owner_id,
  coalesce(owner.full_name, 'Team member') as primary_owner_name,
  prerequisite.action as prerequisite_title,
  case
    when parent.status = 'backlog' then 'waiting_for_owner'
    when parent.status = 'paused' then 'waiting_parent_paused'
    when item.depends_on_item_id is not null
         and coalesce(prerequisite.state, 'waiting') <> 'completed'
      then 'waiting_prerequisite'
    when parent.status = 'active' then 'ready'
    else 'waiting'
  end as readiness,
  -- v146 §10 — appended, because `create or replace view` may only add columns
  -- at the end and inserting one renames every column after it.
  item.assigned_by,
  item.assigned_at,
  assigner.full_name as assigned_by_name
from public.task_checklist_items item
join public.tasks parent on parent.id = item.task_id
left join public.team_directory owner on owner.id = parent.primary_owner_id
left join public.team_directory assigner on assigner.id = item.assigned_by
left join public.task_checklist_items prerequisite on prerequisite.id = item.depends_on_item_id
where item.assigned_to is not null
  and item.assigned_to <> parent.primary_owner_id
  and item.state <> 'completed'
  and parent.status in ('backlog', 'active', 'paused');

-- ----------------------------------------------------------------------------
-- Who finished a contribution, for the Completed view.
--
-- §10 asks that "My contributions" be separated from contributions OTHERS
-- completed on my owned work, and that the owner is not credited with a
-- colleague's work for owning the parent. Separating them needs the
-- colleague's name; the credit line is meaningless without it.
-- ----------------------------------------------------------------------------

create or replace view public.completed_contributions
with (security_invoker = true)
as
select
  item.id as checklist_item_id,
  item.task_id,
  item.action as title,
  item.assigned_to as assignee_id,
  item.completed_at,
  item.completed_by,
  parent.title as parent_title,
  parent.status as parent_status,
  parent.work_class as parent_work_class,
  parent.primary_owner_id,
  coalesce(owner.full_name, 'Team member') as primary_owner_name,
  -- Appended, for the same reason as above.
  coalesce(assignee.full_name, 'Team member') as assignee_name
from public.task_checklist_items item
join public.tasks parent on parent.id = item.task_id
left join public.team_directory owner on owner.id = parent.primary_owner_id
left join public.team_directory assignee on assignee.id = item.assigned_to
where item.assigned_to is not null
  -- A step the owner gave themselves is their own work, not a contribution.
  and item.assigned_to <> parent.primary_owner_id
  and item.state = 'completed'
  -- Deleted and purged work leaves no history to read.
  and parent.deleted_at is null
  and parent.purged_at is null;
