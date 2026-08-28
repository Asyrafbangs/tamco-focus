-- ---------------------------------------------------------------------------
-- v87 - a delivered contribution survives the task it was part of.
--
-- `shared_contributions` ends with `parent.status in ('backlog','active',
-- 'paused')`, which is right for what that view is for: the Shared list is
-- work somebody still owes, and a step on finished work is not owed. The
-- consequence is that the moment the owner completes their task, every step
-- other people delivered on it disappears from the product entirely.
--
-- That is the exact question a person asks later - "I finished something for
-- Amer last month, where is it?" - and the honest answer was nowhere. Their
-- own delivered work vanished because somebody else finished theirs.
--
-- A separate view rather than a relaxed condition on the existing one:
-- `shared_contributions` is read by the Shared tab, the counts and the day
-- view, and none of them should start seeing rows whose parent is over.
-- Bounded by `security_invoker`, so it shows a person only what row-level
-- security already lets them read.
-- ---------------------------------------------------------------------------

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
  coalesce(owner.full_name, 'Team member') as primary_owner_name
from public.task_checklist_items item
join public.tasks parent on parent.id = item.task_id
left join public.team_directory owner on owner.id = parent.primary_owner_id
where item.assigned_to is not null
  -- A step the owner gave themselves is their own work, not a contribution.
  and item.assigned_to <> parent.primary_owner_id
  and item.state = 'completed'
  -- Deleted and purged work leaves no history to read.
  and parent.deleted_at is null
  and parent.purged_at is null;

comment on view public.completed_contributions is
  'Steps a person was given on somebody else work and finished, whatever state that work is now in. Deliberately unfiltered by parent status, unlike shared_contributions.';
