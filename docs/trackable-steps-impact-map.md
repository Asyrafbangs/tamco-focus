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

## Stage 2 — v155, waiting on others

- **Data model:** `task_overview` appends the delegated counts and the next
  contribution date; `shared_contributions` appends `assignee_name`. Both are
  `create or replace view` with columns added at the end, reproduced from their
  latest definitions.
- **Active card:** "1/3 steps · 2 with others", with "Next contribution due
  10 Sep" only when a step is needed back before the work itself — a step that
  shares the task's date would repeat the date already on the row. A late step
  turns the line into "⚠ 1 delegated step overdue".
- **My Day:** a Waiting on others section lists the late steps by name, who
  owes each, how late, and the work it belongs to. It counts in the Needs
  attention banner. Nothing appears while delegation is on time.
- **Permissions/RLS:** unchanged. The owner already could read the steps on
  their own work; `shared_contributions` is `security_invoker`, and somebody
  with no part in the work sees neither side.
- **Tests:** `integration/waiting-on-others-v155` (the counts, a completed step
  leaving them, one record seen from both sides and neither by an outsider);
  unit tests for the attention item; `e2e/waiting-on-others-v155` (the card
  lines and My Day's entry, on desktop and phone).

## Stage 3 — v156, a calendar that knows about steps

- **Data model:** `plan_events` gains a fourth branch, one row per open step
  handed to anybody but its task's owner, and seven columns on every branch:
  what the step is, who owes it, the work it belongs to and that work's date,
  whether the step's date is its own, and — on the task's own row — how many
  steps are due that same day.
- **Who sees what:** the assignee always sees their own steps. The owner, and a
  manager's Team scope, see a delegated step only when its own date is earlier
  than the task's; the rest are counted on the task's entry ("3 steps due"),
  which is what keeps the calendar from turning into a list.
- **Opening a step:** step entries never drag. They open the task at the step —
  `/work?task=…&step=…` — with the Steps section open and the row marked.
- **Manager default:** their own commitments, with My team one click away.
- **Permissions/RLS:** unchanged. `plan_events` is `security_invoker`; somebody
  with no part in the work gets no step row.
- **Tests:** `integration/calendar-steps-v156` (the assignee's rows, the count on
  the task's row, nothing for an outsider, a completed step dropping out);
  `e2e/calendar-steps-v156` (Amer's calendar and the step link, on desktop and
  phone; the owner seeing only the early step and the count); the parity test
  updated for the manager default.

## Stage 4 — v157, My Team sees the steps people owe

- **Data model:** My Team reads `shared_contributions`, the projection the
  assignee's Shared list and the owner's Waiting on others already read, for
  everybody on the roster at once. The view now leaves out steps on binned
  work, which it never had — found by reading this section, where a step on a
  binned fixture was listed as still owed.
- **Row:** "N shared steps" after the person's own active work, and
  "⚠ N assigned step overdue" on its own line when one is late.
- **Expansion:** "Contributions to others", collapsed, late first. Each row
  names whose work it is for, its date or lateness, and why it is held when
  that is not the person's doing, and opens the work at the step.
- **Permissions/RLS:** unchanged, and deliberately so. The read runs as the
  viewer, so a step on work outside their visibility is neither counted nor
  listed — the rule the Completed split has used since v87.
- **Tests:** `integration/team-contributions-v157` (a report's step on visible
  work, dated and attributed; nothing on work outside the manager's tree;
  nothing on binned work; gone once done); `e2e/team-contributions-v157` (the row, the section and the step
  link, on desktop and phone).

## Compatibility and rollback

- Stage 1 is one forward-only migration,
  `20260911001000_v154_step_due_within_task.sql`: a function, a trigger, and
  two procedures reproduced from their latest definitions with a check added.
  No data is transformed.
- Existing steps that already break the rule are left alone until somebody next
  moves them or their task, and are then named.
- Stage 2 is `20260911002000_v155_waiting_on_others.sql`, two views with
  columns appended. The application reads them defensively, so either order of
  deployment is safe.
- Stage 3 is `20260911003000_v156_calendar_steps.sql`, `plan_events` with a
  branch and columns added. Before it runs there are simply no step rows.
- Stage 4 is `20260911003500_v157_shared_contributions_excludes_binned.sql`,
  the same view with two conditions added and no column changes.
- Rollback is a redeploy of the previous build plus, if wanted, dropping the
  trigger; the procedures' extra checks only ever refuse impossible dates.
