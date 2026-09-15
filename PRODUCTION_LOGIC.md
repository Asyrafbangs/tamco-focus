# TAMCO Focus — Production Logic

**Current implementation baseline:** v49 attention summary and exact-action UI repair — v37 baseline plus v38 audited due dates and atomic checklist evidence and the v40 to v49 revisions in section 40
**Purpose:** Implementation reference for backend, database, API, audit, permissions, UI state, and acceptance testing.  
**Maintenance rule:** Every approved workflow change must update this file and `MASTER_PRODUCT_SPEC.md` in the same revision. Updated specifications and prototypes supplied later must be processed through `CHANGE_INTAKE_PROTOCOL.md`.

---

## 1. Work model

### 1.1 Normal task states

Only these states appear in the normal task lifecycle:

- `backlog` — valid work not currently active. Displayed to users as **Available Work** where appropriate.
- `active` — part of the primary owner’s current focus.
- `paused` — temporarily stopped, with restart date or next review date.
- `completed` — required work and evidence are complete.

Cancellation is a terminal archived outcome, not a normal working state.

### 1.2 Work classes

- **Quick Action** — same-day, low-governance work; does not count toward focus targets.
- **Routine occurrence** — generated from a controlled recurring template; does not count toward focus targets.
- **Major Project** — sustained strategic result.
- **Operational Action** — sustained follow-up, coordination, corrective action, or important commitment.
- **Self-Development Plan** — self-learning, e-learning, coaching, certification preparation, competency practice, or other capability improvement.
- **Collaborative contribution** — a small assigned contribution inside another owner’s task; no separate focus count unless converted to an independently managed action.

---

## 2. Focus targets

### 2.1 Default personal targets

Each primary owner has configurable recommended Active targets:

| Focus bucket | Default target |
|---|---:|
| Major Project | 1 |
| Operational Actions | 5 |
| Self-Development Plan | 1 |

These are **soft focus targets, not hard quotas**.

### 2.2 Counting

- Only `active` tasks count.
- Count belongs to the primary owner.
- Supporting collaborators do not consume another target count.
- Routine occurrences and Quick Actions do not count.
- Overdue Active work continues to count.
- Reassignment transfers the count after the new owner’s workload is recalculated.

### 2.3 Within-target activation

When activating an Available Work item and resulting count is less than or equal to target:

1. Validate owner, bucket, due/review date, and latest record version.
2. Change `backlog → active` immediately.
3. Record actor and timestamp.
4. Recalculate focus counts.
5. Display success with a 10-second Undo action.
6. Do not ask for confirmation or manager approval.

### 2.4 Over-target activation

When resulting count will exceed target:

1. Do **not** block activation.
2. Ask one question:
   - “You already have N active [bucket]. Activating this will make N+1 active against a target of T. Why is this additional focus needed now?”
3. Require one reason:
   - Urgent deadline or commitment
   - Temporary workload peak
   - Current work cannot reasonably be moved out
   - Manager, customer, or regulatory request
   - Dependency requires both tasks to remain active
   - Other
4. Require a note only when `Other` is selected.
5. Activate immediately after submission.
6. Set `over_focus_target = true` while count remains above target.
7. Notify the manager; approval is not required.
8. Show the count in red, for example `6/5`, with text **Over focus target**.
9. Record the reason and count before/after in immutable audit history.
10. Provide 10-second Undo.

### 2.5 Returning below target

When an Active task is completed, paused, moved to Available Work, cancelled, or reassigned:

- Recalculate the bucket count.
- Clear the current over-target condition when count is less than or equal to target.
- Preserve historical over-target audit events.

---

## 3. Seamless Activate and Move to Available

### 3.1 Activate

- Available Work rows display a visible **Activate** action.
- The task drawer also displays **Activate** for backlog items.
- Within target: one click.
- Over target: one reason question, then activate.
- No full edit form opens unless required activation information is missing.

### 3.2 Move to Available Work

- Active focus rows display a secondary **Move out** action.
- The drawer displays **Move to Available** for Active focus tasks.
- One click changes `active → backlog`.
- Preserve owner, bucket, urgency, due date, progress, checklist, comments, evidence, dependencies, and history.
- Show success with 10-second Undo.
- Do not call this Cancel or Delete.

### 3.3 Undo

Undo creates a reversal event; it never deletes the original event.

Store:

- original event ID
- reversal event ID
- actor
- timestamp
- previous and restored state
- focus counts before and after

---

## 4. Mandatory work

Safety, legal, compliance, incident, regulatory, or emergency work may activate immediately even above target.

Required behaviour:

- activate immediately
- mark as mandatory / controlled override
- record justification
- notify manager immediately
- show red over-target count when applicable
- require later workload review, but do not delay necessary action

---

## 5. Data model additions

Recommended fields:

### Task

- `id`
- `title`
- `status`
- `primary_owner_id`
- `focus_bucket` (`major`, `operational`, `self_development`, nullable)
- `origin` (`manager_assigned`, `self_initiated`, `routine_generated`, `finding_generated`, `collaborative`, `meeting_generated`, `system_generated`)
- `urgency`
- `due_at`
- `review_at`
- `progress_percent`
- `over_focus_target` boolean
- `activation_reason_code` nullable
- `activation_reason_note` nullable
- `activated_by`
- `activated_at`
- `version`

### Focus target configuration

- `scope_type` (`system`, `department`, `user`)
- `scope_id`
- `bucket`
- `recommended_target`
- `effective_from`
- `changed_by`
- `change_reason`

### Audit event

- `task_id`
- `event_type`
- `previous_status`
- `new_status`
- `actor_id`
- `occurred_at`
- `reason_code`
- `reason_note`
- `bucket`
- `count_before`
- `count_after`
- `target_at_event`
- `over_target`
- `reversal_of_event_id`
- `task_version`

---

## 6. Concurrency and transaction rules

Activation, move-out, replacement, reassignment, and Undo must use a database transaction.

Before commit:

1. Lock or compare the latest task version.
2. Recalculate the owner’s current Active count from the database.
3. Use the current effective target.
4. Reject duplicate repeated clicks idempotently.
5. If another user changed the task, return a conflict response:
   - “This task was updated by another user. Review the latest information before continuing.”
6. If the transaction fails, leave task state and counts unchanged.

---

## 7. Manager visibility

Managers see:

- current count and target by person and bucket
- red over-target count
- task that caused the over-target condition
- actor, date, reason, and optional note
- duration above target
- barriers, overdue work, and stale updates

Managers do not approve ordinary over-target activation. They may discuss reprioritisation or move tasks when authorised.

---

## 8. Notifications

Notify the primary owner and relevant manager when:

- an over-target activation occurs
- a mandatory action activates above target
- an over-target condition remains unresolved beyond the configured review period
- ownership changes

Normal within-target activation should appear in activity history without unnecessary email.

---

## 9. UI wording

Use:

- **Focus target** — not hard limit or quota
- **Activate**
- **Move to Available** or **Move out** in compact rows
- **Over focus target**
- **Activate anyway**
- **Why is this additional focus needed now?**

Avoid:

- “Cannot activate” merely because target is reached
- “Deactivate” in formal user-facing workflow
- “Delete” for moving valid work out of Active

---

## 10. Acceptance criteria

1. A user can activate Available Work within target with one action.
2. Reaching the target does not disable Activate.
3. Crossing the target asks exactly one reason question.
4. Activation proceeds without manager approval after a valid reason.
5. The count displays red while above target.
6. The manager can see the recorded reason.
7. Active tasks can move to Available Work with one action.
8. Both actions provide functional Undo for approximately 10 seconds.
9. Undo creates a reversal audit event.
10. Counts are recalculated from committed database state.
11. Concurrent changes cannot create incorrect counts or duplicate activation.
12. Mandatory work is never prevented by the focus target.
13. Desktop and mobile expose equivalent essential actions.

---

## 11. Revision log

### 11.4 v34 revision note

- added user creation, account deactivation, and controlled permanent deletion logic
- added personal weekly email and manager team-change digest logic
- added timestamp-derived Open, current-state, overdue, and stale duration rules
- required idempotent email delivery and database-enforced identity uniqueness


### v26

- Changed 1 / 5 / 1 from hard capacity limits to soft focus targets.
- Added over-target reason question.
- Added red over-target visual state.
- Added one-click Activate and Move to Available actions.
- Added functional Undo pattern.
- Added manager notification without approval requirement.

---

## 12. Local-first implementation and later deployment

### 12.1 Local implementation

The first complete build must run using:

- a local Next.js application
- a local Supabase stack
- committed SQL migrations
- local-only test and demonstration fixtures
- private local Storage buckets
- real local authentication and RLS enforcement

Local seed accounts and fixtures are explicitly permitted for reproducible development and automated testing. They must be clearly isolated from production configuration and must never be pushed as production user data.

### 12.2 Git and GitHub

- Initialize a local Git repository using `main`.
- Commit source, migrations, tests, documentation, configuration templates, and lockfiles.
- Do not add a GitHub remote during the local-build stage.
- Provide documented commands for adding `origin` and pushing later.
- Never commit credentials, service-role keys, local database volumes, or uploaded test files.

### 12.3 Supabase deployment readiness

- Keep `supabase/config.toml`, migrations, local seed scripts, storage configuration, and RLS tests in version control.
- Do not run `supabase link` or push to a hosted project during this stage.
- Provide a later-stage runbook for linking a hosted project, dry-running migrations, applying them, configuring storage, and setting environment variables.

### 12.4 Vercel readiness

- The application must pass a production-mode local build and start.
- All runtime configuration must be supplied through environment variables documented in `.env.example`.
- Do not link or deploy a Vercel project during this stage.
- Avoid local-only assumptions that would block later serverless deployment.

### 12.5 Future approved changes

When newer product files are delivered, implementation must be updated from the files rather than from a frozen copy embedded in the original prompt. New changes require:

- impact assessment
- code changes
- forward-only migrations where required
- tests
- documentation
- revision history
- desktop and mobile parity verification

### 12.6 v28 revision note

- Added local-first production build requirements.
- Deferred GitHub, Vercel, and hosted Supabase connections.
- Added explicit support for future updated specifications and prototypes.



## 13. User identity and account lifecycle

### 13.1 Required data

The user table must contain at minimum:

- immutable internal UUID
- unique employee ID
- unique normalized email
- full display name
- department reference
- application role reference
- reporting-manager reference, nullable
- account status
- weekly personal-summary preference
- weekly manager-team-summary preference
- created, updated, deactivated, and deleted timestamps where applicable

Employee ID and normalized email require database unique constraints. Role and reporting-manager changes require audit events.

### 13.2 Create user transaction

1. Require administrator permission.
2. Normalize employee ID and email.
3. Validate required fields and uniqueness inside the transaction.
4. Create the application profile and local authentication identity using the supported server-side administration path.
5. Apply default notification preferences.
6. Create reporting-line and default visibility records where applicable.
7. Write an immutable `user_created` audit event.
8. Return a sanitized profile; never expose service-role credentials.

A partial profile or orphaned authentication identity is not acceptable. Compensate or roll back where one system write fails.

### 13.3 Deactivation

Deactivation is the normal account-removal path. Before deactivation, determine open primary-owned work and require reassignment or an explicit controlled exception. Deactivation must revoke access while retaining all historical references. Existing records continue to display the historical employee name and ID.

### 13.4 Permanent deletion

Permanent deletion is permitted only when no retained foreign-key, storage, notification, review, approval, or audit history exists. The database must enforce this rule. Confirmation requires the employee ID. A `user_deleted` administration audit event must be written to a separate administrative security log that does not depend on the deleted user row.

## 14. Weekly email summary engine

### 14.1 Reporting period

Default schedule: Monday 08:00 `Asia/Kuala_Lumpur`. The previous reporting week and current planning week must be calculated explicitly. Store all source timestamps in UTC.

### 14.2 Personal summary query

For each eligible active user, calculate from canonical task, routine, checklist, update, state-transition, completion, barrier, and audit records:

- completed in the previous week
- progress or state changes in the previous week
- overdue at generation time
- stale Active work at generation time
- due in the current week
- routines due in the current week
- highest-priority next action

Do not rely on a manually entered duplicate weekly report.

### 14.3 Manager summary query

For managers with enabled team summaries, append direct-report aggregates and exception details. Respect effective visibility and reporting-line rules. Include completions, progress/state changes, newly overdue items, barriers, stale work, focus overrides, and management decisions required.

### 14.4 Delivery safety

Use an idempotency key based on recipient, summary type, and reporting-period start. Retain queued, sent, failed, and retry status. Retry transient failures with bounded exponential backoff. Do not send duplicate email after a worker restart. Email bodies must escape user-entered content and links must be signed or access-controlled.

## 15. Task duration calculation

### 15.1 Stored timestamps

Store:

- `created_at`
- `state_entered_at`
- `due_at` or date-only due representation
- `completed_at`
- `cancelled_at`
- `last_meaningful_update_at`

Do not store mutable day counters as the source of truth.

### 15.2 Calculations

- Open age = now minus `created_at`, capped at terminal timestamp.
- Current-state age = now minus `state_entered_at`, capped at terminal timestamp.
- Overdue age = now minus `due_at` when incomplete and now is later than due.
- Stale age = now minus `last_meaningful_update_at` for Active work.

A meaningful update is a checklist completion, written progress update, evidence addition, owner/state/progress/next-action change, barrier event, or other configured qualifying event. Mere record viewing does not reset stale age.

### 15.3 Date-only due dates

A date-only commitment becomes overdue only after the organisation-local end of that date, not at UTC midnight. Date-time commitments become overdue after their exact timestamp. All due-date changes and duration-affecting state changes require audit events.

### 15.4 Presentation

Return duration values and accessible labels from a shared domain/service layer so desktop, mobile, email, and exports use identical calculations. Red overdue indicators must not be inferred from display text.


## V34 — Weekly email preference logic

1. Personal weekly summary preference is stored per user as a high-level mode: `off`, `focused`, or `standard`.
2. Manager team-summary preference is stored per eligible user as `off`, `leadership`, or `detailed`.
3. The email-generation job uses the high-level preference to choose a curated content set rather than exposing event-by-event notification controls.
4. Focused and Standard use the same lean section order: Needs attention, This week, Completed last week, and Open My Day. Focused caps visible items at three; Standard caps them at five.
5. Needs attention is exception-driven, not an activity feed. It includes overdue or stale Active work, returned Routine exceptions, action-directed barriers, requested completion changes, employee Goal updates/check-ins, and only urgent or current-week Available Work. Pending Routine not-required requests suppress overdue presentation until the manager decides.
6. This week merges Active Focus work, current-week Routine occurrences, and current-week Shared contributions with compact type/date context. The email ignores Routine occurrences outside the current planning week even when the scheduler generated them in a wider horizon.
7. Completed last week merges owned completions and completed Shared contributions, orders them latest first, applies the mode cap, and links to the full Completed history.
8. Leadership and Detailed team preferences add one Team needs attention section grouped by visible person. It may aggregate overdue work, pending completion/Routine reviews, barriers requiring the recipient's decision, Goal support/alignment, and over-target workload review. It must not list all team work, performance scores, rankings, change counts, or completion feeds.
9. Empty This week, Completed, and Team sections are omitted. An empty Needs attention section becomes one small positive line.
10. Preview screens in the prototype are visual references; the production implementation renders the same hierarchy through an email-compatible, table-based template with inline styles and plain-text parity.


## V34 — Lean Goal update logic

1. Goal progress is recalculated from milestone weights after every update.
2. Users select a coarse milestone stage rather than manually entering an arbitrary overall goal percentage. Supported stages are current value, Started (25%), Halfway (50%), Nearly done (75%), and Complete (100%).
3. Only `what_changed` is mandatory for a normal update.
4. `next_step`, attachment, and support detail are optional.
5. Selecting support required sets goal health to `Need attention` and creates a manager-visible support signal.
6. When every milestone is 100%, the goal becomes Completed/Closed.
7. A goal detail is displayed in a right-side drawer; the previous centred goal-detail modal is not the approved production pattern.
8. Team Goals must render people and selected-person goals through one master-detail view and must not simultaneously show a team table plus a second card grid.


## V34 — Goal update and milestone logic

1. Goals are routed through a dedicated `/goals` workspace; Calendar remains independent.
2. Overall goal progress can be updated through a range control in 5% increments. Each change requires a short update note and creates an audit event.
3. A milestone can be updated through an inline range control, marked complete, or opened for a comment/evidence update.
4. Milestone progress updates recalculate the weighted milestone progress. A direct overall-goal update records the employee-reported overall progress and the source of that change. Production must preserve both the reported progress and the milestone-derived progress when they differ.
5. Files uploaded through a goal or milestone update remain linked to that specific update and are also visible in the combined Evidence view.
6. Milestone edits are versioned. `Save for discussion` stores a pending milestone version and leaves the active agreed version unchanged. `Agree changes` activates the pending version and records who agreed and when.
7. New goals require at least one jointly defined milestone before they can be saved for discussion or activated. Milestone weights are evenly distributed by default and may be refined later.


## V34 — Goal weighting and milestone-update rules

1. `formal_weight_total` is calculated only from goals whose lifecycle is `Active`.
2. Draft, Discussion, Closed, Deferred, and Cancelled goals do not contribute to the formal Active total.
3. `Agree & activate` must reject a transaction that would take the employee above 100% formal Active weight. Saving for discussion remains allowed.
4. For a milestone-based goal, `goal.progress` is derived from the weighted milestone progress values. Ordinary task completion and general goal notes never change it automatically.
5. The milestone editor must initialise from the persisted saved value. Unsaved slider movement is displayed as a new value and is not committed until Save update.
6. `Mark milestone complete` sets the milestone to 100% within the same audited update transaction.
7. A milestone update may contain a note, attachments, next step, and support request. Attachments inherit the goal and milestone visibility policy.
8. The update transaction records old progress, new progress, author, timestamp, comment, files, support state, and recalculated overall goal progress.


## V36 — Next action production logic

1. `next_action` is a nullable short text field on the task record. It should normally be limited to one practical action sentence.
2. A Next action can be changed directly from task Overview or supplied with a progress update. Both paths use the same task command/service and create an immutable audit event.
3. Changing `next_action` qualifies as a meaningful update and resets the configured stale-work timer. Mere viewing does not.
4. Posting a progress update with a non-empty **What happens next?** value updates `next_action` in the same transaction as the update and attachment records.
5. Marking the Next action done records the completed action in history and clears the current `next_action`; it does not change the task state or mark the task Completed.
6. Display-source priority is: manually confirmed Next action, latest progress-update Next action, explicitly confirmed next incomplete checklist item, then no action recorded. Automatic suggestions must never silently overwrite a confirmed action.
7. Generic placeholders such as “Continue next action” are prohibited in persisted data and production UI.
8. Task-age calculations remain derived from timestamps. Their explanatory copy is presented through an information popover/modal and is not repeated in the action card.


## V36 — Team Focus presentation logic

1. Team Focus does not introduce a new task state or change capacity rules. It is a manager presentation layer over existing tasks, routines, barriers, goals and audit events.
2. `Needs attention` includes manager-relevant exceptions such as barriers/support requests, overdue work, pending manager decisions or selection exceptions, over-focus-target conditions, and other protected escalation events already defined elsewhere.
3. Default priority sorting is exception severity first: barrier/safety/critical issue, overdue work, manager decision, over-focus-target, stale work, then normal work.
4. Capacity is rendered as a numeric soft-target indicator (for example `Operational 6 / 5`). It must not be represented as a task-completion progress bar.
5. Age indicators are selectively surfaced when they are management-significant. Normal short-lived age values may remain hidden.
6. The Team Focus drawer reuses the existing task Next Action, barrier, routine, goal, permission and visibility logic; it must not create duplicate manager-only task data.
7. A manager may open the underlying task/workspace from Team Focus. Existing permission and visibility controls remain authoritative.


## V37 — Reference synchronization rule

1. `index(20260807-072841).html` is the canonical prototype behaviour for the v37 synchronization baseline.
2. The same sample users, tasks, goals, routines, focus counts, barriers, ageing values and interaction examples are retained in desktop and mobile prototype files.
3. This revision introduces no new task state, permission, focus-target rule, goal calculation rule, notification rule, or backend workflow beyond the latest approved v34/v36 logic.
4. Where older text conflicts with the latest prototype, use: dedicated Goals workspace; Plan as Calendar; **Next action** in task detail; **Team Focus** as the manager exception-first workspace.
5. UI synchronization must not be implemented by replacing real production data with prototype fixtures. Prototype data is reference/demo data only.


## V38 — Task-detail transaction and presentation logic

1. The compact task information line is presentation only. Status, urgency, overdue, progress, and age values continue to come from canonical task timestamps and the task overview read model. Open and current-state ages move behind the information control without changing their calculation.
2. `change_task_due_date` is the only task-detail due mutation. It authenticates an active account, locks the task, checks `focus.can_edit_task`, rejects terminal tasks and stale versions, applies date-only/date-time semantics in the organisation timezone, updates the meaningful-work timestamp and version, and writes `task_due_date_changed` in the same transaction.
3. A due audit payload contains `previous_due_at`, `previous_due_is_date_only`, `new_due_at`, `new_due_is_date_only`, and optional `reason`; actor and `occurred_at` remain authoritative audit columns. An unchanged value is a successful no-op and does not write an event.
4. The current Next Action remains `tasks.next_action`. It is rendered as a pinned Checklist section but never inserted into `task_checklist_items` and never contributes to checklist progress.
5. A task with permanent checklist items derives `progress_percent` as integer `(completed * 100) / total`. A database trigger maintains the value after checklist insertion, deletion, or state change, and the migration backfills existing tasks. Completion and reopen operations remain authoritative and versioned.
6. An ordinary checklist completion uses `complete_checklist_item`. An evidence-required completion uses `complete_checklist_item_with_evidence`: verify caller contribution authority and exact private-storage ownership, insert the evidence update and attachment metadata, complete the item, derive progress, update task version/meaningful time, and write update, attachment, and checklist audit events in one transaction.
7. If storage upload succeeds but the evidence-completion RPC fails, the Server Action removes only the exact newly uploaded object paths. Existing attachments are never deleted by that cleanup.
8. Recent activity is a presentation over immutable `audit_events`, `task_updates`, and `attachments`. Human-readable labels do not replace event types or edit history.
9. No-barrier presentation is neutral. The red/pink state is selected only when an open `barriers` row exists; this does not change barrier workflow, notification, pause, or escalation logic.

---

## 40. v40 to v49 — implemented behaviour

This section records what changed between v40 and v49 and, where it matters, why
the obvious alternative was rejected. It is the reference for anyone reading the
code and wondering whether a decision was deliberate.

### Navigation is state, not work class (v40 §1, v43 §1–2)

Focus navigates by `Active | Available | Shared`. Major Project, Operational
Action and Self-Development remain `work_class` values and still drive the
1 / 5 / 1 capacity model; they are reported in a quiet capacity strip and shown
on each row. They are not navigation, because asking somebody to pick
"Operational Actions" to find what they are carrying makes them navigate the
data model instead of their day.

`My Work | My Team` is a separate control above that, because scope (whose work)
and state (my relationship to it) are different dimensions. v42 placed My Team
beside the state tabs; v43 corrected it.

### Available carries no fabricated next action (v41 §11)

v40 wrote `Review and activate when ready` into `next_action` for everything
landing in Available. That reads as the owner's decision and is not one. A
trigger now clears the known system placeholders on `backlog` rows whatever
path created them; a genuine next action typed by a person is untouched.

### Shared is a projection (v41 §9, §23; v44 Part A)

`shared_contributions` selects the original `task_checklist_items` rows where
`assigned_to <> parent.primary_owner_id`. There is no Shared task and no Shared
copy — completing a contribution updates the record the primary owner is looking
at, so the two can never disagree.

Readiness follows the parent: a contribution stays `waiting` until the owner
activates the work, so a contributor cannot start what the owner has not
committed to. The gate applies only to contributions, never to the owner's own
steps — gating those would contradict planning work while it is still Available.

### Notifications are handoffs, not an audit mirror (v42 §M–P, v44 Part A/B)

`notifications` carries `entity_type` / `entity_id` so a notification opens the
exact record: a checklist item inside its parent task, a barrier with its
section focused. The bell counts unread AND actionable only.

Both handoff notifications are written by database triggers in the same
transaction as the change that caused them. A committed assignment with no
notification record is not a successful handoff, and writing it here makes it
impossible to commit one without the other. Delivery may be retried from the
row; the row cannot be lost.

### A barrier names who must act (v44 §14)

`barriers.action_required_from` and `action_type` were added because the model
recorded what was blocked and what support was needed, but not who was being
asked. "Somebody should decide this" reaches nobody's list.

`action_type` is metadata that chooses the manager's primary control — Provide
decision, Provide approval, Respond — and is explicitly not five workflows.

A response is not a resolution. `barrier_responses` is a separate table so that
replying can never accidentally close a barrier: "I will confirm by 3pm" removes
no blocker.

Authorisation deserves a note. `focus.can_view_user` answers "may I see this
person's work", which runs downwards — a manager sees their reports. Asking runs
the other way, and the commonest barrier in the product is an employee asking
their own manager for a decision. The recipient check therefore tests the
reporting line explicitly in both directions; visibility alone would have
blocked the main case.

### Needs Attention explains itself (v44 §19–20)

`getTeamAttention` returns, per person, a reason, the required action and a deep
link to the exact record, ranked by what costs most to ignore. Anything that
cannot supply all three does not appear as actionable. Manager views query the
authoritative records — tasks, barriers, routines, focus counts — and copy none
of them.

### Classification is deterministic and auditable (v40 §12–13)

Safety wording no longer influences classification at all. `replace PPE signage`
is ordinary work; mandatory classification is reachable only through the explicit
urgent path where a person answers the question themselves.
`classification_rule_code` and `classification_rule_text` are stored on the task
so the audit trail answers "why was this Operational?" with the rule that fired.


### Collaboration is not the reporting line (v45 §1–6)

Assignment eligibility is "an active team member", full stop. The previous rule
— primary owner, plus collaborators, plus whoever the viewer could see through
`focus.can_view_user` — reads as a security boundary but is not one: the insert
policy on `task_checklist_items` already requires edit rights on the task, so
the picker was never what authorised anything. All it did was decide who could
be *offered*, and for an ordinary employee that was their manager and
themselves. Izzah could not ask Fadli to do a step, which is most of what a
checklist is for.

Opening the picker exposed a second problem. `user_profiles` is readable only
for yourself, your reports and your own manager, so a team-wide picker read
through it would have returned three rows, and a step handed over by a peer
would have rendered as "Team member". `public.team_directory` answers the other
question — who is here, and what are they called — as a three-column,
active-only projection that deliberately does not use `security_invoker`. The
row policy is untouched; nothing about whose *work* you may read has changed.

The same inner join was silently deleting data from the Shared list.
`shared_contributions` joined `user_profiles` for the owner's name, and under
`security_invoker` a hidden owner did not blank the name — it dropped the whole
contribution row. Work assigned across the reporting line simply never appeared,
with nothing anywhere reporting an error. It is now a left join against the
directory, and the readiness copy names the owner: "Waiting for Izzah to start
this work" answers the question "Waiting" only raised.

### A step can be corrected, but not by everyone (v45 §16–24)

`update_checklist_step` takes the whole step rather than a patch, because the
edit drawer shows the whole step; a null due date therefore means cleared, with
no second flag per field for callers to get wrong. It diffs against the stored
row and records only the fields that moved, so `checklist_item_updated` stays
readable — an event listing every field on every save is one nobody reviews.

The authority split is the part worth explaining. Completing a step is the
assignee's right and the RLS policy grants them `UPDATE` on the row to do it.
That same grant would let them rewrite the action, the assignee and the
prerequisite, and a policy cannot prevent it: `USING` sees the old row and
`WITH CHECK` sees the new one, never both, so "you may update this row but not
those columns" is inexpressible. `focus.guard_checklist_structure` is a
`BEFORE UPDATE` trigger, which is the only mechanism that sees both rows and
covers every route into the table rather than just the RPC. It exempts
`auth.uid() is null` so migrations and seeding still work.

Removal refuses wherever something would vanish without being noticed: a
completed step, a step holding evidence, and a step another step depends on —
`on delete set null` would otherwise release every waiting step and tell nobody
their prerequisite had evaporated. Prerequisite edits walk the dependency chain
first, because two steps waiting on each other are both permanently unstartable
and no downstream screen would explain why.

### Answering is not unblocking (v45 §37–47)

One column, `status`, was doing two jobs. A manager who supplied the decision
they were asked for stayed on Needs Attention until somebody closed the barrier,
which cannot happen until the contractor turns up days later; their queue filled
with work they had already done. Closing the barrier on reply is the opposite
error — the decision is given, the shutdown is still unapproved, and the record
would claim the work was unblocked.

`action_pending` answers "does this person still owe an answer"; `status`
answers "is the work still blocked". A reply clears the first and leaves the
second alone. Needs Attention reads `action_pending`, and resolving clears both
through a trigger, since a removed blocker leaves nobody owing anything. The
requester sees which state they are in — waiting on a named person, or holding
an answer and still blocked — because those decide whether they chase somebody
today, and neither is "resolved".

`barrier_response_kind` exists because an approval has two answers. With one
button, storing prose alone was honest: a decision is whatever the manager
wrote. Two buttons writing identical rows would lose the answer entirely. The
kind carries the verdict, the message still carries the reasoning, and a
verdict on a request that never asked for approval is refused rather than
recorded as one.

### The request is the first thing on the screen (v46 §10, §41, §56)

A manager arriving from a notification knew only that something wanted them.
They landed on an ordinary task drawer, which leads with status, due date and
next action — none of which is the reason they are there. The barrier was
several sections down, and the response form below that.

Task Detail now takes an attention target: a task, plus the barrier that is
waiting, plus the fact that the person was sent here to act. `BarrierActionPanel`
renders above everything else with the request stated in the order it is asked —
what is blocking the work, what it costs, what this person specifically needs
from you — and the response control already focused.

Attention mode is verified, not trusted. A link whose barrier has since been
answered or resolved falls back to the ordinary task rather than presenting a
form for an action nobody needs. Legacy notifications that recorded only a task
resolve the recipient's own outstanding request, and only when there is exactly
one; guessing between two would put the wrong decision in front of somebody.

There is one response form in the application. The barrier history lower down
deliberately has none, because two forms are two copies of the submit rules.

### Shared and Needs Attention answer different questions (v46 §1-3, §14)

Shared is "somebody assigned me a piece of work to perform". Needs Attention is
"somebody is waiting for me to decide something". Both are lists of things other
people want, which is exactly why the boundary needs defending: the pressure is
always to put one more kind of exception into Shared, and each addition is
individually reasonable. Several additions later, Shared means "anything anyone
wants from me" and answers nothing.

So the tests assert both directions — a barrier creates no Shared row and no
checklist item; assigning a step creates no attention request — and the Shared
projection remains defined purely as checklist contributions.

Needs Attention is derived, never stored. A `needs_attention` table would be a
second copy of a fact the barrier already holds, and the two would disagree the
first time a write half-succeeded. `getMyAttention` is the single derivation;
My Team's barrier row and the notification deep link both route through the same
helpers, so the three surfaces cannot drift into three definitions of "waiting
on you".

Reading is not acting. Attention is derived from `action_pending`, never from
`notification.read_at` — opening the notification and closing the drawer leaves
the request exactly where it was.

### Idempotency under genuine concurrency (v46 §31)

Worth recording because the mechanism looked correct and was not.
`replay_operation` read the operation log, the procedure did its work, and
`remember_operation` wrote the log entry last with `on conflict do nothing`. Two
requests carrying the same key at the same time — which is what a double-click
is — both read an empty log, both did the work, and only the log entry was
deduplicated. The second caller received the first caller's result and looked
successful, while the database held two responses, two audit events and two
notifications.

`replay_operation` now takes a transaction-scoped advisory lock on the actor and
key before reading. The second transaction waits, then finds the finished result
and replays it. It is placed there rather than in each procedure because every
idempotent procedure already calls it first, so all of them are fixed at once
instead of each remembering a lock of its own.

### Focus belongs to one owner (v46 §41)

`SideDrawer` focuses its panel on open so a keyboard user starts inside the
dialog. The action panel wanted the caret in its response box, and lost every
time: parent effects run after child effects, so the drawer's focus call always
came last. Rather than have two components take focus from each other, the
drawer now looks for a `data-initial-focus` element inside its content and
honours it. The content says where the caret belongs; the drawer still decides
when.

### One way in, because six ways had already drifted (v47 §1-2, §7-8)

Six surfaces could open a barrier and each computed its own destination and its
own wording. They had already diverged — one list said "Provide approval" where
another said "Approve", and "View request" scrolled to a heading rather than
opening the request. `src/domain/barriers.ts` now owns both questions: what a
request type is called, and where its control goes. Neither is a property of the
screen showing it.

The wording is chosen from the `requested_action_type` the employee selected
when they asked. Reading their prose to infer what they meant would be
second-guessing an answer already given.

"View request" is a case worth recording, because it was invisible in exactly
the way that matters. It scrolled to the Barriers section, which the collapsed
drawer hides with `display: none` as deliberate progressive disclosure. The
control was present, enabled, and did nothing — the one outcome a visible
control may never have. It now opens the drawer, brings that barrier into view
and focuses it, and says "View response" once an answer exists, because by then
the reader is going there to read an answer.

### Queued and scheduled are different facts (v47 §18, §28-31)

A manager usually knows a topic needs discussing before knowing when. Making
"Add to Meeting Queue" require a date would force them to invent one to record
the need, so the queue item carries a status and the date arrives later, if at
all.

Neither step answers anything. `action_pending` is untouched by queueing and by
scheduling, so the request stays on Needs Attention throughout — the row changes
from red to amber and gains "Scheduled for discussion", which is a change of
urgency, not of obligation. Removing it when a meeting is booked would let a
date in a diary discharge a decision nobody has made.

The queue lives inside Monthly Plan rather than the sidebar. Most weeks it is
empty, and a permanent destination that is usually empty teaches people to stop
opening it.

### A discussion is an entry on the calendar that exists (v47 §24-26)

`plan_events` derived every entry from a task's own dates. A discussion has no
task date to derive from, so `calendar_events` holds it and the view unions it
in as a `discussion` kind. That is one calendar with one more kind of entry, not
a second calendar beside the first — which is what hanging a date off the queue
item and teaching Plan to read two sources would have produced.

Two defects in this work are worth recording because both were silent:

`42P17 infinite recursion detected in policy` — the events policy asked whether
the reader was a participant by selecting from the participants table, whose own
policy asked whether the reader could see the event. Each needed the other
evaluated first. Cross-table questions in policies are asked through a
`security definer` helper for exactly this reason; these two now are.

`where event_id = event_id` — the local variable holding the new event's id
shared its name with the column, so the comparison resolved column-to-column,
matched every row, and would have notified every participant of every
discussion. Renaming the variable is the whole fix; the lesson is that a plpgsql
variable sharing a column name is silently wrong rather than an error.

### Cards have to survive text nobody has written yet (v47 §9-11)

The Needs Attention row overflowed because it was one flex line with a fixed
height, and a barrier request is free prose: it can be two hundred characters,
and it can contain a part number with no spaces in it. Fixing the sentence that
exposed it would have left the next sentence to find it again.

The rules are general and applied to the shared card patterns: `min-width: 0` so
flex and grid children may shrink below min-content instead of overflowing,
`overflow-wrap: anywhere` so an unbroken string breaks, `height: auto` so
nothing is clipped, and a wrap at narrow widths so the action takes its own
line. The test asserts what a person would notice — no horizontal scrollbar, and
the button still inside its own card — at desktop, tablet and phone widths.

### Mandatory is a reason to start, not a reason to escalate (v48 §9-19, §28)

The rule was one line — `isMandatory → Needs Attention` — and it failed the
manager-attention invariant on every count. It could not say why the manager was
looking at it, what they were meant to do, or where. "Review controlled action"
opened an ordinary task with no manager control on it, so the honest answer to
"what now?" was "nothing".

That is worse than a missing feature. A queue containing items that need no
action trains people to skim it, and the next item — the one that genuinely
needed them — gets skimmed too.

Mandatory now means what it says: this work could not wait for normal
prioritisation. It has already been decided. It becomes the manager's problem
only when a second condition holds, and each is handled on its own terms with
its own words: over target (workload review), a barrier addressed to them (the
barrier's own action), or overdue past the existing threshold.

`getTeamAttention` also gained a gate. Every branch that builds a candidate
believed it was producing something actionable, and the one that was not is the
one that reached production, so validity is now checked centrally: no reason, no
action label or no destination means the item is dropped and logged rather than
rendered.

### Workload review asks the question that is actually open (v48 §20-24)

Not "was Amer right to start this safety task?" — the system decided that, and
asking again would put an approval in front of work that could not wait. The
open question is what gives way now that the numbers have moved.

Both answers are legitimate, so accepting the overload is a recorded decision
rather than what happens when the manager closes the panel. Moving something out
uses `move_task_to_available`, not `pause_task`: paused means blocked, and this
work is not blocked — it is simply not what should be carried this week. Using
the wrong one would write a stop reason onto a record that never had one.

### Layers, not destinations (v48 §1-8)

Closing the Task Detail drawer pushed `/work`. Opened from My Team, that
returned the manager to My Work — not a wrong tab, a different person's
workspace, with the filter and the selected person both gone.

The mistake was letting the deepest layer decide where "back" is. It cannot
know: the same drawer is reached from My Work, My Team, a person, My Day, Shared
and the calendar. Each layer is now a search parameter and closing one removes
only its own, so everything underneath survives because nothing had to remember
it. The state lives in the address, which also means a refresh, a bookmark and a
shared link all restore the same view.

The manager row's default action had the same shape of bug — `/team?view=all` —
and now opens the person drawer, one layer up from the list.

### A list card cannot be designed around its demo data (v48 §1-13, §26)

The attention card built its heading by concatenating the action type with the
whole request. With the seeded fixture that read fine. With a real barrier —
free prose, two hundred characters, sometimes a part number with no spaces in it
— the most prominent text on the screen became however long somebody's sentence
happened to be, and three rows became three paragraphs.

The structure is the fix, not the wrapping rules: action type as a small label,
the task title as the heading (stable, and the thing a manager can place), the
request as a bounded preview, then who and when, then the action. The complete
text was always in the barrier panel and stays there — nothing is truncated in
the data, only in the view.

The mechanics matter and are worth stating because they are the ones that get
omitted: a grid so the text and the control own separate columns; `min-width: 0`
because grid and flex children default to min-content and overflow rather than
wrap; `overflow-wrap: anywhere` so an unbroken token breaks; no fixed height; a
single column below the breakpoint. The regression test uses deliberately
hostile content at five widths and two zoom levels, because a card verified only
against short demo text is a card that has not been verified.

### A summary that grows is not a summary (v49 §1, §9, §40)

Needs Attention rendered every outstanding request. At three that was a list; at
twelve it pushed Start Here, Today and Coming up off the screen, and the panel
became the backlog it existed to triage. The approved 10 August amendment caps
My Day at two and says how many are behind them.

Which two matters as much as how many. `attentionPriority` is a table, not a
heuristic: reason code gives a band, a booked discussion costs a little, an
exception never outranks something owed, and age only breaks ties inside a band.
Sorting by arrival would have buried a week-old blocked decision under three
questions asked this morning; sorting by severity alone lets the least severe
request age quietly for ever, which is why the full list defaults to oldest.

The approved repair sends "View all" to Work → My Team → Needs Attention. My
Day remains a bounded, request-first summary; My Team remains a person-first
manager scan. They share ranking and exact-action resolution, but not a row
component or visual hierarchy.

### Exception is not the same as owed (v49 §10-12, §55-57)

An overdue routine is abnormal and worth a manager's eye. It is not a question
anybody asked them, and the previous CTA — "Review with them" — invented a
manager workflow that does not exist. Read it and try to predict what appears
next: open the task, message the person, change the date, arrange a meeting? It
named none of them, so it could not be wrong, which is the same as not being
useful.

Every item now carries `kind`, and the row says "Exception" or "Needs you"
accordingly. Buttons name their operation wherever the object is known: Open
task, Open routine, Provide decision, Review workload.

"Proposal to review" was worse, and is gone. It counted `work_proposals` rows,
offered "Review proposal" and opened `/more/records`. There is no proposal review
workflow in the product: nothing decides one, no screen shows what is being
proposed, no control approves or rejects it. The manager arrived at a records
page and had to ask what they were reviewing. Removing it was the honest fix;
inventing an approval workflow to justify a label would have been the expensive
one. If a real proposal object gains a real decision surface, it returns with
its own source type and its own destination.

### My Team rows and exact actions are separate interactions (v49 repair)

The regression came from reusing the generic task-row presentation for a person
row. Its absolute stretched-link overlay coupled two different operations: open
the team member and act on one attention source. The action URL also carried the
`person` layer, so an exact barrier response mounted Team Member Detail first.

My Team now has its own five-column grid: Person, Working on, Needs you, Latest,
Action. The row is a focusable `div` with button semantics and explicit Enter /
Space handling because it contains a real child button. The child action stops
propagation and navigates through the shared resolver. Exact task, routine and
barrier actions retain only the team-attention return context; they do not add
the person layer. Rows without manager action open the person through their
plain Open control.

The resolver requires `sourceType`, `sourceId`, and `ctaType`, plus task identity
for a barrier. A source/CTA mismatch or incomplete identity is logged during
development and excluded from actionable rendering. This is the validity gate;
presentation components do not infer action types from prose or assemble their
own deep links.

## v50 — Goal lifecycle transactions and derived read model

This section supersedes v34 Goal calculation and generic-update cadence where they conflict.

1. `goal_success_measures` is version-owned. Numeric progress is clamped `current / target`;
   percentage progress is the current percentage; qualitative states map Not started=0,
   Progressing=50, Achieved/Exceeded=100. Overall measure progress is the rounded arithmetic
   mean. A zero numeric target is invalid, avoiding meaningless `0 → 0` displays.
2. `create_goal_with_measures` validates one to ten structured measures, two to five milestones,
   required 1–100 formal weight and the existing active-weight guard. It delegates lifecycle
   creation to the established Goal transaction, then adds measures in the same transaction.
3. Monthly, quarterly and year-end rows use server-derived period keys. Partial unique indexes
   enforce one monthly row per Goal/month, one quarterly row per Goal/quarter and one year-end
   row per Goal/year. Advisory locks and idempotency keys prevent concurrent duplicates.
4. `post_goal_monthly_checkin` is owner-only and active-Goal-only. Measure history, Goal update,
   evidence metadata, optional support, Goal health, audit and notification changes commit or
   roll back together. No material change stores an explicit historical record without inventing
   progress. Only At risk, Off track or explicit support notifies the manager as action required.
5. `save_goal_quarterly_checkin` separates role authority: the owner submits the employee summary;
   an authorised manager records discussion and agreed actions through Agree & continue. It does
   not approve or reject the employee and creates no separate task.
6. `save_goal_year_end_result` builds a server-side source snapshot from measures, cadence,
   milestones, evidence and support. Owners/managers may refine the draft; only Goal agreement
   authority can finalize it. The final wording and its source snapshot are retained together.
7. New lifecycle tables expose authenticated `SELECT` only through Goal visibility RLS. Direct
   authenticated insert/update/delete is revoked. Security-definer RPCs re-check active account,
   exact Goal role, lifecycle state and optimistic version on every write.
8. `goal_overview` keeps its established columns and adds owner cadence, quarterly manager action,
   success-measure progress and year-end state. `manager_needs_attention` excludes normal monthly
   due dates, manager-requested owner updates, approaching targets and recent milestone completion.
   `request_goal_update` preserves the employee-reported health and sets only the owner-facing
   request timestamp. `goal_lifecycle_history` combines immutable Goal audit events and evidence
   for chronological rendering.

## v51 — Lean Goal authoring and agreement transactions

This section narrows the v50 authoring experience without replacing its data model or cadence.

1. A lean success measure is a version-owned natural-language `description` with an optional
   measure-specific target date. Existing typed measure columns remain intact for historical
   versions and deterministic progress. New statements use the same `goal_success_measures` rows;
   no parallel measure or Goal table exists.
2. `create_lean_goal` authenticates the actor, resolves the employee/manager relationship and locks
   the owner's formal allocation before writing. An employee may create only their own Draft or For
   Discussion Goal. An authorised manager may create for a direct report and may activate only when
   the resulting formal Active weight is at most 100%.
3. `save_lean_goal_version` locks the Goal, verifies the caller and optimistic version, and writes a
   replacement pending version in the same Goal record. Draft/For Discussion edits and Active
   revisions therefore preserve identity and audit history rather than creating duplicate Goals.
   An employee cannot change formal weight on an Active Goal revision.
4. `agree_lean_goal_version` is manager-only. It locks the Goal and allocation, validates the pending
   version and weight, activates that version, supersedes the former Active version when applicable,
   records agreement/audit data and emits the existing notification in one transaction.
5. Natural success statements are required and bounded; one Goal has one to ten. A statement-level
   date is optional and the Goal target date remains authoritative otherwise. Milestones are zero to
   five and are inserted only when the user explicitly supplied them.
6. The setup client may choose Draft, For Discussion or manager activation, but it does not encode
   role or transition policy. SQL RPCs remain the authority for ownership, reporting-line checks,
   state changes, allocation and audit. Direct authenticated writes remain revoked and RLS remains
   authoritative for reads.
7. Monthly and quarterly operations continue to use the v50 tables and period keys. The lean UI
   treats natural statements as narrative success criteria; it does not invent numeric progress.
   Existing typed measures continue their approved calculation, and exception-only manager
   visibility is unchanged.
## v53 — closed-loop Task execution and employee-level Goal sessions

This section is authoritative over earlier conflicting per-Goal cadence, proposal, terminal Goal and
derived-progress rules. The future ESH finding/action system remains outside the application.

1. `complete_task` and `cancel_task` lock the Task and call one terminal-projection cleanup helper.
   Focus is released; open source requests keep their history but set `source_active=false` and
   `action_pending=false`; related action notifications clear `requires_action`; unscheduled queue
   topics become removed. The request status is not rewritten to Resolved.
2. `cancel_task` permits the owner or authorised manager for ordinary work. For Mandatory work it
   permits only an authorised manager. Clients use `get_task_capabilities.can_cancel`; they do not
   reconstruct the rule.
3. `reassign_task` retains status, changes the primary owner, recalculates focus and returns the new
   Active count, configured target and `workload_review_needed`. Exceeding target does not roll the
   assignment back. `shared_contributions` is recalculated transactionally by its view predicate.
4. Major Project decisions lock and version the proposal. Request changes and Decline require a
   note. Agree creates a backlog Major Project owned by the proposer; it never activates it. A
   resubmission clears the earlier decision fields and returns to Pending.
5. Native Tasks have all generic source fields null. Externally sourced Tasks have all three fields;
   the all-or-none constraint prevents ambiguous links. No foreign key crosses into a source module.
6. A monthly Goal session validates the complete item array before inserting its header. It must
   contain each Active Goal in the employee/period exactly once. Risk requires text. Explicit support
   requires details and a real active recipient other than the actor. Normal health creates no
   actionable manager notification.
7. A quarterly Goal session similarly contains the entire Active set exactly once and is written in
   one manager transaction. The current health, optional attention and optional support adjustment
   are snapshots, not Goal approval. `department_only` permits a manager/administrator to complete a
   self-review; no reporting-line row is fabricated.
8. `finalize_goal_plan` serializes on the employee plan, checks optimistic version and sums formal
   Active allocation. The result must equal 100. Cancellation changes the plan to
   `reallocation_required`; completion retains its agreed weight as historical allocation.
9. `revise_lean_goal_version` is the only Active structural revision entry point. It requires a
   reason and records before/after/reason/actor/time. Draft and discussion edits continue through the
   candidate-version operation.
10. `complete_goal` requires one nonblank actual result per Active success measure plus a final
    summary. `cancel_goal` requires a reason. Both are terminal and deactivate requests, but they are
    never aliases in the UI. `close_goal` remains only a compatibility wrapper to cancellation.
11. The UI never presents averaged qualitative states or mixed success measures as overall Goal
    achievement. Exact numeric actual-versus-target values may be shown per measure; overall health,
    formal weight and milestone progress remain separate concepts.

## 43. v70 Team member workload detail projection

1. Resolve the requested person through the request-cached, RLS-bound Team roster. If the person is
   absent, return no drawer and do not treat a visible shared record as Team-person authority.
2. After roster validation, read that owner's workable Tasks once. Partition the result into Active
   non-routine work, non-routine backlog Available work, and overdue routine occurrences. Do not run
   a query per rendered row or read routine templates, whose management visibility is a different
   permission boundary.
3. Read only current Goal lifecycle rows and only the fields rendered. Goal query failure fails the
   Team detail read; it must not be presented as a truthful zero.
4. Derive disclosure totals from their arrays. “Overdue routines” means open occurrence Tasks with
   `work_class = routine_occurrence` and authoritative `is_overdue`; it does not mean templates,
   completed history, or future schedule.
5. Task and occurrence links append `task` to the selected-person Work URL. Closing Task Detail
   removes only the Task layer. Goal links carry the same Work URL as `from`; Goal Detail validates
   it with `safeReturnPath` before using it, so Close restores the person/filter and cannot redirect
   outside the application.
6. Detail rows expose no new mutations. Any controls inside the opened record continue to be
   derived from server/database capabilities, never from Team visibility alone.

## V69 — Team visibility and query rules

1. Derive the Team roster from active profiles satisfying `focus.can_view_user`. Do not infer Team
   permission from every row readable through `user_profiles_select`; that broader policy also
   exposes the viewer's reporting manager for name attribution.
2. Exclude the viewer's own row after the authoritative projection. Administrators receive all
   other active profiles. Managers and explicit viewers receive only the configured effective
   scope. `none` produces no Team rows.
3. Before grouping Available work, intersect task owners with the Team roster. A collaborator may
   read a shared task without receiving person-level Team visibility.
4. Aggregate workload and focus counts in grouped scans and join them to the roster. Do not execute
   one count subquery per metric per person.
5. Build task, focus, barrier and Goal owner indexes once when deriving attention. Do not repeatedly
   scan the full result set for every person.
6. Memoize repeated Team server reads only for the current React server request. RLS remains the
   authority on every new request and visibility changes revalidate Work.
7. Select the minimal Team task projection. Checklist, evidence, attachment and collaborator
   aggregates are loaded only on surfaces that render them.
8. Propagate authoritative Team read failures to the existing error boundary. Never convert a
   permission/query failure to an empty roster or false all-clear message.

## 44. v85 Operational Action disclosure presentation

1. Steps remain canonical data from `task_checklist_items`; the drawer summary derives only counts and
   current-viewer responsibility. It does not persist or infer another Next Action value.
2. The expanded Steps body renders the canonical rows directly. Removing a duplicate heading or
   instructional sentence does not change completion authority, readiness, evidence, dependencies or
   checklist-derived progress.
3. Written Updates remain the filtered, newest-first `task_updates` projection. A collapsed summary
   may expose only the count and latest timestamp; the update body is rendered once in the expanded
   list.
4. Spacing and wrapping are shared presentation rules. They introduce no database, RLS, API,
   notification, storage, audit or production-data mutation.

## 45. v103 reliable PDF attachment rendering

1. `GET /api/attachments/[id]?inline=1` remains the authenticated, RLS-bound byte source and records
   the attachment view before returning private, no-store content. The ordinary route remains the
   explicit download path.
2. PDF bytes are fetched same-origin and rendered to a canvas with a lazy-loaded PDF.js worker. The
   application does not iframe the PDF or delegate rendering to a browser plug-in, because browser
   download preferences can replace embedded documents with a grey Open placeholder.
3. Only one PDF page is drawn at a time. Page changes, responsive fit-to-width calculation and a
   bounded 75%–250% reader zoom rerender that page at device-pixel resolution capped at 2×.
4. Image preview keeps its short-lived Blob URL and revokes it on close. PDF rendering receives an
   in-memory copy of the authorised bytes and destroys its loading task/worker on close.
5. The renderer adds no database, migration, RLS, permission, notification or audit definition. It
   preserves automatic view logging, the explicit Download action in the attachment header and the
   safe MIME allowlist that excludes active content such as HTML and SVG. That action uses the
   ordinary authenticated route and retains the attachment's original filename.

## 46. v117 lean weekly decision digest

1. Build the employee exception set in priority order and deduplicate by source record. Completion
   changes, returned Routine decisions, action-directed Barriers, authoritative overdue/stale state,
   exceptional Available Work, and employee Goal actions may contribute. A task appears once.
2. Read the latest Routine outcome for each occurrence. `pending` removes that occurrence from both
   employee overdue and This week; `returned` places it in Needs attention; accepted/cancelled work is
   terminal. Do not derive this state from dates or display wording.
3. This week selects non-terminal Active Focus Tasks and generated Backlog Routine occurrences whose
   due instant falls in the current planning window, plus incomplete Shared contributions using item
   due date before parent due date. Ordinary Backlog and paused work do not become commitments; their
   exceptional cases belong in Needs attention.
4. Completed last week merges owned Task completions with `completed_contributions`, sorts by the
   canonical completion timestamp, caps output by preference mode, and links to Completed history.
5. Team aggregation starts from `preview_effective_visibility`, groups canonical signals by source
   owner, and keeps source titles out of the manager roll-up. Pending review, Barrier decision, Goal
   support/alignment, overdue count, and over-target workload are interventions, not performance data.
6. The subject count is derived from the complete uncapped exception and commitment sets. Hidden rows
   therefore cannot make the envelope claim an inaccurate all-clear.
7. Delivery claiming, unique period keys, retry backoff, SMTP/Inbucket sender requirements, stored HTML
   and text bodies, and terminal sent status remain unchanged.

## 47. v120 transactional notification-email delivery

1. An `AFTER INSERT` trigger on `notifications` copies the recipient identity and current email into
   `notification_email_deliveries` inside the notification transaction. A unique
   `notification_id` is the logical idempotency key. Inactive recipients create no delivery.
2. The worker selects eligible queued, retryable failed, or stale processing rows, then calls
   `claim_notification_email_delivery` for an atomic claim. Claims increment the bounded attempt
   count and recover after fifteen minutes if a worker disappears.
3. Rendering reads the canonical notification after claim. It escapes title/body/recipient content,
   removes subject-line control characters, creates matching text and inline-styled HTML, and maps
   the canonical `entity_type`/`entity_id` pair to the exact application route. Unsupported or
   unsafe link inputs fall back to the application home.
4. A successful transport records the rendered bodies and `sent_at`. A transport or render failure
   stores a bounded error and retry time. The notification itself is never deleted or rolled back.
5. Server Actions schedule the worker with Next.js `after()` only after a successful mutation. The
   request origin is used for those links. Cron and `worker:notifications` use `APP_BASE_URL` and
   provide the durable drain for SQL events, restarts, and relay outages.
6. The worker uses the existing explicit SMTP, Inbucket, or log transport contract. It never silently
   downgrades a partially configured relay and never exposes the service-role key to the client.
7. This mechanism follows actual notification rows. Preference or workflow rules that suppress a
   notification naturally suppress its email; transport code never makes an independent decision.

## 48. v153 governed calendar rescheduling

1. The Monthly Plan offers a drag only on an item whose `plan_events.can_reschedule` is true. The
   view computes it as the caller (`security_invoker`): false for routine occurrences, completed
   or cancelled work, review deadlines and meetings, otherwise `focus.can_edit_task`. It is a
   courtesy to the interface; the procedure decides again on every call.
2. A drop, and Move to…, call the `changeTaskDueDate` server action with the item's
   `task_version` as the expected version. That is the drawer's action, so authority, the
   closed-work refusal, the implausible-year guard and the `task_due_date_changed` audit event
   are shared rather than reimplemented.
3. A date-only commitment moves to the end of the new local day. A timed one keeps its
   organisation-local wall-clock time on the new day; the page derives that time in the
   organisation's zone, never the browser's.
4. The grid moves the item optimistically and marks it as saving. The server response either
   confirms it through the revalidated page or, on refusal, the item returns to its original day.
   A `version_conflict` also refreshes the calendar so the current date is shown.
5. Undo calls the same action back to the original date, quoting the version the move produced.
   It does not use `undo_event`: the audit trail records the move and the move back.

## 49. v154 Trackable Steps — a step's date holds

1. A step's `due_at` is either NULL, meaning the task's own date, or a date of its own. NULL is never
   filled in with a copy of the parent's date, so an inherited step moves when its task moves.
2. `focus.step_due_after_task(task, due)` is the one statement of the rule: a step's own date may not
   be after its task's due date, compared as organisation-local days (`focus.org_time_zone()`). A task
   with no due date constrains nothing; a completed step is never checked.
3. The rule is applied by the `task_checklist_items_due_within_task` trigger for every writer (Add step
   inserts under RLS), by `update_checklist_step` for a `validation_failed` sentence, and by
   `change_task_due_date`, which refuses to move a task earlier than an open step's own date and names
   the step. The trigger's exception carries the hint `step_due_after_task`; it is the only database
   message the application shows a person verbatim.
4. The parent's step list shows each open step's assignee and effective due date (its own, or the
   task's), "Overdue since" once it passes, and a finished step's finisher, date and evidence count, the
   evidence opening in the drawer's viewer. An evidence rule stays visible until it is satisfied.

## 50. v155 Trackable Steps — waiting on others

1. A delegated step is one assigned to anybody but its task's owner and not yet completed. Its date is
   its own, or the task's when it has none (§49), and it is late once that date has passed.
2. `task_overview` exposes `delegated_open_count`, `delegated_overdue_count` and
   `next_delegated_due_at`, the earliest date among the open delegated steps.
3. The Active card appends "N with others" to its step count, and a "Next contribution due" line only
   when that date falls before the work's own local due date. Once any delegated step is late, the
   count reads "⚠ N delegated step(s) overdue" and the next-contribution line is withheld.
4. `needsAttention` adds one `waiting_on_others` item per workable task with a late delegated step, so
   the My Day banner counts it. My Day's Waiting on others section lists up to three late steps from
   `shared_contributions` filtered to work the viewer owns, oldest date first, each opening its task.
5. The columns are read defensively: before the migration runs they are absent, the counts read zero,
   and Waiting on others is empty — the behaviour before v155.

## 51. v156 Trackable Steps — a calendar that knows about steps

1. `plan_events` has a fourth branch: one `step` row per open step assigned to anybody but its task's
   owner, dated by its own date or else the task's, on a task that is backlog, active or paused and
   not deleted. Every branch carries `step_id`, `assignee_id`, `assignee_name`, `parent_title`,
   `parent_due_at`, `step_has_own_date` and `steps_due_with_task`.
2. The page shows a step row to its assignee always. The owner, and a manager's Team scope, see it
   only when it has its own date on an earlier organisation-local day than its task's; every other open
   step due that day is counted on the task's own row as "N steps due".
3. Step entries are never draggable. They open `/work?task=<task>&step=<step>`; the page honours the
   step only when it belongs to that task, and the drawer opens its Steps section with the row marked
   and scrolled into view. `step` is a task-layer parameter, removed when the drawer closes.
4. A manager's calendar defaults to their own commitments; `scope=team` is explicit.
5. The step columns are read defensively: before the migration there are no step rows and the counts
   read zero, which is the calendar as it was.

## 52. v157 Trackable Steps — My Team sees the steps people owe

1. A person's row counts the open steps they owe on work somebody else owns — "3 shared steps" — after
   their own active work, and says "⚠ N assigned step(s) overdue" on a line of its own when any is past
   its date. A step's date is its own, or its task's when it has none (v154).
2. The expansion lists them under "Contributions to others", collapsed, with a count that says how many
   are late: the step, whose work it is for, its date or how late it is, and why it is held when the
   reason is not the person (the owner has not started, the work is paused, an earlier step is open).
   Late first, then by date. Each opens the work at the step (`&step=`, v156).
3. Both read `shared_contributions` as the viewer — the projection the assignee's Shared list and the
   owner's Waiting on others read. A step on work outside the viewer's visibility is neither counted nor
   listed, the rule the Completed split has followed for shared contributions since v87.
4. A failed read counts nothing rather than taking My Team down.
5. The overdue count on a row is red, as it was always meant to be, and only the count:
   `.summaryAlert` had lost to the more specific `.person span` and read as bold grey. "Missed" in the
   next-result cell had the same fault.
6. `shared_contributions` leaves out steps on binned or purged work, as `completed_contributions` has
   since v87. Before this, a step on work in the Bin stayed on the assignee's Shared list, the owner's
   Waiting on others and My Team.

## 53. v158 Trackable Steps — who is told what about a step

1. Assigned: unchanged in who and when (v44); the message gains " Due 10 Sep." — the step's own date,
   or its task's — and leaves it out when neither has one.
2. Overdue: `notify_overdue_contributions`, run by the daily scheduled job, sends the assignee one
   immediate, action-requiring notice per step and organisation-local day it was due ("It was due
   10 Sep."). Only open steps assigned to somebody other than the owner, on active, undeleted work, to
   active accounts. `dedupe_key` (`step_overdue:<step>:<day>`) is unique per recipient, so a second run
   adds nothing and a step given a new date and missed again is told again. The owner is sent no notice;
   Needs attention carries it (v155).
3. Completed: the owner receives one quiet, informational notice — "Completed by Amer Hakim." — unless
   they completed it themselves or the step was their own. It links to `/work?task=…&step=…`
   (`entity_type = 'task_step'`), the owner's view of the record rather than the assignee's Shared list.
4. Quiet means the bell only: `queue_notification_email` skips `notifications.quiet`. Every other
   notification still queues one email, as v120 requires.
5. Edits to a step's wording, date, evidence rule or dependency notify nobody; reassignment keeps its
   v44 notices.
6. The procedure is executable by the service role only. `p_task_ids` narrows a run to named work; the
   schedule passes nothing.

## 54. v159 Trackable Steps — your own steps, too

1. A step is the owner's own when it is assigned to them or to nobody. `plan_events` has a row for each
   of theirs that has a date of its own; an undated one is due with the work and counted on its row.
   Rows for steps handed to anybody else are unchanged. `assignee_id` names whoever owes the step — the
   owner, for an unassigned one.
2. The calendar shows a step handed to you on somebody else's work always, as "Shared step: …". Every
   other step — yours on your own work ("Step: …") or somebody else's ("↳ Amer Hakim · …") — is shown
   only when it is due before its work, or when the work has no date to count it on; in Team scope for
   anybody's, otherwise only on your own work. This supersedes §51.2.
3. `task_overview.own_step_overdue_count` counts the owner's open steps whose own date has passed;
   `next_own_step_due_at` is the earliest own date among their open steps. The Active card shows
   "⚠ N step(s) overdue" unless the work itself is overdue, and one "Next … due" line: the earlier of
   the owner's next step and the next contribution, each only when due before the work and when none
   on that side is late.
4. The Shared list marks a contribution past its date "Overdue since …". My Team's expansion marks
   active work with steps past their own date, whoever owes them, unless the work itself is overdue.
5. Every new column is read defensively: before the migration the card and the calendar are as they
   were, and My Team's signal reads zero.

## 55. v160 Trackable Steps — My Day knows about steps

1. Needs attention adds `step_overdue` — an open step of the owner's own past its own date, on workable
   work that is not overdue itself — and `contribution_overdue` — a step the viewer owes on somebody
   else's work, past its own date or its work's. The banner reads "N step(s) overdue" and
   "N contribution(s) overdue".
2. Coming up merges the work due in the window with the steps the viewer owes due in it, in date order
   and three at most: every contribution, and the viewer's own steps only when due before their work.
   Each step opens its work at the step.
3. Both read the `plan_events` step rows whose `assignee_id` is the viewer, to a month ahead. A failed
   read costs My Day these lines and nothing else.
4. The handoff band (section 13.3) counts only a ready step assigned to the viewer by somebody else. One
   they gave themselves, or one recorded before v146 without an assigner, does not make their own work
   a handoff.

## 56. v161 Trackable Steps — who is told when a step is the owner's

1. A step written for the work's owner, or moved to them, by somebody else tells the owner: "New step on
   your work", immediate and action-requiring, with its date, "Added by …" or "Assigned to you by …",
   linking to `/work?task=…&step=…` (`entity_type = 'task_step'`).
2. Not when the owner did it, not when there is no signed-in actor (the system), not to an inactive
   account, and not while the owner has an unread `ordinary_assignment`, `reassignment` or
   `ownership_changed` notice for the same work — that notice already tells them, and would otherwise be
   followed by one per step.
3. A step leaving a contributor tells them wherever it went: "Contribution reassigned" when it went to
   another contributor, as before; "Contribution withdrawn" when it went back to the owner or to nobody.
   Both are digest and informational.
4. The contributor notices themselves are unchanged. The trigger's audit event is unchanged — written
   for an assignment to somebody other than the owner — and `update_checklist_step` still records every
   edit, including the others.

## 57. v162 Completed work leaves the calendar

1. `plan_events` has no row for completed or cancelled work. Review deadlines were already limited to
   open work and step rows to open steps; booked discussions are unchanged. `can_reschedule` no longer
   needs to refuse completed work, because none reaches the calendar.
2. When work moves to completed, `tasks_notify_work_completed` tells `assigned_by` — "Work completed",
   `"<title> · Completed by <name>."`, `collaboration_handoff`, digest, not requiring action, `quiet`
   (no email, v158), linking to the work — unless nobody assigned it or its owner did, the assigner
   completed it (by `completed_by`, v150, or else the signed-in person), it is a routine occurrence,
   the assigner is the pending completion reviewer — "Completion review needed" already tells them — or
   the assigner's account is inactive. Reopening and completing again tells them again.

## 58. v163 A calendar that reads at a glance

1. Colour says what kind of entry it is and nothing else: a task is neutral, a routine occurrence soft
   green, a step soft lavender; a booked meeting is neutral with a dashed edge.
2. Each entry is its title and one line beneath it: the type, then at most one chip — "Overdue" (red)
   or "Review by" (amber) — and at most one fact: who owes a step ("↘ Amer"), the work a step you owe
   is part of, how many steps share a task's date, or in Team scope whose work it is. The full sentence
   is the entry's hover text and its accessible name.
3. A step is overdue on the calendar once its organisation-local date has passed.
4. The legend reads Type (Task, Routine, Step) and Status (Overdue, Review by, ↘ Assigned). Completed
   work is not on the calendar (v162).
5. The kind classes (`due`, `overdue`, `routine`, `review`, `discussion`, `step`) stay on every entry
   for behaviour and tests; only `is-task`, `is-routine`, `is-step` and `is-meeting` carry colour.

## 59. v164 A closed dialog leaves the caret alone

1. A dialog (`Modal`) returns focus to the element that opened it when it finishes closing, 200ms
   after it is dismissed — but only while the caret is still the dialog's to give back: inside the
   closing layer (the dialog or its backdrop), or held by nothing. If the person has put it
   somewhere else in the meantime, it stays there.
2. This is the rule the side drawer already follows (v138, v149). Without it, closing a dialog and
   opening a drawer inside those 200ms handed the drawer the dialog's trigger as its opener, and
   closing the drawer put the caret there rather than on the row that opened it.

## 60. v165 A department is a record

1. `departments` carries `parent_id`, `head_id` and `status` (`active`, `archived`). A null
   parent is the top of the organisation.
2. `create_department` and `update_department` are administrator-only. Both validate that the
   name is present, the code matches `^[A-Z0-9_-]{2,32}$` and is unique, and that a named parent
   or head exists; both write the before and after to the audit trail and the administrator
   security log as `settings_changed`, the enum having no department-specific event.
3. No department may be its own ancestor. `focus.assert_no_department_cycle` refuses it at any
   depth, with a 32-level cap, and `update_department` answers `parent_invalid` rather than
   raising the exception at the caller.
4. Archiving is refused while the department holds an active account or an unarchived
   sub-department. Archiving is not deletion, and it is not a way to make people disappear from
   the screens that assign work.
5. On `update_department` a null field means "leave it alone"; `p_clear_parent` and
   `p_clear_head` are how one is deliberately cleared. `update_user_profile` reads a null
   manager as "clear it", which is safe only because its form always submits the field.
6. A head is a name, not a grant. Visibility remains the per-person model of v66, v68 and v80;
   the organisation chart is not the security model.

## 61. v166 A drawer knows which row is its own

1. `SideDrawer` still returns the caret to whatever held it when the drawer opened, and still
   never takes it back from wherever the person has since put it (v138, v149, v164).
2. The body is not a trigger. Focusing it succeeds — `document.activeElement` really does become
   the body — so a drawer opened by its address restored onto nothing and reported that it had
   worked. The lookup rejects the body and the document element.
3. `returnFocusTo` names the `data-focus-return` value of the row a drawer belongs to, and is
   used when nothing meaningful held the caret at mount. The Goal drawer passes its goal; goal
   rows carry the marker, as Work rows already did.
4. Order of preference: the captured element while it is connected and meaningful, then its
   address (`data-focus-return`, then id, then href), then the row named by `returnFocusTo`.
5. The task drawer has the same gap and its rows already carry the marker; it is not yet passed.

## 62. v167 A person has a job title

1. `user_profiles.job_title` is nullable text, non-blank when present. It is descriptive: no
   policy, procedure or screen reads it for authority. Permission is `role`, sight is the
   visibility model, and management follows the reporting line.
2. `provision_user_profile` and `update_user_profile` take `p_job_title` last. Both were dropped
   and recreated rather than replaced: a new parameter creates a second overload, and PostgREST
   would then have two candidates for the same call. The grants were reissued with them.
3. On create, a blank title is stored as none. On update, null means "leave it alone" and blank
   means "clear it" — the form always submits the field, so emptying the box is a decision.
4. A change is written to the audit trail and the administrator security log as `user_updated`,
   carrying the before and after.

## 63. v168 Identity and access: Directory and Organisation

1. One heading, two tabs. `/more/admin/users` is Directory; `/more/admin/organisation` is
   Organisation. Both are administrator-only and 404 for anybody else.
2. Organisation never loads the whole company. `getOrganisationOverview` returns the departments
   (with head and size), the people at the top of the reporting line, and the count with no
   department; `getOrganisationBranch` returns one manager's direct reports, fetched only when
   a branch is opened.
3. Both tallies — reports per manager, people per department — come from one light pass over the
   active accounts rather than a count query per row.
4. An open branch lives in the URL (`?open=`), so the view survives a reload and travels in a
   shared link, and the page stays a server render that works without JavaScript.
5. `findOrganisationPeople` matches an active person on name, employee ID or job title and
   carries the chain of managers above them, root first. A cycle cannot hang the walk: the
   database forbids one, and the walk stops on a repeat regardless.
6. Archived departments are not listed. Deactivated accounts are not counted, drawn or matched.
7. Read-only: nothing here changes a reporting line, a department or an account.

## 64. v169 Changing a reporting line

1. `public.reporting_assignments` records every change: the subject, the previous and new
   manager, `effective_date` (defaulting to `focus.local_today()`), an optional reason, and who
   changed it, when. Append-only — update and delete are refused by trigger — and readable by
   administrators alone, like the rest of the audit record.
2. `change_reporting_manager(p_user_id, p_manager_id, p_reason, p_effective_date)` is the only
   writer. Administrator-only. `p_manager_id` null means the top of the line, stated rather
   than implied: this call is about the manager, so silence is not a value worth reserving.
3. Refused: somebody as their own manager, a manager whose account is deactivated
   (`manager_inactive`), and a line that would loop at any depth (`manager_invalid`, translated
   from the guard trigger rather than raised at the caller). A move that changes nothing
   answers `unchanged` and writes no history.
4. The profile update and the history row are one transaction, so a move cannot happen
   unrecorded, and the audit trail and administrator security log carry the before and after.
5. The screen never saves on a drop. Dragging navigates to the same confirmation the "Change
   manager" control opens, with the proposed manager filled in. The page is server-rendered and
   the control works without JavaScript; dragging is an enhancement over it.
6. A reporting line is still not permission. Moving somebody changes who manages them; what
   they may see remains the visibility model (v66, v68, v80).

## 65. v170 Departments from the Organisation view

1. `/more/admin/organisation?department=new` opens the create form and `?department=<id>` opens
   the edit form. Both are administrator-only, as the page is.
2. Create asks for the name, code, parent and head; edit adds the status. Both call the v165
   procedures and show their own sentence on a refusal rather than a translation of it.
3. The edit form always submits the parent and the head, so an empty choice is sent as an
   explicit clear (`p_clear_parent`, `p_clear_head`). The procedure reads a plain null as "leave
   it alone", which is right for a caller that omits a field and wrong for one that offers it.
4. The parent list leaves out the department itself; a deeper loop is refused by the procedure.
5. No schema change.

## 66. v171 Organisation issues

1. `getOrganisationIssues` reads people and departments once each and returns five lists:
   `unplaced`, `noDepartment`, `orphanedByDeactivation`, `noHead` and `inactiveHead`.
2. Unplaced is an active account with no reporting manager and no active direct report. No
   manager on its own is not an issue: it is the top of the line.
3. Orphaned by deactivation is an active account whose reporting manager is deactivated.
   An inactive head is an active department whose head is deactivated.
4. Deactivated accounts and archived departments are never listed as issues themselves.
5. The panel lists only the kinds present and opens one through `?issue=`; an unknown value
   opens nothing. Each entry links to its fix: Change manager (`?move=`) for somebody without
   a line, Edit (`?department=`) for a department, and the person's Directory page for a
   missing department, since the Directory maintains it.
6. Read-only. No schema change.

## 67. v172 One way to move somebody

1. `update_user_profile` hands a changed reporting manager to `change_reporting_manager`, so
   every move — from Organisation or from the Directory — is validated, recorded in
   `reporting_assignments` and audited by the one procedure that owns moves.
2. A null `p_reporting_manager_id` means "leave it alone"; `p_clear_reporting_manager` clears
   it. The Directory form always submits the field, so it sends the flag when "None" is chosen.
3. If the delegated move is refused, `update_user_profile` returns that refusal before writing
   anything else. The body is one block, so a later failure also rolls back a move already
   made.
4. The move is not repeated in `update_user_profile`'s own audit detail; the delegated call
   records it once.
5. The function gained a parameter, so it was dropped and recreated and its grant reissued.

## 68. v173 The dotted line

1. `user_profiles.functional_manager_id` holds the dotted line, and nobody can be their own.
   `reporting_assignments.relationship` is `primary` or `functional`, so both lines share one
   effective-dated history.
2. `change_functional_manager(p_user_id, p_manager_id, p_reason, p_effective_date)` is the only
   writer. Administrator-only; null clears the line. Refused: the person themselves
   (`manager_invalid`), a deactivated manager (`manager_inactive`), and their own reporting
   manager (`manager_is_primary`). A change that changes nothing answers `unchanged` and writes
   no history.
3. A dotted line grants no visibility. `focus.visible_user_ids` is unchanged, and sight of the
   person's work is granted, if at all, through the per-person visibility model (v66, v68,
   v80). The integration test proves it against a manager-role account that does see its
   formal reports.
4. `change_reporting_manager` clears the dotted line when the new reporting manager is the
   current dotted-line manager, in the same transaction, and records that ending with the
   reason "Became the reporting manager." Same signature; `update_user_profile` (v172) delegates
   to it and inherits the rule.
5. The Organisation row states the line in words. Its confirmation says the line grants nothing
   and does not offer the person or their reporting manager as choices. Dragging still draws
   only the formal line.

## 69. v174 Organisation import

1. The file is CSV, one row per person, with the columns `employee_id`, `name`, `email`,
   `department_code`, `job_title`, `manager_employee_id` and `functional_manager_employee_id`.
   `employee_id` is required, plus at least one of the last four. Headers are matched without
   regard to case, spaces or hyphens; other columns are named as ignored. Up to 2,000 rows and
   1 MB.
2. A column the file lacks is left alone for everybody. A column it has with an empty cell means
   none: no job title, the top of the reporting line, no dotted line. An empty department code is
   a problem, since everybody belongs to a department. `name` and `email` are never written; an
   email that differs from the Directory is a problem, because it means the employee ID points at
   somebody else.
3. `focus.plan_organisation_import` is the single planner. Each row is a change, unchanged, or a
   problem, and only its first problem is named. In order: no employee ID, an employee ID on more
   than one row (every such row), not in the Directory, deactivated, email mismatch, no
   department, unknown department, archived department, job title over 120 characters, reporting
   to themselves, unknown manager, deactivated manager, dotted line to themselves, unknown or
   deactivated dotted-line manager, dotted line to the same person as the manager.
4. A dotted line the row keeps from before that would point at its new reporting manager ends,
   and is recorded with the reason "Became the reporting manager.", as in section 68.
5. Loops are judged on the organisation as the file would leave it: the rows that passed, over
   everybody they do not mention. A row on a loop is refused as `circular`, and the walk repeats,
   because setting a row aside restores that person's current line. A line more than 64 levels
   deep is refused as `too_deep`, and only when no true loop was found.
6. `preview_organisation_import(p_rows)` returns every row with its status, its problem sentence
   or its changes in names, and the counts. It writes nothing.
7. `apply_organisation_import(p_rows, p_expected_changes, p_reason, p_effective_date)` locks the
   people the file names, plans again, and refuses with `plan_changed` unless the number of
   changes is the one the administrator was shown; the screen then checks the file again and
   shows the new answer. It writes every passing row in one transaction: first everybody whose
   reporting line changes lets go of it, then each takes their new manager, so a swap the cycle
   guard would refuse one row at a time is applied. Each change writes `reporting_assignments`
   rows for the lines that moved, an audit event and a security log entry.
8. Both procedures are administrator-only. The import does not create accounts.
9. `/more/admin/organisation/export` returns the active organisation in the import's columns,
   UTF-8 with a byte-order mark, and a leading apostrophe on any cell a spreadsheet would run as
   a formula, which the import removes again. Anybody but an administrator gets not found.

## 70. v175 People lists

1. The pickers that hand over ownership — the primary owner when assigning work, and the new
   owner when reassigning — show the viewer's direct reports first under "Your team", then
   everyone else under "Everyone else", each alphabetical. Direct means
   `reporting_manager_id`; a dotted line (section 68) does not count. With no direct reports,
   the list has no headings.
2. Who appears is unchanged: assignment offers the people the viewer may see, and
   reassignment the names-only `team_directory`. Only the order and the headings are new.
3. Lists of people are read a thousand rows at a time until a page comes back short
   (`readAll`), ordered by a unique key so no row falls between pages. This replaces fixed
   limits of 200 (assignment, reassignment, the team directory, goal employees and supporters)
   and 500 (the Directory), and the Organisation queries that asked for 2,000 rows from an API
   that returns at most 1,000. A failed page is reported as a failure, never returned as a
   shorter list.

## 71. v176 Both lines in the Directory, and their history

1. The Directory create and edit forms carry the dotted-line manager. It is written by
   `change_functional_manager` (section 68) after the profile is saved, and only when it
   changes; a refusal is reported as "Saved, except the dotted line" or, on create, as the
   account existing without it.
2. The same person on both lines is refused before anything is written. On edit, a dotted line
   left unchanged that matches a new reporting manager is read as ending, as every move ends it.
3. Manager selects include whoever the line points at now, deactivated or not, so an
   unrelated save cannot clear it through an option that is missing.
4. The person's page lists `reporting_assignments` for both relationships, newest first, with
   names. A date asked about is answered from the primary line: the change in effect by that
   date; before the first recorded change, the line that change replaced, said as such; with no
   record, only the line as it stands now. Two changes effective the same day are ordered by
   when they were entered.

## 72. v177 Department filter and search into the chart

1. `?dept=` narrows a search to one department, or with no search term lists the department's
   active people in full, with its head named and marked.
2. "Show in chart" opens every branch from the top of the line down to the person, and the
   person's own, and marks the person (`?focus=`), scrolling to them.

## 73. v178 Excel organisation files

1. An `.xlsx` file is read without a library: its zip directory, the first worksheet in the
   workbook's order wherever its part is stored, shared and inline strings, and numbers as
   Excel shows them. Formulas are read as their saved values and never evaluated; styles,
   merged cells and other sheets are ignored. Inflated content is capped at 40 MB.
2. The rows then go through the same reading as CSV (section 69): header matching, limits,
   blanks, and the formula guard, with the spreadsheet's own row numbers.
3. `.xls` and any other extension are refused with a sentence naming what to save instead.

## 74. v179 Choices that apply

1. A filter form containing `SubmitOnSelect` submits when one of its selects changes by pointer
   or touch. A change that follows a key press is held until Enter or until the select loses
   focus, so arrow keys step through options without navigating. The form's own button remains.
   Used on the Directory, Organisation and Records filter bars.
2. Visibility "Selected people" is never disabled. Ticking a person while the mode is "No team
   visibility" sets the mode to "Specific people only" with that one person; the hint says so.
3. Discussion invitations are checkboxes carrying the same participant ids.

## 75. v180 Assignment carries the New Work draft

1. `assign_work_to_people` takes `p_capture_id`. Given the caller's own pending draft, it sets
   the task's completion evidence rule and instruction and, when none is passed, its
   description from the draft; moves the draft's attachment rows onto the task, pointing at the
   same stored files; and resolves the draft as confirmed with the created task. Refused for
   somebody else's draft or one no longer pending (`not_found`), and for more than one owner
   (`validation_failed`).
2. New Work no longer discards the draft after assigning, which is what deleted the files.
3. Without `p_capture_id` assignment is unchanged, with evidence optional.

## 76. v181 Crawl findings

1. A My Team row is not a button. The name is a `button` with `aria-expanded` and `aria-controls`;
   a click elsewhere on the row toggles the same expansion unless it lands on a button, link or
   field. The row is read as its contents, and a decision button in it is its own control.
2. A table that scrolls sideways is a focusable, labelled region, and positions its rows' full-row
   links against itself, so nothing hangs past it. Workspace tabs never exceed the screen width and
   scroll within themselves.
3. Text in the brand navy uses `--heading`, which is the navy by day and the text colour at night;
   `--navy` remains a background. Links carry a colour of their own rather than the browser's.
4. Checked on every reachable page as an administrator, a manager and two team members, on both
   viewports and in Night mode and the largest text size: no error pages, no browser errors, no
   page wider than the screen, no serious accessibility violations; double submissions of New Work
   and updates create one record; another person's task is not readable by address or search.

## 77. v182 Session ended during an action

1. `requireProfile` without a signed-in, active profile redirects to
   `/sign-in?session=ended&next=…`, where `next` is the referring page on the same host, passed
   through `safeReturnPath`, and never the sign-in page itself. Route handlers that catch every
   error still answer 404.
2. The proxy does not redirect a server action (a POST carrying `Next-Action`) without a session:
   a redirect there answered a form with HTML the client cannot read. The action runs, finds no
   profile and redirects as above; without a session every query runs as anonymous and is refused.
3. A page request without a session redirects to `/sign-in?next=` with the full path and query,
   and none of the page's own parameters on the sign-in address.
4. The workspace and Goals error pages do not claim a failure was a read or that nothing changed.

## 78. v183 Touch targets

1. Below 700px every button, `.btn` link, text field, select and disclosure summary is at least
   44px tall. The rule is the last block in the stylesheet and names each competing selector,
   because the smaller sizes were declared later or more specifically than the mobile block.
2. The task age "i" keeps its 24-28px circle; its `::after` extends the touch area to 44px.
3. The check measures layout height (`offsetHeight`) on twelve pages across two roles, so a dialog
   still finishing its opening scale does not read short.

## 79. v184 Ask for an update

1. `request_task_update(task, step?, note?)` asks the work's owner, or the step's assignee (the
   owner when the step is unassigned). The asker never chooses the recipient.
2. What may be asked comes from `focus.update_request_targets`: open, unbinned, non-Quick-Action
   work and unfinished steps, whose recipient is active and not the viewer. The drawer reads it
   through `get_task_update_requests`; the procedure checks it before writing. The viewer must
   be able to see the work.
3. One open request per person per work or step. A second ask of the same person within 24
   hours is refused with `already_requested` and the time it becomes allowed. After that the
   same request is repeated: the note and time are replaced, and the previous notice is marked
   read.
4. The notice is immediate and requires action, so it is emailed from the outbox. It links to
   `/work?task=…&respond=update`, with `&step=…` for a step, which opens the composer.
5. A written (not evidence-only) update from the person asked, or from whoever can answer now,
   resolves every open request it can answer. It clears the recipient's notices, and each
   asker receives one emailed reply that quotes up to 300 characters. Completing a step
   resolves requests about that step and tells each asker, except one who completed it.
6. Completing, cancelling or binning the work resolves everything open. Reassigning the work or
   a step clears the previous recipient's notices, and the asker may ask the new person at
   once. Removing a step deletes its requests.
7. The link is text, not a button. On a phone its `::after` extends the touch area to 44px.

## 80. v185 Overdue work: counting and telling

1. Days late are calendar days between the due date and today in the viewer's zone
   (`calendarDaysSince`, `overdueDays` in `src/domain/duration.ts`). My Work, My Day, the task
   drawer, age chips, attention items and the weekly summary all use them. Work that passed a
   due time earlier today is overdue with no day count, and shows hours where a duration is shown.
2. `notify_overdue_work` runs in the daily scheduled job. It covers Active, Paused and Available
   work, not routine occurrences, that is past its due date and not yet recorded in
   `task_overdue_notices` for that due date. Each owner receives one notice per run: a single
   piece of work opens that task; several list up to three by name and open My Day. A new due
   date can be told about again. Rows are recorded even when the owner's alert is off.
3. The owner's overdue notice is marked read when the work is completed, cancelled, binned, or
   given a due date in the future.
4. `change_task_due_date` notifies, never the actor:
   - when the date moves later, the owner's reporting manager and the assigner, with the old
     and new dates, how many days late it already was, and the reason;
   - when anyone else moves it in either direction, the owner.
   A person in more than one role is told once. Bringing your own date earlier tells nobody.
5. These notices, and the step overdue notice, are sent only when the recipient's
   `due_today_and_deadlines` alert is on, which is the default.
6. My Team's person panel lists paused work with active work, late work first by earliest
   due date, and counts overdue Available work in the Not started summary.
