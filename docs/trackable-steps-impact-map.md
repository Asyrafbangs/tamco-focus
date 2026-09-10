# Trackable Steps impact map

## Requirement change

The Product Owner, 11 September 2026: a delegated Step was "almost only a
checkbox". Once assigned it became the other person's Shared contribution, and
the owner lost the planning layer — when that contribution is due, whether it
is late, and whether it is putting the task at risk.

The approved model: a Step stays a child of its task and is never duplicated
into a second task, but the moment it belongs to somebody it is trackable —
**assignee, due date, status, evidence and completion history**. One step
record, seen from three places: the parent task, the assignee's Shared list,
and My Team. Normal delegation stays quiet; late delegation comes to the owner
automatically. The same rules apply to anyone who may delegate a step within
their own work; only permissions differ.

## Previous behaviour

- A step had an assignee, an evidence rule, completion history and an optional
  `due_at` — NULL meaning "the same as the task" — but the parent's step list
  showed none of the dates, so a delegated step's deadline was invisible to the
  person it mattered to.
- Nothing stopped a step being due after its task, or a task being moved
  earlier than one of its steps.
- The Active card said "1/3 steps" and nothing about whose steps they were.
- Needs attention, the calendar and My Team knew nothing about steps.
- Step evidence already counted toward the parent's completion (v134), and
  delivery already kept owned work, shared contributions and routine apart
  (v150, §20). Both are kept as they are.

## Delivery, in stages

| Stage | Version | What it delivers                                                                                                                                                                                        |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | v154    | A step's date holds. The step list shows who owes each step and by when; Add step answers "Due" with the task's own date; the database refuses a step after its task and a task moved before its steps. |
| 2     | v155    | Waiting on others: "2 with others · Next contribution due" and "⚠ delegated step overdue" on the Active card; "Waiting on others" in Needs attention.                                                   |
| 3     | v156    | A commitment-aware calendar: the assignee's steps, the owner's delegated steps only when due before the task, step deadlines in Team scope, and the manager default of their own commitments.           |
| 4     | v157    | My Team: shared steps and assigned-step overdue in the person row; "Contributions to others" in the expansion.                                                                                          |
| 5     | v158    | Step notifications: overdue to the assignee; completion quietly to the owner; small edits silent.                                                                                                       |

## Stage 1 — v154, a step's date holds

- **Data model:** no new column. `due_at` NULL is the Product Owner's
  `due_mode = inherited` and is never back-filled, so an inherited step moves
  with its task by construction; a non-null date is `custom`. A second column
  would only have to be kept in sync with the first.
- **Rule:** `focus.step_due_after_task` — a step's own date may not be after its
  task's, compared as organisation-local days, so a step due on the 16th is not
  "after" a task due at 14:30 on the 16th. No task date constrains nothing; a
  completed step is never checked.
- **Enforcement:** the `task_checklist_items_due_within_task` trigger covers
  every writer, including Add step, which inserts under RLS;
  `update_checklist_step` returns the rule as a sentence;
  `change_task_due_date` refuses to move a task earlier than an open step's own
  date and names the step. That procedure is also the Monthly Plan's drag.
- **UI:** each step row reads "Amer Hakim · Due 10 Sep", the task's date when the
  step has none of its own, "Overdue since …" in red once it passes, and for a
  finished step "Amer Hakim · Completed 9 Sep · 📎 1", with the evidence opening
  in the drawer's viewer. Add step's **Due** is up front: **Same as the task ·
  16 Sep** (the default, linked) or **Its own date**, which the browser will not
  let pass the task.
- **Permissions/RLS:** unchanged. Who may add or edit a step is still who may
  edit the task.
- **Audit and notifications:** unchanged; a refused date writes nothing.
- **Tests:** `integration/step-due-v154` (the rule in all three places, same-day
  timed tasks, undated tasks, inherited steps following, completed steps never
  blocking); `e2e/step-due-v154` (the rows, the evidence opening in place, and
  Add step's default and limit, on desktop and phone).

## Compatibility and rollback

- Stage 1 is one forward-only migration,
  `20260911001000_v154_step_due_within_task.sql`: a function, a trigger, and
  two procedures reproduced from their latest definitions with a check added.
  No data is transformed.
- Existing steps that already break the rule are left alone until somebody next
  moves them or their task, and are then named.
- Rollback is a redeploy of the previous build plus, if wanted, dropping the
  trigger; the procedures' extra checks only ever refuse impossible dates.
