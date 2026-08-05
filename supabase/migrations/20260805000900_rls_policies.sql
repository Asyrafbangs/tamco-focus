-- ============================================================================
-- TAMCO Focus — Row-Level Security policies
--
-- Every table carrying user data has RLS enabled and a default-deny posture:
-- a table with RLS on and no matching policy returns nothing and accepts
-- nothing. Policies are written for `authenticated` only; `anon` is granted
-- no access anywhere.
--
-- Deletion is almost universally absent by design. Archive is not deletion
-- (MASTER_PRODUCT_SPEC.md section 21.4), and records are retained
-- (section 21.3), so most tables simply have no DELETE policy at all.
--
-- High-impact state changes do not rely on these policies for their business
-- rules: they run through SECURITY DEFINER procedures that lock rows, check
-- versions, and write audit events. RLS is the floor, not the ceiling.
-- ============================================================================

alter table public.departments               enable row level security;
alter table public.user_profiles             enable row level security;
alter table public.visibility_policies       enable row level security;
alter table public.visibility_grants         enable row level security;
alter table public.focus_targets             enable row level security;
alter table public.org_settings              enable row level security;
alter table public.user_alert_preferences    enable row level security;
alter table public.delegations               enable row level security;
alter table public.tasks                     enable row level security;
alter table public.task_collaborators        enable row level security;
alter table public.task_relations            enable row level security;
alter table public.task_checklist_items      enable row level security;
alter table public.barriers                  enable row level security;
alter table public.task_updates              enable row level security;
alter table public.task_update_mentions      enable row level security;
alter table public.attachments               enable row level security;
alter table public.attachment_views          enable row level security;
alter table public.work_captures             enable row level security;
alter table public.work_capture_attachments  enable row level security;
alter table public.routine_templates         enable row level security;
alter table public.routine_template_items    enable row level security;
alter table public.routine_findings          enable row level security;
alter table public.work_proposals            enable row level security;
alter table public.meeting_queue_items       enable row level security;
alter table public.completion_reviews        enable row level security;
alter table public.audit_events              enable row level security;
alter table public.admin_security_log        enable row level security;
alter table public.notifications             enable row level security;
alter table public.email_deliveries          enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create policy departments_select on public.departments
  for select to authenticated
  using (focus.is_active_account());

create policy departments_admin_write on public.departments
  for all to authenticated
  using (focus.is_admin())
  with check (focus.is_admin());

-- ---------------------------------------------------------------------------
-- User profiles
--
-- A user always sees themselves. Beyond that, sight of a colleague follows the
-- same effective-visibility rule as their work, plus the narrow directory
-- lookups the product needs: your own manager, and the people who report to
-- you (so a manager can populate an assignment picker).
-- ---------------------------------------------------------------------------

create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (
    focus.is_active_account()
    and (
         id = focus.current_user_id()
      or focus.can_view_user(id)
      or id = (
           select p.reporting_manager_id
             from public.user_profiles p
            where p.id = focus.current_user_id()
         )
    )
  );

-- Self-service is limited to personal preferences. Role, employee ID, email,
-- reporting line, and status are administrator-controlled (section 3.1: a team
-- member may not grant themselves visibility or change their own authority).
-- The column-level restriction is enforced by the `user_profiles_self_update`
-- guard trigger below, because Postgres policies cannot restrict columns.
create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (id = focus.current_user_id() and focus.is_active_account())
  with check (id = focus.current_user_id());

create policy user_profiles_admin_all on public.user_profiles
  for all to authenticated
  using (focus.is_admin())
  with check (focus.is_admin());

create or replace function focus.guard_self_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Administrators and the service role reach this table through the
  -- provisioning procedures, which set the local flag below.
  if focus.is_admin() or current_setting('focus.privileged_write', true) = 'on' then
    return new;
  end if;

  if new.id = auth.uid() then
    if new.employee_id      is distinct from old.employee_id
       or new.email         is distinct from old.email
       or new.role          is distinct from old.role
       or new.status        is distinct from old.status
       or new.department_id is distinct from old.department_id
       or new.reporting_manager_id is distinct from old.reporting_manager_id
    then
      raise exception
        'Identity, role, department, reporting line, and account status are administrator controlled.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger user_profiles_guard_self_update
  before update on public.user_profiles
  for each row execute function focus.guard_self_profile_update();

-- ---------------------------------------------------------------------------
-- Visibility administration (section 22.5) — administrator only, always.
-- A viewer may read their own policy so the UI can explain their access.
-- ---------------------------------------------------------------------------

create policy visibility_policies_select on public.visibility_policies
  for select to authenticated
  using (focus.is_admin() or viewer_id = focus.current_user_id());

create policy visibility_policies_admin_write on public.visibility_policies
  for all to authenticated
  using (focus.is_admin())
  with check (focus.is_admin());

create policy visibility_grants_select on public.visibility_grants
  for select to authenticated
  using (focus.is_admin() or viewer_id = focus.current_user_id());

create policy visibility_grants_admin_write on public.visibility_grants
  for all to authenticated
  using (focus.is_admin())
  with check (focus.is_admin());

-- ---------------------------------------------------------------------------
-- Focus targets and settings
-- ---------------------------------------------------------------------------

create policy focus_targets_select on public.focus_targets
  for select to authenticated
  using (focus.is_active_account());

-- Organisation-wide targets are administrator territory (section 3.3); a
-- manager may set targets for their own reports where allowed (section 3.2).
create policy focus_targets_write on public.focus_targets
  for insert to authenticated
  with check (
    focus.is_admin()
    or (
      focus.is_manager_or_admin()
      and scope_type = 'user'
      and focus.is_manager_of(scope_id)
    )
  );

create policy org_settings_select on public.org_settings
  for select to authenticated
  using (focus.is_active_account());

create policy org_settings_update on public.org_settings
  for update to authenticated
  using (focus.is_admin() or (focus.is_manager_or_admin() and manager_editable))
  with check (focus.is_admin() or (focus.is_manager_or_admin() and manager_editable));

create policy user_alert_preferences_own on public.user_alert_preferences
  for all to authenticated
  using (user_id = focus.current_user_id() or focus.is_admin())
  with check (user_id = focus.current_user_id() or focus.is_admin());

create policy delegations_select on public.delegations
  for select to authenticated
  using (
    focus.is_admin()
    or delegator_id = focus.current_user_id()
    or delegate_id = focus.current_user_id()
  );

create policy delegations_write on public.delegations
  for insert to authenticated
  with check (focus.is_admin() or delegator_id = focus.current_user_id());

-- ---------------------------------------------------------------------------
-- Tasks
--
-- No DELETE policy: valid work moves to Available Work or is cancelled into the
-- archive (PRODUCTION_LOGIC.md section 3.2 — never "Delete").
-- ---------------------------------------------------------------------------

create policy tasks_select on public.tasks
  for select to authenticated
  using (focus.is_active_account() and focus.can_view_task(id));

-- Employees may capture their own work without approval (section 8.8). A
-- manager may assign to someone they manage. Nobody may create work owned by a
-- person they merely have view access to.
create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (
    focus.is_active_account()
    and created_by = focus.current_user_id()
    and (
         primary_owner_id = focus.current_user_id()
      or focus.is_admin()
      or (focus.is_manager_or_admin() and focus.is_manager_of(primary_owner_id))
    )
  );

create policy tasks_update on public.tasks
  for update to authenticated
  using (focus.is_active_account() and focus.can_edit_task(id))
  with check (focus.can_edit_task(id));

-- ---------------------------------------------------------------------------
-- Collaboration and relationships
-- ---------------------------------------------------------------------------

create policy task_collaborators_select on public.task_collaborators
  for select to authenticated
  using (user_id = focus.current_user_id() or focus.can_view_task(task_id));

create policy task_collaborators_write on public.task_collaborators
  for all to authenticated
  using (focus.can_edit_task(task_id))
  with check (focus.can_edit_task(task_id) and added_by = focus.current_user_id());

create policy task_relations_select on public.task_relations
  for select to authenticated
  using (focus.can_view_task(task_id));

-- Both ends must be editable, so a relation cannot be used to attach a task to
-- work the caller has no authority over.
create policy task_relations_write on public.task_relations
  for all to authenticated
  using (focus.can_edit_task(task_id))
  with check (
    focus.can_edit_task(task_id)
    and focus.can_view_task(related_task_id)
    and created_by = focus.current_user_id()
  );

-- ---------------------------------------------------------------------------
-- Checklist items
--
-- Structure is owner/manager territory; completing an assigned item is the
-- collaborator's right (section 13.1).
-- ---------------------------------------------------------------------------

create policy task_checklist_items_select on public.task_checklist_items
  for select to authenticated
  using (assigned_to = focus.current_user_id() or focus.can_view_task(task_id));

create policy task_checklist_items_insert on public.task_checklist_items
  for insert to authenticated
  with check (focus.can_edit_task(task_id));

create policy task_checklist_items_update on public.task_checklist_items
  for update to authenticated
  using (
    focus.can_edit_task(task_id)
    or assigned_to = focus.current_user_id()
    or focus.can_contribute_to_task(task_id)
  )
  with check (
    focus.can_edit_task(task_id)
    or assigned_to = focus.current_user_id()
    or focus.can_contribute_to_task(task_id)
  );

create policy task_checklist_items_delete on public.task_checklist_items
  for delete to authenticated
  using (focus.can_edit_task(task_id));

-- ---------------------------------------------------------------------------
-- Barriers, updates, mentions
-- ---------------------------------------------------------------------------

create policy barriers_select on public.barriers
  for select to authenticated
  using (focus.can_view_task(task_id));

create policy barriers_insert on public.barriers
  for insert to authenticated
  with check (focus.can_contribute_to_task(task_id) and raised_by = focus.current_user_id());

-- Resolving a barrier is a support decision, so it sits with the owner,
-- their manager, or an administrator rather than with any contributor.
create policy barriers_update on public.barriers
  for update to authenticated
  using (focus.can_edit_task(task_id))
  with check (focus.can_edit_task(task_id));

create policy task_updates_select on public.task_updates
  for select to authenticated
  using (focus.can_view_task(task_id));

create policy task_updates_insert on public.task_updates
  for insert to authenticated
  with check (focus.can_contribute_to_task(task_id) and author_id = focus.current_user_id());

-- No UPDATE or DELETE policy: a posted update is part of the timestamped
-- record (section 12.2) and is not rewritten after the fact.

create policy task_update_mentions_select on public.task_update_mentions
  for select to authenticated
  using (
    user_id = focus.current_user_id()
    or exists (
      select 1 from public.task_updates u
       where u.id = update_id and focus.can_view_task(u.task_id)
    )
  );

create policy task_update_mentions_insert on public.task_update_mentions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.task_updates u
       where u.id = update_id
         and u.author_id = focus.current_user_id()
         and focus.can_contribute_to_task(u.task_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Attachments and evidence
--
-- Reading this row is what authorises minting a signed Storage URL, so the
-- SELECT policy here is the real gate on file access. The Storage policies in
-- the next migration defer to exactly this rule.
-- ---------------------------------------------------------------------------

create policy attachments_select on public.attachments
  for select to authenticated
  using (focus.can_view_task(task_id));

create policy attachments_insert on public.attachments
  for insert to authenticated
  with check (focus.can_contribute_to_task(task_id) and uploaded_by = focus.current_user_id());

-- Evidence is not rewritten or removed once submitted; there is no UPDATE or
-- DELETE policy.

-- Section 20.4: opening an attachment records the view automatically. Any
-- authorised viewer may write their own view row, and nobody may write one on
-- another person's behalf.
create policy attachment_views_insert on public.attachment_views
  for insert to authenticated
  with check (
    viewer_id = focus.current_user_id()
    and exists (
      select 1 from public.attachments a
       where a.id = attachment_id and focus.can_view_task(a.task_id)
    )
  );

create policy attachment_views_select on public.attachment_views
  for select to authenticated
  using (
    viewer_id = focus.current_user_id()
    or exists (
      select 1 from public.attachments a
       where a.id = attachment_id and focus.can_view_task(a.task_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Capture Work — strictly private to the person capturing, until confirmed.
-- ---------------------------------------------------------------------------

create policy work_captures_own on public.work_captures
  for all to authenticated
  using (captured_by = focus.current_user_id())
  with check (captured_by = focus.current_user_id());

create policy work_capture_attachments_own on public.work_capture_attachments
  for all to authenticated
  using (
    exists (
      select 1 from public.work_captures c
       where c.id = capture_id and c.captured_by = focus.current_user_id()
    )
  )
  with check (
    exists (
      select 1 from public.work_captures c
       where c.id = capture_id and c.captured_by = focus.current_user_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Routines (section 16.2 — managers and administrators maintain templates;
-- team members may request one but not create uncontrolled duplicates).
-- ---------------------------------------------------------------------------

create policy routine_templates_select on public.routine_templates
  for select to authenticated
  using (
    focus.is_active_account()
    and (
         focus.is_manager_or_admin()
      or default_owner_id = focus.current_user_id()
      or focus.can_view_user(default_owner_id)
    )
  );

create policy routine_templates_write on public.routine_templates
  for all to authenticated
  using (focus.is_manager_or_admin())
  with check (focus.is_manager_or_admin());

create policy routine_template_items_select on public.routine_template_items
  for select to authenticated
  using (
    exists (
      select 1 from public.routine_templates rt
       where rt.id = template_id
         and (
              focus.is_manager_or_admin()
           or rt.default_owner_id = focus.current_user_id()
           or focus.can_view_user(rt.default_owner_id)
         )
    )
  );

create policy routine_template_items_write on public.routine_template_items
  for all to authenticated
  using (focus.is_manager_or_admin())
  with check (focus.is_manager_or_admin());

create policy routine_findings_select on public.routine_findings
  for select to authenticated
  using (focus.can_view_task(occurrence_task_id));

create policy routine_findings_insert on public.routine_findings
  for insert to authenticated
  with check (
    focus.can_contribute_to_task(occurrence_task_id)
    and recorded_by = focus.current_user_id()
  );

-- ---------------------------------------------------------------------------
-- Proposals, meeting queue, completion review
-- ---------------------------------------------------------------------------

create policy work_proposals_select on public.work_proposals
  for select to authenticated
  using (
    proposed_by = focus.current_user_id()
    or focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(proposed_by))
  );

create policy work_proposals_insert on public.work_proposals
  for insert to authenticated
  with check (focus.is_active_account() and proposed_by = focus.current_user_id());

-- Only a manager or administrator decides a proposal — never the proposer.
create policy work_proposals_decide on public.work_proposals
  for update to authenticated
  using (
    focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(proposed_by))
  )
  with check (
    focus.is_admin()
    or (focus.is_manager_or_admin() and focus.is_manager_of(proposed_by))
  );

create policy meeting_queue_items_select on public.meeting_queue_items
  for select to authenticated
  using (
    focus.is_manager_or_admin()
    or (task_id is not null and focus.can_view_task(task_id))
  );

create policy meeting_queue_items_insert on public.meeting_queue_items
  for insert to authenticated
  with check (
    focus.is_manager_or_admin()
    or (task_id is not null and focus.can_contribute_to_task(task_id))
  );

-- Recording a decision is a manager act (section 19.3).
create policy meeting_queue_items_update on public.meeting_queue_items
  for update to authenticated
  using (focus.is_manager_or_admin())
  with check (focus.is_manager_or_admin());

create policy completion_reviews_select on public.completion_reviews
  for select to authenticated
  using (focus.can_view_task(task_id));

create policy completion_reviews_insert on public.completion_reviews
  for insert to authenticated
  with check (
    focus.can_contribute_to_task(task_id)
    and submitted_by = focus.current_user_id()
  );

-- The decision itself. `can_review_task` already excludes the task's own owner
-- from reviewing their own work.
create policy completion_reviews_decide on public.completion_reviews
  for update to authenticated
  using (focus.can_review_task(task_id))
  with check (focus.can_review_task(task_id));

-- ---------------------------------------------------------------------------
-- Audit and administrative log
--
-- Readable by those authorised to see the subject; never writable, updatable,
-- or deletable through the API. Audit rows are written by SECURITY DEFINER
-- procedures, which is why no INSERT policy exists here either.
-- ---------------------------------------------------------------------------

create policy audit_events_select on public.audit_events
  for select to authenticated
  using (
    focus.is_admin()
    or (task_id is not null and focus.can_view_task(task_id))
    or (subject_user_id is not null and focus.can_view_user(subject_user_id))
    or actor_id = focus.current_user_id()
  );

create policy admin_security_log_select on public.admin_security_log
  for select to authenticated
  using (focus.is_admin());

-- ---------------------------------------------------------------------------
-- Notifications and email
-- ---------------------------------------------------------------------------

create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_id = focus.current_user_id());

-- A recipient may mark their own notification read; nothing else is writable.
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (recipient_id = focus.current_user_id())
  with check (recipient_id = focus.current_user_id());

create policy email_deliveries_select on public.email_deliveries
  for select to authenticated
  using (recipient_id = focus.current_user_id() or focus.is_admin());

-- ---------------------------------------------------------------------------
-- Baseline grants.
--
-- `anon` receives nothing anywhere in the application schema: there is no
-- unauthenticated surface.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
