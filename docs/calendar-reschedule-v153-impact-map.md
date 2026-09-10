# v153 governed calendar rescheduling impact map

## Requirement change

The Product Owner asked for the Monthly Plan to "move freely like Outlook
calendar" and, given the choice on 10 September 2026, chose drag-to-reschedule
for task due dates only. A task's due date can now be dragged to another day, or
moved with **Move to…** beside it.

§17.3 still reads "It must not allow ungoverned drag-and-drop changes to due
date, ownership, or task state." It stands, and carries a dated amendment
recording the approval. What makes the new behaviour compatible with it is that
the change is governed, not that the rule was relaxed.

## Previous behaviour

- The Monthly Plan was informational. No item could be dragged and nothing on
  it mutated: §17.3 had been implemented as "no drag at all".
- A due date could be changed only in the task drawer — Edit due date, or the
  quick date field on a Quick Action.

## New behaviour

- A Due or Overdue item the viewer may edit can be dragged to any other day of
  the month shown. **Move to…** moves it to any date.
- Every move calls `changeTaskDueDate`, and through it `change_task_due_date`,
  quoting the version the calendar was drawn with. The authority check, the
  refusal of completed and cancelled work, the implausible-year guard and the
  `task_due_date_changed` audit event are therefore the drawer's own.
- The item moves at once and is marked as saving. A refusal puts it back and
  says why in plain words; a version conflict also refreshes the calendar, so
  the date somebody else just set is what is shown.
- **Undo**, for about ten seconds, is a second audited change back to the
  original date. The history reads "moved, then moved back".
- A timed commitment keeps its organisation-local time when it changes day.
- Routine occurrences, review and selection deadlines, and meetings stay fixed.
  Ownership and task state are never changed from the calendar.

## Impact

- **UI:** the grid moves into a client component, `PlanCalendar`, inside the
  unchanged server page. `CalendarItem` accepts drag handlers and is otherwise
  untouched. The Move to… dialog is modelled on the drawer's Edit due date. The
  page description mentions dragging only when something on it can move.
- **Desktop/mobile:** desktop drags with a mouse and reveals Move to… on hover
  or keyboard focus. Touch screens fire no HTML drag events and the mobile
  agenda hides empty days, so on a phone Move to… is always shown, at a 44px
  target, and is the way a date moves. The approved prototypes are unchanged:
  the change adds a control, not a layout.
- **Domain/state:** no new state or rule. Which items may move is the database's
  answer, not the interface's.
- **Data model:** `plan_events` appends `task_version` and `can_reschedule`. No
  table changes and no data is transformed.
- **Permissions/RLS:** `can_reschedule` evaluates `focus.can_edit_task` as the
  caller, through a `security_invoker` view, and is false for routine
  occurrences, closed work, review deadlines and meetings. It grants nothing:
  the procedure re-checks on every call. A collaborator sees a shared date and
  cannot move it; the owner's manager can, exactly as in the drawer.
- **Audit and notifications:** each move and each Undo writes
  `task_due_date_changed` with the previous and new dates. No notification is
  added — changing a due date in the drawer sends none either, and the two
  routes must not disagree.
- **Tests:** `integration/plan-reschedule-v153` — who is offered a move, the
  column and the procedure giving the same answer, a stale version refused,
  Undo audited as its own change. `e2e/plan-reschedule-v153` — drag and Undo
  landing in the database, keyboard Move to… with an axe scan, fixed items not
  draggable, a stale calendar refused and refreshed, and the phone route.

## Found while testing

The first accessibility scan of a Monthly Plan with items on it found two defects that predate
this change, both fixed here because they are in the component this change rewrites:

- **Contrast.** The owner line on the team calendar was faded to 78%, taking blue on its tint
  from 4.5:1 to 3.2:1, below the 4.5:1 small text needs. It is now full strength and kept
  quieter than the title by weight and position instead.
- **Structure.** The calendar was `role="grid"` with its cells directly inside the container,
  so it had no rows (38 `aria-required-parent` findings) and promised arrow-key navigation it
  never had. It is now a table of week rows; each row is `display: contents`, so the layout on
  both desktop and phone is unchanged.

Two defects in this change itself were caught before it shipped. A product one: the Undo button
shared its disabled state with the move's transition, which stays pending until the page refresh
lands, so Undo could not take focus at the moment it was offered; it now has its own. And a test
one: a task with audit events cannot be hard-deleted (`audit_events_no_delete` stops the
cascade), so the fixtures this change's tests move now fall back to the Bin instead of silently
staying live in later specs.

## Compatibility and rollback

- One forward-only migration, `20260910001000_v153_plan_events_reschedule.sql`,
  which replaces the view and appends two columns. Existing readers select by
  name or `*` and are unaffected.
- Deployment order does not matter. The application reads both columns
  defensively, so until the migration runs the calendar offers no drag — the
  behaviour it had before.
- Rollback is a redeploy of the previous build; it ignores the extra columns.
  Removing them would need a drop-and-recreate of the view and is unnecessary,
  since they grant nothing.
- No retraining. The Monthly Plan says "Drag a due date to another day to move
  it." wherever that is true.
