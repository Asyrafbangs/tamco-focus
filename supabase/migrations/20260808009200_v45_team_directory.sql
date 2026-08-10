-- ---------------------------------------------------------------------------
-- v45 sections 1-2 — a directory of colleagues, separate from visibility of
-- their work.
--
-- Part A makes any active team member assignable to a checklist step. The
-- directory did not follow: `user_profiles` is readable only for yourself,
-- people you manage, and your own manager. So an ordinary employee opening the
-- assignee picker would have seen two or three names, and a step handed over
-- by a peer would have rendered as "Team member" — the feature would have been
-- present and useless.
--
-- Two questions were being answered by one policy:
--
--   who exists, and what are they called?   everyone at work knows this
--   whose work may I read?                  the reporting line decides
--
-- This view answers only the first, and only for people who are still here. It
-- carries a name and an employee ID — what a person needs to hand work to a
-- colleague and to know who handed work to them. Every other column of
-- `user_profiles` (targets, digest settings, reporting line, status history)
-- stays behind the existing policy, which is untouched.
--
-- It deliberately does NOT use `security_invoker`, because bypassing the
-- row policy is the entire point; the guard is that the projection is three
-- columns wide, active-only, and refuses anyone who is not an active account.
-- ---------------------------------------------------------------------------

create or replace view public.team_directory as
select
  person.id,
  person.full_name,
  person.employee_id
from public.user_profiles person
where person.status = 'active'
  and focus.is_active_account();

comment on view public.team_directory is
  'Names of active colleagues, for assignment and attribution. Deliberately '
  'not bounded by the reporting line: collaboration is not a hierarchy (v45 '
  'sections 1-2). Carries no settings, targets, or reporting relationships.';

revoke all on public.team_directory from public, anon;
grant select on public.team_directory to authenticated;

-- ---------------------------------------------------------------------------
-- The Shared projection needs the same fix, for the same reason.
--
-- It joined `user_profiles` for the owner's name, and that join is an INNER
-- one under `security_invoker`: when the row policy hid the owner, it did not
-- hide the name — it removed the whole contribution from the assignee's Shared
-- list. Work assigned across the reporting line simply never appeared, with no
-- error anywhere to say so.
-- ---------------------------------------------------------------------------

create or replace view public.shared_contributions
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
  coalesce(owner.full_name, 'Team member') as primary_owner_name,

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
-- LEFT, and against the directory: a contribution must survive the loss of a
-- name. `can_view_task` already grants the parent row to anyone holding a step
-- on it, so the task join is safe as an inner one.
left join public.team_directory owner on owner.id = parent.primary_owner_id
left join public.task_checklist_items prerequisite
       on prerequisite.id = item.depends_on_item_id
where item.assigned_to is not null
  -- The defining condition: somebody else owns the result (section 23).
  and item.assigned_to <> parent.primary_owner_id
  and parent.status <> 'cancelled';

grant select on public.shared_contributions to authenticated;
