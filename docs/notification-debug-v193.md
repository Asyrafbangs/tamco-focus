# Notification and email debug — 17 September 2026

The user asked for the notifications and emails sent to every participant to be checked: the
right people, the right email, the right notice. This records what was checked, what was found and
what v193 changed. Production figures are aggregate counts from read-only queries, with no names or
work content.

## 1. Delivery: working

Over the last 30 days, every notice not marked bell-only has an email row, with one exception. The
notices without one date from 20–30 August, before email delivery was switched on.

- No delivery failed, and none is stuck queued.
- Every email was sent within a minute of its notice, including those raised by the 09:00 job. The
  Server Action dispatch reads only deliveries queued in the last five seconds, and has not missed
  one yet.
- No email went to an address that differs from the person's current profile.
- No notice went to a deactivated account.
- No notice went to the person who performed the action.

## 2. Recipients: right

Production events were reconciled against the notices each should have written, all since 31
August:

| Event                                                       | Events | Told |
| ----------------------------------------------------------- | ------ | ---- |
| Step assigned to somebody other than the owner              | 19     | 19   |
| Update requested                                            | 11     | 11   |
| Update request answered                                     | 2      | 2    |
| Completion review submitted                                 | 15     | 15   |
| Work assigned to somebody else                              | 9      | 9    |
| Step due day changed by somebody else (since v190)          | 1      | 1    |
| Work due date moved by somebody other than the owner (v185) | 1      | 1    |
| Step completed by a contributor (owner told quietly)        | 5      | 5    |

The one "missing" work assignment was work reassigned the next day: the first and the second owner
were each told.

A local replay of 20 events ran as the people involved. It covered assignment, reassignment, steps
added, handed on, re-dated, completed, reopened and removed, a barrier raised, answered and resolved,
update requests and answers, a due date moved, and work completed. Each event told the expected
people, and nobody was told about their own act.

## 3. Links: three faults, fixed in v193

1. **Notices re-pointed at a step.** `notify_contribution_created`, `notify_contribution_ready` and
   `notify_contribution_assigned` wrote their notice, then linked it with an update matching every
   unread, unlinked notice the person had on that work. An unread notice became a link to a step.
   Production held three such notices: a "Discussion scheduled", a "Work reassigned" and an "Over
   focus target".
2. **Links to work the person had lost.** "Work reassigned", "Contribution reassigned",
   "Contribution withdrawn" and "Contribution removed" said "Open task". The task could not be
   opened: My Work loaded with nothing on it.
3. **Barrier notices on work had no barrier link.** "Decision needed" opened the work with a Respond
   banner, not the decision form. "Barrier raised on your work", "Decision received" and "Barrier
   resolved" had the same gap. Only the resolution trigger ever linked them, and only for the owner.
   "Barrier resolved — review your work" said "Respond to request".

## 4. Noticed, not changed

- **One email per step.** Handing a person two steps sends two "New contribution assigned" emails,
  and two "Your contribution is ready" when the work starts. The morning job likewise sends one email
  per late or due step. This is the approved per-step design (v158, v190). Bundling per person and
  per work would be a product decision.
- **The `digest` channel is not a delivery rule.** Since v120, every notice not marked bell-only is
  emailed at once; `channel` only records the original intent.
- **Two personal settings are never read when sending.**
  - "Use quiet hours for non-critical reminders": nobody on Production has it on.
  - The daily brief mode and hour: every account is on the default "workdays", and no daily brief
    email exists.
