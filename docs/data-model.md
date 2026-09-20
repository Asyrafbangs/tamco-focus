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
- `notification_email_deliveries` is the transactional outbox for individual notification email.
  Its unique notification key prevents duplicate logical deliveries; it snapshots the recipient
  address and retains rendered HTML/text, claim, retry, sent, and failure state for the lifetime of
  its authoritative notification.
- `operation_log` absorbs repeat high-impact requests through idempotency keys.

## Read models

`task_overview` supplies the shared task record and overdue/stale predicates. `focus_summary`, `team_load_summary`, and `plan_events` provide purpose-specific reads. All use `security_invoker`, so they preserve the caller's RLS context.

Generated TypeScript definitions in `src/lib/database.types.ts` must match the reset local schema; `npm run db:types:check` enforces this.

## v53 execution and Goal sessions

- `tasks.source_module`, `source_entity_type`, and `source_entity_id` are an all-or-none generic
  external-source reference. Native Focus work keeps all three null.
- `barriers` may belong to exactly one Task or Goal and carries `source_active`; Meeting Queue items
  carry the same terminal-source marker. Source deactivation preserves history and differs from
  resolution.
- `work_proposals` is optimistic-concurrency controlled and supports Pending, Changes requested,
  Approved and Declined Major Project decisions.
- `performance_periods` and `employee_goal_plans` define formal allocation. Plan finalisation is
  exactly 100%; cancellation changes the plan to Reallocation required.
- `goal_checkin_sessions` is the employee/month or employee/quarter header;
  `goal_checkin_session_items` stores one snapshot per Active Goal and links to the compatible
  per-Goal check-in history.
- Goal success measures store `actual_result`, actor and timestamp at completion. Goal cancellation
  stores its own actor/time/reason and never reuses completion fields.
- `goal_plan_overview`, `goal_session_overview`, and `action_requests_overview` are
  security-invoker read models.

## v153 calendar rescheduling

- `plan_events` appends `task_version`, the task's optimistic-concurrency version (null on a
  meeting), and `can_reschedule`, whether the caller may move this due date from the calendar.
  Both are appended because `create or replace view` can only add columns at the end.
- `can_reschedule` is false for routine occurrences, completed or cancelled work, review
  deadlines and meetings, and otherwise `focus.can_edit_task` evaluated as the caller. It is
  advisory: the move itself goes through `change_task_due_date`, which checks again.

## v154 step due dates

- `task_checklist_items.due_at` NULL means the task's own date and is never back-filled, so an
  inherited step follows its task. A non-null date is the step's own. No columns were added.
- `focus.step_due_after_task` and the `task_checklist_items_due_within_task` trigger keep a step's own
  date on or before its task's, by organisation-local day; `change_task_due_date` applies the same rule
  from the task's side.

## v155 waiting on others

- `task_overview` appends `delegated_open_count`, `delegated_overdue_count` and
  `next_delegated_due_at`, computed from steps assigned to anybody but the task's owner and not yet
  completed, each dated by its own `due_at` or else the task's.
- `shared_contributions` appends `assignee_name`. Both views stay `security_invoker`; nothing was
  written or backfilled.

## v156 calendar steps

- `plan_events` adds a `step` branch — open steps assigned to anybody but their task's owner — and
  appends `step_id`, `assignee_id`, `assignee_name`, `parent_title`, `parent_due_at`,
  `step_has_own_date` and `steps_due_with_task` to every branch. It stays `security_invoker`.

## v157 shared contributions

- `shared_contributions` leaves out steps whose work is binned or purged, as
  `completed_contributions` has since v87; its columns are unchanged.

## v158 step notifications

- `notifications.quiet` (boolean, default false) marks a notice for the bell only; the email outbox
  skips it. `notifications.dedupe_key` (text) with the partial unique index
  `notifications_recipient_dedupe_key (recipient_id, dedupe_key) where dedupe_key is not null` lets a
  scheduled notice run more than once.
- `focus.short_org_date` and `focus.step_due_sentence` word dates in messages;
  `public.notify_overdue_contributions(uuid[])` raises overdue notices and is the service role's only.

## v159 own steps

- `task_overview` appends `own_step_overdue_count` and `next_own_step_due_at`, over the owner's open
  steps (assigned to them or to nobody) that have a date of their own.
- `plan_events`' step branch also returns those steps, and its `assignee_id` and `assignee_name` name
  whoever owes a step — the owner, for an unassigned one. No columns were added to it.

## v161 steps for the owner

- `focus.notify_step_for_owner(step, task, actor, actor_name, verb)` writes the owner's "New step on
  your work" notice for both assignment triggers; it is callable by no client role. No table changes.

## v162 completed work

- `plan_events` leaves out completed work as it left out cancelled work. `focus.notify_work_completed`
  and the `tasks_notify_work_completed` trigger tell the assigner of completed work. No table changes.

## ESH Finding Management through v201

- `organizations`, `esh_rollout_settings` and `esh_staff_access` form a separate, fail-closed ESH
  authority model. Findings, actions, assignments, escalation recipients, messages, evidence,
  submissions, verification and due-date history are organisation-scoped and `esh_`-prefixed.
- External contacts are `esh_email_principals`, not Auth users. One-time `esh_access_grants` exchange
  for bounded `esh_guest_sessions`; action and escalation scope are separate join tables. Guest
  tables have no anonymous or authenticated client grants.
- `esh_followup_policies` is the current organisation policy. Each `esh_action_assignments` row
  snapshots its full timing policy and version. `esh_working_calendars` plus labelled exceptions
  define working days explicitly; `confirmed_through` states how far ESH has reviewed them.
- `esh_followup_events` makes each scheduled trigger idempotent. `esh_escalation_entitlements`
  activates one recipient, level and assignment without transferring ownership.
- `esh_notification_outbox` stores business intent and delivery state. Provider acceptance is not
  delivery; immutable `esh_delivery_events` record delivered, bounced or failed callbacks and use
  provider event IDs for replay protection.
- `esh_register_rows` is a security-invoker operational read model. It raises Needs attention for
  open work with a held notification, terminal failure or bounce as well as ordinary workflow
  attention.
