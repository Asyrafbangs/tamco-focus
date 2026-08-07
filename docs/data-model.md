# Data model

## Identity and organisation

- `departments` groups people.
- `user_profiles` mirrors `auth.users`, carries employee identity, authority, reporting line, account state, accessibility, workspace, and weekly-summary preferences.
- `user_alert_preferences` carries the meaningful personal alert switches.
- `visibility_policies` selects no team scope, explicit scope, or reporting-tree-plus-explicit scope.
- `visibility_grants` adds view-only people to one viewer.
- `focus_targets`, `org_settings`, and `delegations` hold governed operational decisions.

## Work

`tasks` is the lifecycle root for Major Projects, Operational Actions, Quick Actions, Self-Development Plans, mandatory work, and generated routine occurrences. An occurrence is a task because it needs the same owner, due date, checklist, evidence, state, completion record, findings, relationships, and history.

Supporting records are `task_collaborators`, `task_relations`, `task_checklist_items`, `task_updates`, `update_mentions`, `barriers`, `attachments`, `attachment_views`, `completion_reviews`, and `routine_findings`. Capture uses `work_captures` and `work_capture_attachments` until confirmation moves metadata into the authoritative task records.

## Governance and routine work

`routine_templates` and `routine_template_items` define recurring work. `generate_routine_occurrences` uses template watermarks and uniqueness constraints to create each date once. `work_proposals`, `meeting_queue_items`, and governance fields retain decisions without prematurely activating work.

## Goals v33

`goals` is the lifecycle and summary root. `goal_versions` retains immutable active, pending, and superseded structural agreements; `goal_milestones` belongs to a version so a proposal never rewrites the active agreement. `goal_participants` records employee and manager/reviewer participation, and `goal_agreements` records who agreed which version and when.

`goal_updates` stores employee-reported overall progress separately from milestone-derived progress. `goal_milestone_updates` stores independent five-percent-step milestone history. `goal_support_requests`, `goal_attachments`, `goal_attachment_views`, and `goal_work_links` add actionable support, private evidence, audited access, and supporting work without coupling task completion to Goal progress.

`goal_overview` and `goal_team_summary` are security-invoker read models. The weighted-progress helper derives milestone context without overwriting reported progress. Goal foreign keys on notifications and audit events preserve meaningful action and immutable history.

## Records and operations

- `audit_events` is append-only. Undo writes a new event with `reversal_of_event_id`.
- `admin_security_log` outlives user deletion and retains identity-administration events.
- `notifications` drives in-app and digest attention.
- `email_deliveries` stores rendered content, a unique recipient/type/period key, processing claims, attempts, retry time, result, and failure reason.
- `operation_log` absorbs repeat high-impact requests through idempotency keys.

## Read models

`task_overview` supplies the shared task record and overdue/stale predicates. `focus_summary`, `team_load_summary`, and `plan_events` provide purpose-specific reads. All use `security_invoker`, so they preserve the caller's RLS context.

Generated TypeScript definitions in `src/lib/database.types.ts` must match the reset local schema; `npm run db:types:check` enforces this.
