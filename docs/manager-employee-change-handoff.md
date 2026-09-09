# Manager and Employee Change — implementation handoff

Against `TAMCO_Focus_Manager_Employee_Change_Specification.md` (27 sections, 38
acceptance scenarios). This is the §27 deliverable: what changed, what the
database now holds, what was verified, and what was not.

Versions v140 through v151, shipped as seven commits between `a07dbc4` and
`92e2a11`. Every one passed all sixteen gates in `npm run verify` before it was
pushed.

---

## 1. What changed, for each role

### The manager

**A person opens in place.** The team-member drawer is gone. Clicking a
person's row expands them underneath it, with the rest of the team still on
screen — which is the comparison a manager came for and could previously only
do from memory. Name, whitespace and chevron are one control; "Keep open" holds
one person while another is read (§6, A01–A03).

**The dashboard above the list is gone.** Team / Not started / Completed are
three views of the same people; "Needs attention" is a filter inside Team
rather than a fourth destination (§3, §5).

**The focus target is gone entirely** — as a display, as a warning and as a
gate. "Major 1/1, Operational 6/5" counted items, and one Major Project, five
inspections and a training course are not the same size in any direction. With
it went the reason question before starting work, two attention rules built on
it (one of which outranked a barrier), the workload review panel and the
weekly email's "workload review needed" line (§3, §11).

**Delivery is attributed to whoever did the work.** Reassigning a finished task
no longer moves its completion into somebody else's history months later (§20).

### The employee

**Active answers before it lists.** What am I on, what did we agree this week,
then everything else — the last of which is a collapsed section carrying its
own count and overdue figure (§9).

**Work says why it exists.** Reactive work / Planned operations / Improvement &
development replaces the capacity classification as the word a row leads with.
Registration asks for it on the main New Work form, and it is correctable in
the task drawer (§11).

**A shared contribution names who asked for it** — the sixth of the six things
§10 lists, and the one that turns "the system decided this is yours" into a
request from a person who can also withdraw it (§10).

**A skip request can be taken back.** Somebody who marked an occurrence as not
required and then found the area open can withdraw and do the work, without
asking their manager to return their own request (§15).

**An occurrence keeps what it was generated with.** Editing a routine template
no longer rewrites what last month's completed occurrence says it required, and
seeing next month's inspection in Upcoming is not permission to sign it off
today (§14).

---

## 2. Screenshots

In `release-shots/`, captured from the seeded local fixtures — approved test
data, not production records. Desktop is 1280×1000, mobile 390×844.

| §25 row | File |
| --- | --- |
| Employee Focus Active | `{desktop,mobile}-employee-focus-active.png` |
| Employee task drawer | `{desktop,mobile}-employee-task-drawer.png` |
| Employee Shared | `{desktop,mobile}-employee-shared.png` |
| Employee Routine | `{desktop,mobile}-employee-routine.png` |
| Completion empty | `{desktop,mobile}-completion-empty.png` |
| Completion uploading/blocked | `{desktop,mobile}-completion-blocked.png` |
| Completion ready | `{desktop,mobile}-completion-ready.png` |
| Manager Team | `{desktop,mobile}-manager-team.png` |
| Manager expanded person | `{desktop,mobile}-manager-person-expanded.png` |
| Manager Not started | `{desktop,mobile}-manager-not-started.png` |
| Manager Completed | `{desktop,mobile}-manager-completed.png` |
| Skip review | `{desktop,mobile}-manager-skip-review.png`, `desktop-skip-awaiting-review.png` |

---

## 3. What the database now holds

Twelve migrations, all additive. No column, enum value or row of history was
removed; §11 asks for old values to be preserved for audit and downstream
compatibility and they are.

| Migration | What it adds or changes |
| --- | --- |
| `v140_explicit_current_focus` | `current_focus` table, its RPCs and the triggers that clear a selection when the work closes or moves |
| `v141_weekly_commitments` | `weekly_commitments`, its change requests and events, eight RPCs, and `weekly_commitment_overview` with a derived delivery outcome |
| `v141_current_week_helper` | `public.current_week_start()` |
| `v144_retire_focus_targets` | `activate_task` no longer gates on the focus target or demands a reason; deletes the `focus.reason_required_when_replacing` setting row |
| `v145_work_purpose_event_type` | `work_purpose_set` audit event |
| `v145_work_purpose` | `work_purpose` enum, the column on tasks / routine templates / work captures, the unambiguous backfill, occurrence inheritance, `set_work_purpose`, and `assign_work_to_people` accepting a purpose |
| `v146_shared_contribution_provenance` | `assigned_by` / `assigned_at` on checklist items with a trigger, and the two contribution views exposing the names |
| `v147_routine_exception_withdrawn_types` | `withdrawn` exception state and its audit event |
| `v147_routine_skip_withdrawal` | `withdraw_routine_exception`, the trigger that withdraws a pending request when the occurrence closes, and the guard that refuses a decision on closed work — **plus the cast that made `decide_routine_exception` work at all** |
| `v148_urgent_capture_audit` | the same cast in `confirm_work_capture`, **which had never created anything on the urgent route** |
| `v149_occurrence_snapshot` | `area` and `completion_opens_days_before` on templates; `routine_area` and `routine_completion_opens_on` on tasks; one inheritance trigger for everything an occurrence takes from its schedule; the completion window check |
| `v150_completion_attribution` | `completed_owner_id` and `completed_by`, frozen at completion and cleared on reopening |

### Three procedures that had never worked

Found while writing the tests §15 and §18 ask for. All three are the same
mistake, and none had a test:

1. **`decide_routine_exception`** (since v91) — every Accept and every Return of
   a "not required" request raised 42883 and rolled back. An uncast `case` over
   two literals resolves to `text`; `focus.write_audit` takes an
   `audit_event_type`.
2. **`confirm_work_capture`** (since the urgent route existed) — the same line,
   in the branch that only runs for `mandatory_operational_action`. So ordinary
   captures worked and **"Report urgent safety or compliance issue" silently
   created nothing.** The only existing test of that destination asserts a
   refusal and returns before reaching the audit call.
3. **`EvidenceDropZone.send`** awaited the upload without a catch. A refusal the
   action *returns* was handled; a connection that drops throws — and the row
   stayed on "Uploading…" for ever, with no Retry, no Remove, and a completion
   that could never be finished.

---

## 4. Verification against §26

`npm run verify` — sixteen gates, all passing: SQL syntax, schema executes,
secret scan, format, lint, type check, unit, production build, production
smoke, database reset, generated types match, RLS/database tests, integration
tests, reset before end-to-end, end-to-end tests, restore seed data.

Suite size: 175 end-to-end tests across 41 files, 209 integration tests across
27, 202 unit tests across 21.

### Covered by a named test

| ID | Where |
| --- | --- |
| A01–A03 | `e2e/person-expansion-v143` |
| A04 | `e2e/weekly-priorities-v141`, `e2e/current-focus-v140`, `e2e/employee-focus-v146` |
| A05 | `integration/weekly-commitments-v141`, `e2e/person-expansion-v143` |
| A06 | `integration/weekly-commitments-v141`, `e2e/weekly-priorities-v141` |
| A07 | `integration/weekly-commitments-v141` (baseline stands, supersede, refuse) |
| A09 | `integration/weekly-commitments-v141` (carry-forward explicit and linked) |
| A10 | `integration/weekly-commitments-v141` (delivered on task completion; a step delivers only the step) |
| A11 | `integration/current-focus-v140` (13 tests) |
| A12 | `integration/notification-email-v120`, `integration/task-shared-visibility-v56`, `integration/v46-attention` |
| A13 | `e2e/employee-focus-v146` |
| A14 | `integration/transactions` (activates past the target), `e2e/employee-focus-v146` |
| A15 | `integration/work-purpose-v145` |
| A16 | `e2e/completion-pattern-v133`, `integration/occurrence-snapshot-v149` |
| A17 | `integration/routine-skip-v147`, `e2e/routine-skip-v147` |
| A18 | `integration/completion-evidence-v134` |
| A19 | `integration/completion-evidence-v134`, `e2e/completion-pattern-v133` |
| A20 | `integration/completion-evidence-v134`, `e2e/completion-pattern-v133` |
| A21 | `integration/acceptance-gaps-v151` |
| A22 | `e2e/evidence-upload-v135` |
| A23 | `e2e/evidence-upload-v135` |
| A25 | `e2e/evidence-upload-v135` |
| A26 | `integration/transactions`, `integration/v46-attention`, `integration/v47-meeting-scheduling` |
| A28 | `unit/period` (whole local days; a window that does not move as the day goes on) |
| A29 | `integration/acceptance-gaps-v151`, `integration/completion-attribution-v150` |
| A31 | `integration/v45-collaboration`, `integration/v46-attention` |
| A32 | `integration/notification-email-v120` |
| A34 (null half) | `e2e/team-cockpit-v132` |
| A35 | `integration/task-bin-v57`, `integration/v52-lifecycles`, `integration/task-edit-v55` |
| A36 | `e2e/00-ui-parity`, `e2e/responsive-overflow-v118`, `e2e/drawer-focus-return-v138` |
| A37 | `integration/urgent-capture-v148`, `integration/v45-collaboration` |
| A38 | `integration/work-purpose-v145`, `occurrence-snapshot-v149`, `completion-attribution-v150` |

### Not fully verified — disclosed

| ID | Position |
| --- | --- |
| **A08** | Urgent work can begin regardless of the week (`integration/urgent-capture-v148`), and a commitment is never displaced — its outcome is read from the work, so nothing needs to be undone. The "traceable" half rests on the audit trail; there is no test that names A08. |
| **A24** | **Blocked by your decision to leave scanning as-is.** The allow-list, size and batch limits are enforced and tested — the new `tool.exe` case proves a real server-side refusal. There is no scanner, so `virus_scan_state` is not driven by one. §19 says to document the dependency rather than fake an accepted result; this is that disclosure. |
| **A27** | Evidence remains openable by authorised readers and storage is private. Not tested: that a storage object URL is unusable when unauthenticated, and there is no Office viewer — those files download, which §19 permits. |
| **A30** | Covered for person and aggregate URLs (`team-member-workload-v70`, `person-expansion-v143`). Not covered for storage object URLs. |
| **A33** | The person expansion is lazy and paginates its active list; completed reads are capped at 400–500 rows rather than paged server-side. No scale test exists, so behaviour with a large team is reasoned, not measured. |
| **A34** | The null half is covered. A legacy out-of-range date is rejected at capture, but existing historical rows carrying one are not flagged for review. |
| **A36** | Keyboard, mobile sizing and overflow are covered per route. Long filenames specifically are not asserted. |

---

## 5. Deployment

**Already applied to production** (`ypxbykvyjjtroyftzemi`): all twelve
migrations. `npx supabase migration list --linked` reports nothing pending.

For any future push:

```bash
npx supabase db push --linked
```

**Order matters.** Two migrations replace functions the running application
calls (`v147` for `decide_routine_exception`, `v148` for
`confirm_work_capture`). Both are backward compatible — the signatures are
unchanged — so either order is safe. `v145` drops and recreates
`assign_work_to_people` with an extra defaulted parameter; the previously
deployed client's nine-argument call still resolves, so there is no window
where assignment is broken.

**No configuration changes are required.** No new environment variables. The
`focus.reason_required_when_replacing` setting row is deleted by `v144`; the
admin settings page no longer offers it.

### Rollback

Every migration is additive, so **redeploying an earlier application build is
safe** — the extra columns are ignored by code that does not read them.

Reverting the *database* is a different matter and mostly should not be done:

- `v144`, `v147` and `v148` replace function bodies. Rolling those back
  reinstates the focus-target gate and both 42883 faults. There is no reason to.
- `v145`, `v146`, `v149` and `v150` add columns holding data that did not exist
  before. Dropping them loses the work purposes, the assigners, the occurrence
  snapshots and the completion attribution recorded since. If a rollback is
  ever needed, redeploy the old build and leave the columns in place.
- `v140` and `v141` add tables. The same applies: leave them.

The one destructive statement in the set is `v144`'s deletion of a single
settings row. Restoring it is one insert, and it would do nothing without the
gate it configured.
