# Deadline attention impact map

## Requirement change

The Product Owner, 15 September 2026: make **overdue and due-soon visibility
first-class**, with one warning window, and notify around delegated steps
without turning the product into a notification machine.

> **Overdue** = already late. **Due soon** = due within the next 5 days.
> **Normal** = more than 5 days away. The same rule for Tasks and Steps.

- **My Day** warns about late work and work entering the next 5-day window.
- **My Work** shows the same status in the context of all commitments.
- **Calendar** shows where those commitments sit in time.

Decisions confirmed by the Product Owner on the same day:

- My Day's Start here card, Next up, Waiting on others and Coming up are
  **replaced** by one summary line and the Overdue and Due within 5 days
  sections. The first overdue card is where you start.
- The due-tomorrow reminder to a step's assignee goes to the **bell and by
  email**.

## The rule

| State    | When                             | Label                                   | Weight            |
| -------- | -------------------------------- | --------------------------------------- | ----------------- |
| Overdue  | the due instant has passed       | `Overdue 3 days` · `Overdue` on the day | red, ⚠            |
| Today    | due on today's local date        | `Due today`                             | stronger amber, ! |
| Tomorrow | due on tomorrow's local date     | `Due tomorrow`                          | stronger amber, ! |
| Soon     | due in 2 days up to the window   | `Due in 3 days`                         | quiet amber, !    |
| Later    | due after the window, or undated | `Due 28 Sep`                            | plain             |

- Days are calendar days in the viewer's zone (`calendarDaysSince`, v185).
- The window is the organisation setting `day.upcoming_window_days`, shown as
  the **attention window**. The default is **5**. It was 7 and meant only "how
  far ahead My Day's Coming up looks". There is no per-person override.
- Sort order wherever work is listed by urgency: overdue, today, tomorrow,
  due soon, later, then by date.

## Previous behaviour

- A date read as a date everywhere except overdue ("Overdue 2 days", or
  "Overdue since 13 Sep" on a step). Nothing said a date was close:
  due tomorrow read "Due 16 Sep".
- My Day had Start here, Next up (ranked, not dated), Waiting on others (late
  delegated steps only), Coming up (7 days, three items) and a workload strip
  that repeated the overdue count.
- My Work's Active card said "⚠ 1 delegated step overdue" once a step was late.
  Before that it showed "Next contribution due 10 Sep" only for a step due before
  the task.
- Shared listed contributions by state and position, not by urgency.
- My Team's row counted overdue work; nothing was due-soon.
- Step notifications (v158, v161):
  - assigned: the assignee is told;
  - overdue: the assignee is told, and the owner is not;
  - completed: the owner is told quietly;
  - small edits, including a step's date, tell nobody.
- Task notifications (v185):
  - overdue: the owner is told;
  - a later date: the manager and assigner are told;
  - a date moved by someone else: the owner is told.

## Delivery, in stages

| Stage | Version | What it delivers                                                                                                                                                                                                                                                         |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | v187    | One deadline language. The attention window setting defaults to 5 days. Relative labels and urgency weight on My Work, Shared (sorted by urgency), step rows, the task drawer and My Team's panel. A delegated step due soon surfaces on its parent.                     |
| 2     | v188    | My Day becomes the action view: the summary line, then Overdue and Due within N days. Tasks, steps you owe and routine occurrences each appear once, and a parent's own and delegated steps fold into its card.                                                          |
| 3     | v189    | My Team inherits the rule: "⚠ 1 overdue · ! 2 due within 5 days" on the row, and the same two sections at the top of a person's expansion, including their shared steps.                                                                                                 |
| 4     | v190    | Step notifications per the approved table: due-tomorrow reminder to the assignee; overdue to the assignee and the parent owner; reopened and materially re-dated to the assignee. Delivered after v186 (My Alerts honoured) lands, and built on its `focus.alert_is_on`. |

## Stage 1 — v187, one deadline language

- **Domain:** `src/domain/deadline.ts` has `deadlineFor(dueAt, …)`, which
  returns the tone, the calendar days and the long and short labels, and
  `deadlineRank` for sorting. Every surface renders a tone through one
  `DeadlineLabel` component, so the ⚠ and ! glyphs and the colours cannot drift.
- **Setting:** `day.upcoming_window_days` becomes the attention window. A
  migration moves the value from 7 to 5 only where it still holds the original
  7, and rewrites the description. The code default is 5.
- **My Work:** the row's date slot uses the label and tone. The steps line
  says:
  - "⚠ 1 delegated step overdue", unchanged;
  - "! Delegated step due tomorrow" when the next contribution falls inside the
    window, whatever the task's date, because someone else owes it;
  - "! Your step due in 2 days" for the owner's own step, only when it is due
    before the task.
    Beyond the window the existing "Next … due 10 Sep" stands.
- **Shared:** each row carries the step's label and tone, sorted by urgency.
- **Steps (drawer):** "Amer Hakim · Due in 2 days", "· Due today",
  "· Overdue 1 day", replacing "Overdue since".
- **Drawer status line:** relative inside the window. Overdue reads
  "Overdue 3 days · due 12 Sep". Later work keeps its full date.
- **My Team panel:** active and not-started rows and contributions use the
  label, with late work first, then due soon.
- **Calendar:** unchanged. It already marks today and overdue, and the
  Product Owner asked it not to become an urgency heatmap.
- **Data model / RLS / audit / notifications:** none, apart from the settings
  row.
- **Desktop and mobile:** the same components. The labels are short enough for
  the 390px rows.
- **Tests:**
  - unit: `deadline` covers every tone boundary, date-time work, zones and the
    window setting;
  - e2e: labels and weights on My Work, Shared ordering, step rows and the
    drawer on both viewports.

## Stage 2 — v188, My Day is the action view

- **Replaced:** Start here, Next up, Waiting on others, Coming up, and the
  overdue count in the workload strip.
- **Kept:**
  - requests waiting on you (barrier decisions and approvals);
  - the goals strip;
  - the workload strip's active and available links;
  - "without a recent update".
- **Summary line:** "2 overdue · 3 due within 5 days", or "Nothing overdue ·
  2 due within 5 days", followed by any other exception kinds that apply, such
  as "1 barrier needs a decision".
- **Cards:**
  - your open work (Active, Paused, Available), overdue or inside the window;
  - shared steps you owe, overdue or inside the window;
  - routine occurrences, overdue or inside the window, the nearest per routine;
  - quarterly goal discussions inside the window, which Coming up used to hold.
- **One problem, one card:**
  - a task of yours carries its own steps and delegated steps as lines
    ("• Your step overdue", "• Waiting on Amer · overdue 2 days");
  - it sits in the section of its most urgent signal;
  - a task that is not itself due soon appears when one of its steps is.
- **Order:** within a section, by urgency, then date.
- **Empty:** "Nothing overdue, and nothing due in the next 5 days", with a
  link to My Work.

## Stage 3 — v189, My Team

- **Row:** "⚠ 1 overdue · ! 2 due within 5 days" in place of the bare overdue
  count. It counts owned work and the shared steps the person owes.
- **Expansion:** "Needs attention" with Overdue and Due within N days at the
  top, then the existing sections unchanged.
- **Data:** the team attention read gains a due-soon count against the
  organisation window, computed where the overdue count already is.

## Stage 4 — v190, step notifications

| Event                 | Step assignee                                                                                            | Parent owner                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Assigned              | told immediately (exists)                                                                                | nothing when they assigned it (exists)                              |
| Reassigned            | old and new assignee told                                                                                | activity only                                                       |
| Due within the window | on My Day and Shared (stages 1–2)                                                                        | the parent card shows the delegated step due soon (stages 1–2)      |
| Due tomorrow          | one reminder, bell and email                                                                             | nothing                                                             |
| Overdue               | told, once per due date (exists)                                                                         | **told**, once per due date: "Waiting on Izzul · … · 1 day overdue" |
| Completed             | nothing                                                                                                  | told quietly (exists)                                               |
| Evidence uploaded     | nothing                                                                                                  | nothing                                                             |
| Reopened              | **told immediately**                                                                                     | activity only                                                       |
| Due date changed      | **told** when the effective date moves by a day or more, including an inherited step when its task moves | activity only                                                       |

- Nobody is told about their own action.
- An owner who is also the assignee's manager receives the owner's notice only.
- Everything honours "Due-today and selection deadlines" in My Alerts.
- **Supersedes:**
  - v158's "the owner is not sent a notice" for overdue steps;
  - v158's "small edits to a step's date tell nobody".

## Migration and compatibility

- **Stage 1:** a settings value (7 to 5) and its description. No other data
  changes.
- **Stages 2–3:** read-model only.
- **Stage 4:** new notification kinds or dedupe keys in their own enum
  migration.
- **Rollback:** each stage is forward-only. Restoring the window to 7 is a
  settings change, and no earlier stage depends on a later one.
- **Communication:** people will see relative dates and a new My Day. The
  changelog entries say what moved where.
