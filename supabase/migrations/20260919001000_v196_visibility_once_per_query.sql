-- ============================================================================
-- v196 — who may see what is worked out once per query, not once per row.
--
-- Reported 19 September 2026: opening a task was smoother after v195 but
-- "still loading and taking time". Production's own statistics said why: the
-- queries behind every page averaged 120-480 ms, with 166 tasks. Profiled as a
-- manager, `focus.can_view_task` cost about 0.9 ms per row — it rebuilt the
-- viewer's whole visibility (reporting tree, grants, mode) every time it was
-- asked — and it was asked for every task, step, attachment, update and
-- request a page touched: counting 154 steps took 134 ms, the team summary
-- 300 ms.
--
-- The rules do not change. Task and request visibility move into set
-- functions — the same conditions, in the same order, answering "which ones"
-- instead of "this one" — and every read policy that asked per row now asks
-- once per query, `(select focus.visible_task_id_array())`, and checks each row
-- against the answer. `can_view_task` and `can_view_request` are redefined on
-- the sets, so there is still one definition of each rule; a single check costs
-- what it did.
--
-- Measured locally at Production's size, as a manager: every task 126 -> 4 ms,
-- every step 129 -> 1 ms, the team list 99 -> 3 ms, the team summary
-- 110 -> 7 ms, one person's full task rows 189 -> 13 ms.
--
-- supabase/tests/rls_visibility_sets_v196.test.sql holds the v195 rules as the
-- specification and checks the sets and the rewritten policies against them
-- for every user.
-- ============================================================================

/*
 * Who the signed-in person may see, as one array.
 *
 * The set form of `focus.visible_user_ids()`, which stays the definition. A
 * policy reads it once per query as `(select focus.visible_user_id_array())`.
 */
create or replace function focus.visible_user_id_array()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(v.user_id), '{}'::uuid[]) from focus.visible_user_ids() v;
$$;

/*
 * Every task the signed-in person may see: THE definition of task visibility.
 *
 * Moved here from `can_view_task`, which now asks this. The conditions are the
 * ones that function had, in the same order; only the shape changes, from "may
 * I see this one task" to "which tasks may I see", so that a policy can work it
 * out once per query instead of once per row (v196).
 */
create or replace function focus.visible_task_id_array()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(t.id), '{}'::uuid[])
    from public.tasks t
   where
         -- Cheapest first: your own work, then an administrator's blanket
         -- scope, then the paths that need a lookup.
         t.primary_owner_id = (select auth.uid())
      or (select focus.is_admin())
      or t.reviewer_id = (select auth.uid())
      or t.id in (
           select c.task_id from public.task_collaborators c
            where c.user_id = (select auth.uid())
         )
      or t.id in (
           select ci.task_id from public.task_checklist_items ci
            where ci.assigned_to = (select auth.uid())
         )
      or t.id in (
           select cr.task_id from public.completion_reviews cr
            where cr.reviewer_id = (select auth.uid())
               or cr.second_reviewer_id = (select auth.uid())
         )
      -- The reporting tree and explicit grants, worked out once.
      or t.primary_owner_id = any ((select focus.visible_user_id_array())::uuid[]);
$$;

/*
 * Every request (barrier) the signed-in person may see: THE definition,
 * moved here from `can_view_request` for the same reason.
 */
create or replace function focus.visible_request_id_array()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(request.id), '{}'::uuid[])
    from public.barriers request
   where (select focus.is_active_account())
     and (
          request.raised_by = (select auth.uid())
       or request.action_required_from = (select auth.uid())
       or (request.task_id is not null
           and request.task_id = any ((select focus.visible_task_id_array())::uuid[]))
       or (request.goal_id is not null and focus.can_view_goal(request.goal_id))
     );
$$;

create or replace function focus.can_view_task(target_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(target_task_id = any (focus.visible_task_id_array()), false);
$$;

create or replace function focus.can_view_request(target_barrier_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(target_barrier_id = any (focus.visible_request_id_array()), false);
$$;

revoke all on function focus.visible_user_id_array() from public, anon;
revoke all on function focus.visible_task_id_array() from public, anon;
revoke all on function focus.visible_request_id_array() from public, anon;
grant execute on function focus.visible_user_id_array() to authenticated, service_role;
grant execute on function focus.visible_task_id_array() to authenticated, service_role;
grant execute on function focus.visible_request_id_array() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read policies: the same expressions, with the per-row visibility calls
-- replaced by membership of the once-per-query sets, and the argument-free
-- helpers asked once. Generated from the live policy text; nothing else in
-- them changes.
-- ---------------------------------------------------------------------------

drop policy attachment_views_select on public.attachment_views;
create policy attachment_views_select on public.attachment_views
  as permissive for select to authenticated
  using (((viewer_id = (SELECT focus.current_user_id())) OR (EXISTS ( SELECT 1
   FROM attachments a
  WHERE ((a.id = attachment_views.attachment_id) AND COALESCE((a.task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false))))));

drop policy attachments_select on public.attachments;
create policy attachments_select on public.attachments
  as permissive for select to authenticated
  using (COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false));

drop policy audit_events_select on public.audit_events;
create policy audit_events_select on public.audit_events
  as permissive for select to authenticated
  using (((SELECT focus.is_admin()) OR ((task_id IS NOT NULL) AND COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false)) OR ((goal_id IS NOT NULL) AND focus.can_view_goal(goal_id)) OR ((subject_user_id IS NOT NULL) AND COALESCE((subject_user_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false)) OR (actor_id = (SELECT focus.current_user_id()))));

drop policy barrier_responses_select on public.barrier_responses;
create policy barrier_responses_select on public.barrier_responses
  as permissive for select to authenticated
  using (COALESCE((barrier_id = ANY ((SELECT focus.visible_request_id_array())::uuid[])), false));

drop policy barriers_select on public.barriers;
create policy barriers_select on public.barriers
  as permissive for select to authenticated
  using (COALESCE((id = ANY ((SELECT focus.visible_request_id_array())::uuid[])), false));

drop policy calendar_events_select on public.calendar_events;
create policy calendar_events_select on public.calendar_events
  as permissive for select to authenticated
  using (((SELECT focus.is_active_account()) AND ((created_by = (SELECT focus.current_user_id())) OR focus.is_event_participant(id) OR ((task_id IS NOT NULL) AND COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false)))));

drop policy completion_reviews_select on public.completion_reviews;
create policy completion_reviews_select on public.completion_reviews
  as permissive for select to authenticated
  using (COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false));

drop policy current_focus_select on public.current_focus;
create policy current_focus_select on public.current_focus
  as permissive for select to public
  using (((user_id = (SELECT auth.uid())) OR COALESCE((user_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false)));

drop policy employee_goal_plans_select on public.employee_goal_plans;
create policy employee_goal_plans_select on public.employee_goal_plans
  as permissive for select to authenticated
  using (((employee_id = (SELECT focus.current_user_id())) OR (SELECT focus.is_admin()) OR COALESCE((employee_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false)));

drop policy goal_checkin_session_items_select on public.goal_checkin_session_items;
create policy goal_checkin_session_items_select on public.goal_checkin_session_items
  as permissive for select to authenticated
  using ((focus.can_view_goal(goal_id) AND (EXISTS ( SELECT 1
   FROM goal_checkin_sessions session
  WHERE ((session.id = goal_checkin_session_items.session_id) AND ((session.employee_id = (SELECT focus.current_user_id())) OR (SELECT focus.is_admin()) OR COALESCE((session.employee_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false)))))));

drop policy goal_checkin_sessions_select on public.goal_checkin_sessions;
create policy goal_checkin_sessions_select on public.goal_checkin_sessions
  as permissive for select to authenticated
  using (((employee_id = (SELECT focus.current_user_id())) OR (SELECT focus.is_admin()) OR COALESCE((employee_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false)));

drop policy goal_work_links_select on public.goal_work_links;
create policy goal_work_links_select on public.goal_work_links
  as permissive for select to authenticated
  using ((focus.can_view_goal(goal_id) AND COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false)));

drop policy meeting_queue_items_select on public.meeting_queue_items;
create policy meeting_queue_items_select on public.meeting_queue_items
  as permissive for select to authenticated
  using (((SELECT focus.is_manager_or_admin()) OR ((task_id IS NOT NULL) AND COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false)) OR ((barrier_id IS NOT NULL) AND COALESCE((barrier_id = ANY ((SELECT focus.visible_request_id_array())::uuid[])), false))));

drop policy routine_findings_select on public.routine_findings;
create policy routine_findings_select on public.routine_findings
  as permissive for select to authenticated
  using (COALESCE((occurrence_task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false));

drop policy routine_exception_select on public.routine_occurrence_exceptions;
create policy routine_exception_select on public.routine_occurrence_exceptions
  as permissive for select to authenticated
  using (COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false));

drop policy routine_template_items_select on public.routine_template_items;
create policy routine_template_items_select on public.routine_template_items
  as permissive for select to authenticated
  using ((EXISTS ( SELECT 1
   FROM routine_templates rt
  WHERE ((rt.id = routine_template_items.template_id) AND ((SELECT focus.is_manager_or_admin()) OR (rt.default_owner_id = (SELECT focus.current_user_id())) OR COALESCE((rt.default_owner_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false))))));

drop policy routine_templates_select on public.routine_templates;
create policy routine_templates_select on public.routine_templates
  as permissive for select to authenticated
  using (((SELECT focus.is_active_account()) AND ((SELECT focus.is_manager_or_admin()) OR (default_owner_id = (SELECT focus.current_user_id())) OR COALESCE((default_owner_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false))));

drop policy task_checklist_items_select on public.task_checklist_items;
create policy task_checklist_items_select on public.task_checklist_items
  as permissive for select to authenticated
  using (((assigned_to = (SELECT focus.current_user_id())) OR COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false)));

drop policy task_collaborators_select on public.task_collaborators;
create policy task_collaborators_select on public.task_collaborators
  as permissive for select to authenticated
  using (((user_id = (SELECT focus.current_user_id())) OR COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false)));

drop policy task_relations_select on public.task_relations;
create policy task_relations_select on public.task_relations
  as permissive for select to authenticated
  using (COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false));

drop policy task_update_mentions_select on public.task_update_mentions;
create policy task_update_mentions_select on public.task_update_mentions
  as permissive for select to authenticated
  using (((user_id = (SELECT focus.current_user_id())) OR (EXISTS ( SELECT 1
   FROM task_updates u
  WHERE ((u.id = task_update_mentions.update_id) AND COALESCE((u.task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false))))));

drop policy task_update_requests_select on public.task_update_requests;
create policy task_update_requests_select on public.task_update_requests
  as permissive for select to authenticated
  using (COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false));

drop policy task_updates_select on public.task_updates;
create policy task_updates_select on public.task_updates
  as permissive for select to authenticated
  using (COALESCE((task_id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false));

drop policy tasks_select on public.tasks;
create policy tasks_select on public.tasks
  as permissive for select to authenticated
  using (((SELECT focus.is_active_account()) AND COALESCE((id = ANY ((SELECT focus.visible_task_id_array())::uuid[])), false)));

drop policy user_profiles_select on public.user_profiles;
create policy user_profiles_select on public.user_profiles
  as permissive for select to authenticated
  using (((SELECT focus.is_active_account()) AND ((id = (SELECT focus.current_user_id())) OR COALESCE((id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false) OR (id = (SELECT focus.current_manager_id())))));

drop policy weekly_changes_select on public.weekly_commitment_changes;
create policy weekly_changes_select on public.weekly_commitment_changes
  as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM weekly_commitments c
  WHERE ((c.id = weekly_commitment_changes.commitment_id) AND ((c.employee_id = (SELECT auth.uid())) OR COALESCE((c.employee_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false))))));

drop policy weekly_events_select on public.weekly_commitment_events;
create policy weekly_events_select on public.weekly_commitment_events
  as permissive for select to public
  using ((EXISTS ( SELECT 1
   FROM weekly_commitments c
  WHERE ((c.id = weekly_commitment_events.commitment_id) AND ((c.employee_id = (SELECT auth.uid())) OR COALESCE((c.employee_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false))))));

drop policy weekly_commitments_select on public.weekly_commitments;
create policy weekly_commitments_select on public.weekly_commitments
  as permissive for select to public
  using (((employee_id = (SELECT auth.uid())) OR COALESCE((employee_id = ANY ((SELECT focus.visible_user_id_array())::uuid[])), false)));
