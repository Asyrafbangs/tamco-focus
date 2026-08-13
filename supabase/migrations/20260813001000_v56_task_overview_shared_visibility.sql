-- ---------------------------------------------------------------------------
-- v56 — a shared contributor could not open the task they contribute to.
--
-- The symptom: a checklist assignee sees their contribution listed under
-- Shared, clicks it, and nothing opens. No error, no refusal — the drawer
-- simply never appears.
--
-- The cause is an inner join, not a policy. `task_overview` is
-- `security_invoker`, so every table it touches is filtered by the caller's
-- own RLS, and it joined `user_profiles` to fetch the owner's display name:
--
--     FROM tasks t JOIN user_profiles owner ON owner.id = t.primary_owner_id
--
-- A contributor may read the task — `focus.can_view_task` returns true for a
-- checklist assignee, and the `tasks` row is visible — but they may NOT read
-- the owner's profile row, because profiles stay private to the reporting
-- line (v45 sections 1-2). An inner join against an invisible row does not
-- return a partial record; it removes the record. So the task the contributor
-- was authorised to see disappeared from the view, `getTaskDetail` read null,
-- and the drawer had nothing to render.
--
-- Measured before the change, as the contributor:
--     focus.can_view_task(task)              true
--     rows in public.tasks                   1
--     rows in public.task_overview           0      <- the bug
--     owner row in public.user_profiles      0
--     owner row in public.team_directory     1
--
-- The fix keeps the privacy rule exactly as it is and stops it deleting rows.
-- The owner join becomes a LEFT JOIN so the task always survives, and the
-- display name falls back to `team_directory` — the names-only projection that
-- exists precisely so somebody can be identified without their work being
-- readable. Nobody learns anything new: a contributor could already read the
-- owner's name from the directory.
--
-- `owner_department_id` is deliberately NOT given a fallback. The directory
-- does not carry it, and a department is an organisational fact that belongs
-- with the profile. It reads null for a viewer who cannot see the profile,
-- which is the honest answer rather than a widened one.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The name projection this view falls back to.
--
-- `team_directory` would have been the obvious choice — it is the same three
-- columns — but it gates on `focus.is_active_account()`, which is granted to
-- `authenticated` and not to `service_role`. Joining it made `task_overview`
-- unreadable to the weekly-summary worker, which runs as the service role and
-- reads this view. That surfaced as "permission denied for function
-- is_active_account" in the worker, nowhere near the change that caused it.
--
-- Deliberately NOT `security_invoker`, so it runs as its owner and is not
-- filtered by the caller's RLS. That is the whole point: it must answer "what
-- is this person called" for somebody who cannot read the profile row. It
-- exposes name and employee id for active accounts and nothing else — exactly
-- what `team_directory` already shows every signed-in person, so no reader
-- learns anything they could not already look up.
--
-- The alternative was granting `service_role` execute on
-- `is_active_account()`. That would have widened an authorisation helper to
-- fix a display fallback, which is the wrong direction of travel.
-- ---------------------------------------------------------------------------
create or replace view public.person_display as
  select id, full_name, employee_id
    from public.user_profiles
   where status = 'active'::account_status;

revoke all on public.person_display from public, anon;
grant select on public.person_display to authenticated, service_role;

create or replace view public.task_overview
with (security_invoker = true) as
  SELECT t.id,
    t.title,
    t.description,
    t.next_action,
    t.status,
    t.work_class,
    t.focus_bucket,
    t.origin,
    t.urgency,
    t.is_mandatory,
    t.progress_percent,
    t.over_focus_target,
    t.activation_reason_code,
    t.activation_reason_note,
    t.review_status,
    t.reviewer_id,
    t.version,
    t.primary_owner_id,
    -- Profile first for anyone entitled to it, directory as the fallback.
    coalesce(owner.full_name, owner_dir.full_name) AS owner_name,
    coalesce(owner.employee_id, owner_dir.employee_id) AS owner_employee_id,
    owner.department_id AS owner_department_id,
    t.assigned_by,
    coalesce(assigner.full_name, assigner_dir.full_name) AS assigned_by_name,
    t.assignment_batch_id,
    t.classification_rule_code,
    t.classification_rule_text,
    t.routine_template_id,
    t.occurrence_date,
    t.created_at,
    t.state_entered_at,
    t.last_meaningful_update_at,
    t.due_at,
    t.due_is_date_only,
    t.review_at,
    t.completed_at,
    t.cancelled_at,
    t.due_at IS NOT NULL AND (t.status = ANY (ARRAY['backlog'::task_status, 'active'::task_status, 'paused'::task_status])) AND now() > t.due_at AS is_overdue,
    t.status = 'active'::task_status AND t.last_meaningful_update_at < (now() - make_interval(days => focus.stale_threshold_days())) AS is_stale,
    ( SELECT count(*) AS count
           FROM barriers b
          WHERE b.task_id = t.id AND b.status = 'open'::barrier_status) AS open_barrier_count,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id) AS checklist_total,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.state = 'completed'::checklist_item_state) AS checklist_completed,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.state = 'ready'::checklist_item_state) AS checklist_ready,
    ( SELECT count(*) AS count
           FROM task_checklist_items ci
          WHERE ci.task_id = t.id AND ci.evidence_rule = 'required'::evidence_rule AND NOT (EXISTS ( SELECT 1
                   FROM attachments a
                  WHERE a.checklist_item_id = ci.id))) AS missing_evidence_count,
    ( SELECT count(*) AS count
           FROM attachments a
          WHERE a.task_id = t.id) AS attachment_count,
    ( SELECT count(*) AS count
           FROM task_collaborators c
          WHERE c.task_id = t.id) AS collaborator_count
   FROM tasks t
     LEFT JOIN user_profiles owner ON owner.id = t.primary_owner_id
     LEFT JOIN public.person_display owner_dir ON owner_dir.id = t.primary_owner_id
     LEFT JOIN user_profiles assigner ON assigner.id = t.assigned_by
     LEFT JOIN public.person_display assigner_dir ON assigner_dir.id = t.assigned_by;
