-- ============================================================================
-- v157 - Trackable Steps, stage 4: a step on binned work is owed to nobody
--
-- `shared_contributions` never asked whether the work a step belongs to is in
-- the Bin. Its sibling `completed_contributions` has since v87, and so do
-- task_overview and team_load_summary - so a task put in the Bin left every
-- list but this one, and its open steps stayed on the assignee's Shared list,
-- on the owner's Waiting on others (v155) and, from this stage, under
-- Contributions to others on My Team.
--
-- Found by reading that new section: a step on a binned fixture was listed
-- there as something Amer still owed.
--
-- The columns are unchanged, so nothing that reads the view changes shape. It
-- stays security_invoker.
-- ============================================================================

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
  assigner.full_name as assigned_by_name,
  -- v155 - whose it is, by name, for the owner waiting on it. The assignee's
  -- Shared list never needed it: that list is theirs.
  assignee.full_name as assignee_name
from public.task_checklist_items item
join public.tasks parent on parent.id = item.task_id
left join public.team_directory owner on owner.id = parent.primary_owner_id
left join public.team_directory assigner on assigner.id = item.assigned_by
left join public.team_directory assignee on assignee.id = item.assigned_to
left join public.task_checklist_items prerequisite on prerequisite.id = item.depends_on_item_id
where item.assigned_to is not null
  and item.assigned_to <> parent.primary_owner_id
  and item.state <> 'completed'
  and parent.status in ('backlog', 'active', 'paused')
  -- v157 - binned work is not work, the rule task_overview, team_load_summary
  -- and completed_contributions already follow. A step on it is owed to nobody.
  and parent.deleted_at is null
  and parent.purged_at is null;

-- Reproduced from 20260911002000_v155_waiting_on_others.sql with the two conditions added.
