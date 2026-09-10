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
