# TAMCO Focus — Production Logic

**Current implementation baseline:** v37 synchronized baseline — v34 Goals + v36 Next action + v36 Team Focus  
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
4. Focused summary selects a shorter set of sections: wins, attention, due this week, and recommended starting point.
5. Standard summary selects the full personal sections: completed work, meaningful changes, attention, routine due, upcoming work, and recommended starting point.
6. Leadership summary selects manager sections emphasising team wins, barriers, overdue or stale work, focus-target exceptions, support needed, and upcoming commitments.
7. Detailed team summary may add more progress and completion coverage, but should still remain a management briefing rather than an exhaustive export.
8. Preview screens in the prototype are visual references; the production implementation must render the same information through a reusable email template system.


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
