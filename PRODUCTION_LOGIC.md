# TAMCO Focus — Production Logic

**Current implementation baseline:** v30 user lifecycle, weekly digest, and task-age visibility  
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

### 11.4 v30 revision note

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


## V30 — Weekly email preference logic

1. Personal weekly summary preference is stored per user as a high-level mode: `off`, `focused`, or `standard`.
2. Manager team-summary preference is stored per eligible user as `off`, `leadership`, or `detailed`.
3. The email-generation job uses the high-level preference to choose a curated content set rather than exposing event-by-event notification controls.
4. Focused summary selects a shorter set of sections: wins, attention, due this week, and recommended starting point.
5. Standard summary selects the full personal sections: completed work, meaningful changes, attention, routine due, upcoming work, and recommended starting point.
6. Leadership summary selects manager sections emphasising team wins, barriers, overdue or stale work, focus-target exceptions, support needed, and upcoming commitments.
7. Detailed team summary may add more progress and completion coverage, but should still remain a management briefing rather than an exhaustive export.
8. Preview screens in the prototype are visual references; the production implementation must render the same information through a reusable email template system.

## V34 — Goal lifecycle, formal weighting, and milestone check-ins

1. Lifecycle filtering is presentation over authoritative Goal states: Active = `active`; For discussion = `draft` or `pending_discussion`; Completed = `completed` or `closed`; All excludes cancelled records.
2. Formal allocation and weighted Goal progress include Active Goals only. Formal weighted progress uses each active Goal's milestone-derived percentage and Goal weight.
3. `create_goal` and `agree_goal_version` retain their public signatures. V34 wrappers take an owner-scoped transaction advisory lock, sum the owner's other Active Goal weights, and return `invalid_target` before activation when the result would exceed 100%. Discussion saves are not subject to the formal limit. The renamed v33 implementations are not executable by client roles.
4. Current Goal progress is `round(sum(milestone progress × milestone weight) / sum(milestone weight))` over the active agreed version. The stored reported percentage remains retained history and is not shown as a second current value.
5. A milestone check-in initialises both controls from persisted progress. Slider and direct percentage entry use 5% steps; client movement remains explicitly unsaved until Save update succeeds.
6. `post_goal_milestone_checkin` composes the existing milestone-update and Goal-support operations in one database transaction. It stores prior/new milestone progress, required What changed, optional next/support context, milestone completion, evidence, audit data, and the existing actionable support notification. Any failed support operation rolls back the check-in.
7. Evidence metadata references the milestone update. Completing every agreed milestone transitions the Goal to Completed through the existing milestone operation.
