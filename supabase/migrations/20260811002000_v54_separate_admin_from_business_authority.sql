-- ---------------------------------------------------------------------------
-- v54 — account administration is not business management.
--
-- Sections 16, 17 and 52 of the cloud-migration instruction draw a line this
-- schema did not: the person who can add and deactivate accounts must not
-- thereby be able to agree somebody's performance Goal, decide their Barrier,
-- or reassign their work.
--
-- Until now `focus.is_admin()` appeared as a bare disjunct inside the *action*
-- predicates, so the two roles were one. That was coherent while the only
-- administrator was a local fixture. It stops being coherent the moment a real
-- person holds the role: password resets and performance decisions are not the
-- same job, and combining them removes the separation the Goal cycle depends on.
--
-- What changes: `focus.is_admin()` is removed from the predicates that decide
-- whether somebody may *act*.
--
-- What does NOT change:
--
--   visibility        `can_view_task`, `can_view_goal`, `can_view_user` keep
--                     their admin branch. An administrator has to be able to
--                     see an account to administer it, and §19's user directory
--                     would be unusable otherwise.
--
--   account lifecycle `provision_user_profile`, `deactivate_user`,
--                     `reactivate_user`, `update_user_profile`,
--                     `set_user_visibility` and `delete_user` remain
--                     admin-gated. That is the job the role is for.
--
--   an admin who IS a manager  keeps every manager power, through the reporting
--                     line rather than through the role. The
--                     `is_manager_or_admin() and is_manager_of(...)` clauses are
--                     untouched: they already require a real relationship, and
--                     an administrator who manages nobody satisfies neither.
--
-- Consequence worth stating plainly: an administrator deactivating an employee
-- can no longer reassign that employee's open work themselves. Their manager
-- does it. That is the intended reading of §17 and §21, not an oversight.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tasks.
-- ---------------------------------------------------------------------------

create or replace function focus.can_edit_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.tasks t
     where t.id = target_task_id
       and (
            t.primary_owner_id = auth.uid()
         -- `is_manager_of` walks the reporting tree, so it stays last. The
         -- deliberate absence of any grant-based branch is what keeps view
         -- separate from edit (section 3.4); the deliberate absence of a bare
         -- `is_admin()` is what keeps administration separate from management.
         or (focus.is_manager_or_admin() and focus.is_manager_of(t.primary_owner_id))
       )
  );
$$;

create or replace function focus.can_review_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.tasks t
     where t.id = target_task_id
       and (
            t.reviewer_id = auth.uid()
         or (focus.is_manager_or_admin() and focus.is_manager_of(t.primary_owner_id))
         or exists (
              select 1 from public.completion_reviews cr
               where cr.task_id = t.id
                 and (cr.reviewer_id = auth.uid() or cr.second_reviewer_id = auth.uid())
            )
       )
       -- A reviewer must be independent of the person who did the work
       -- (section 3.1). The admin exemption that used to sit here is gone with
       -- the rest: nobody accepts their own completion.
       and t.primary_owner_id <> auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Goals.
-- ---------------------------------------------------------------------------

create or replace function focus.can_update_goal(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
      from public.goals g
     where g.id = target_goal_id
       and (
            g.owner_id = auth.uid()
         or g.manager_id = auth.uid()
         or (focus.is_manager_or_admin() and focus.is_manager_of(g.owner_id))
       )
  );
$$;

create or replace function focus.can_agree_goal(target_goal_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select focus.is_active_account() and exists (
    select 1
    from public.goals goal
    join public.user_profiles actor on actor.id = auth.uid()
    where goal.id = target_goal_id
      and (
        goal.manager_id = auth.uid()
        or (focus.is_manager_or_admin() and focus.is_manager_of(goal.owner_id))
        or (
          -- department_only self-confirmation: the manager's own Goals have no
          -- superior to agree them, and §15 forbids inventing one.
          coalesce(focus.setting('goals.governance_mode') #>> '{}', 'department_only')
            = 'department_only'
          and goal.owner_id = auth.uid()
          and actor.reporting_manager_id is null
        )
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- Capability payloads, so no screen offers a control the procedure refuses.
-- ---------------------------------------------------------------------------

create or replace function public.get_task_capabilities(p_task_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or not focus.can_view_task(p_task_id) then
      jsonb_build_object(
        'can_view', false, 'can_contribute', false, 'can_edit', false,
        'can_review', false, 'can_reassign', false, 'can_cancel', false
      )
    else (
      select jsonb_build_object(
        'can_view', true,
        'can_contribute', focus.can_contribute_to_task(task.id),
        'can_edit', focus.can_edit_task(task.id),
        'can_review', focus.can_review_task(task.id),
        'can_reassign', task.status not in ('completed', 'cancelled')
          and focus.is_manager_or_admin()
          and focus.is_manager_of(task.primary_owner_id),
        'can_cancel', task.status not in ('completed', 'cancelled') and case
          when task.is_mandatory then (
            focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id)
          )
          else (
            task.primary_owner_id = auth.uid()
            or (focus.is_manager_or_admin() and focus.is_manager_of(task.primary_owner_id))
          )
        end
      )
      from public.tasks task where task.id = p_task_id
    )
  end;
$$;

revoke all on function public.get_task_capabilities(uuid) from public, anon;
grant execute on function public.get_task_capabilities(uuid) to authenticated;

create or replace function public.get_goal_capabilities(p_goal_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when auth.uid() is null or not focus.can_view_goal(p_goal_id) then
      jsonb_build_object(
        'can_view', false, 'can_update', false, 'can_edit_structure', false,
        'can_agree', false, 'can_submit_monthly', false,
        'can_prepare_quarterly', false, 'can_complete_quarterly', false,
        'can_save_year_end', false, 'can_complete_goal', false,
        'can_cancel_goal', false
      )
    else (
      select jsonb_build_object(
        'can_view', true,
        'can_update', focus.can_update_goal(goal.id),
        'can_edit_structure', focus.can_edit_goal_structure(goal.id),
        'can_agree', focus.can_agree_goal(goal.id),
        'can_submit_monthly', focus.can_submit_goal_monthly(goal.id),
        'can_prepare_quarterly', focus.can_prepare_goal_quarterly(goal.id),
        'can_complete_quarterly', focus.can_complete_goal_quarterly(goal.id),
        'can_save_year_end', focus.can_save_goal_year_end(goal.id),
        'can_complete_goal', goal.status = 'active' and focus.can_agree_goal(goal.id),
        'can_cancel_goal', goal.status not in ('completed', 'closed', 'cancelled') and (
          goal.owner_id = auth.uid()
          or goal.manager_id = auth.uid()
          or (focus.is_manager_or_admin() and focus.is_manager_of(goal.owner_id))
        )
      )
      from public.goals goal where goal.id = p_goal_id
    )
  end;
$$;

revoke all on function public.get_goal_capabilities(uuid) from public, anon;
grant execute on function public.get_goal_capabilities(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Procedures that decided authority inline rather than through a predicate.
-- ---------------------------------------------------------------------------

-- `reassign_task`, `accept_workload_review` and `cancel_goal` each carried the
-- same bare admin branch. Rewritten in place rather than wrapped, so there is
-- one definition of who may do each thing.
do $$
declare
  body text;
begin
  -- cancel_task: the owner keeps their own cancellation; the admin branch of
  -- `manager_authority` goes. Rewritten from the live definition rather than
  -- retyped — a hand-copied body silently introduced columns this table does
  -- not have, and only an integration test caught it.
  body := pg_get_functiondef(
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'cancel_task'));
  body := replace(body,
    'manager_authority := focus.is_admin()',
    'manager_authority := false');
  execute body;

  -- reassign_task: manager-of only. §17 lists team assignment as an admin
  -- power and reassigning employee work as explicitly not one.
  body := pg_get_functiondef(
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'reassign_task'));
  body := replace(body,
    'if not (focus.is_admin()',
    'if not (false');
  execute body;

  -- accept_workload_review: recording a manager decision about somebody's
  -- capacity. Visibility is not authority here.
  body := pg_get_functiondef(
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'accept_workload_review'));
  body := replace(body,
    'if not focus.can_view_user(p_person_id) and not focus.is_admin() then',
    'if not (focus.is_manager_or_admin() and focus.is_manager_of(p_person_id)) then');
  execute body;

  -- cancel_goal: ending somebody's performance expectation.
  body := pg_get_functiondef(
    (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'cancel_goal'));
  -- The disjunct sits on its own four-space-indented line. An explicit
  -- `chr(10)` beats an escaped regex here: no backslash survives three
  -- layers of quoting intact, and this one is unambiguous.
  body := replace(body, chr(10) || '    or focus.is_admin()', '');
  execute body;
end;
$$;
