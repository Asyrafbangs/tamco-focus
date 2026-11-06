# Finding Management — the lean pass

Three screens: the employee's QR report, the ESH triage workspace, and the
assignment that follows from it. The test of all of it is twenty reports in a
working day, which is the number this module has to survive without becoming
somebody's full-time job.

Branch `esh/lean-intake-v293`. Nothing here deploys, opens or closes a channel
in production, touches production data or changes a secret.

## Before and after

|               | Before                                                                                | After                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Employee page | Lead paragraph, "You are at", five-row box, one-line privacy list promising anonymity | Pin and location with the reason it is known, three rows that grow, two photo buttons with marks, contact that accepts an extension, privacy that says what is true |
| Triage queue  | A list of rows; the only real action was a link to another page                       | Queue on the left, the report and the decision on the right, selection in the address                                                                               |
| Assignment    | Two-step wizard on `/findings/new?intake=`, the report no longer on screen            | One column beside the report: five decisions, everything the report answered folded away                                                                            |
| Finishing one | Save, land on the finding, navigate back to the queue                                 | **Assign & next** — confirmed by the server, then the next report                                                                                                   |
| Queue size    | "N reports waiting", where N was the page size                                        | What is actually waiting, and whether the page is showing all of it                                                                                                 |
| Provenance    | Form said _ESH inspection_; the database stored _observation_                         | Both say observation, which is what an employee's report is                                                                                                         |

### What was deliberately left alone

- Every validation rule, permission check, RLS policy and audit write.
- `esh_save_finding` and `esh_accept_report_intake` — the same procedures, the
  same payload, the same idempotency key.
- The two-step form for a finding ESH records itself. A walk-round inspection
  is not a triage decision and does not want the same screen.
- Escalation: the department-default summary and its editor already existed
  and are reused as they are.
- The evidence path in all four places, including everything v290 and v291
  fixed. No compression setting, size limit, scan state or retention rule was
  touched.

## The employee's page

Order, top to bottom: heading, where you are, the emergency warning, what you
saw, where exactly, photos, contact, send, privacy.

**Where comes before what.** The sticker already answered it, so the page
states it — a pin, the location, and "Location identified from QR code" — and
the form never asks for a department or a location it already has.

**Three rows, not five.** The box grows as it is typed into, to a limit. A tall
empty box reads as "we expect an essay" and pushes Send off a phone screen
before a word is written.

**Two photo buttons, each with a mark.** Camera and gallery were already two
buttons after v290; they now carry an icon apiece, because "Take photo" and
"Choose photo" are two words apart and one of them is the wrong one to press
while holding a phone in a noisy building. A chosen photograph gets a place on
the page immediately, marked _Preparing…_, because a re-encode of a full-size
frame takes a second or two and until now nothing appeared at all.

**Contact, not name.** "Contact for follow-up (Optional)", placeholder "Email,
phone or extension", and a plain text field — an extension is a perfectly good
way to be reached in a plant, and a field that insists on an email address
turns an optional question into a dead end.

**Privacy that the code can keep.** Three sentences were removed:

> "Nobody else sees it." · "nothing in the report identifies you: no account,
> no device, no location data."

A description can name the writer, a photograph can show a face or a badge,
and the sticker records which location the report came from. None of that
could be guaranteed, and somebody deciding what to write deserves to know it.
What replaced them says what is true, names the one thing the reader controls
— what they put in the description and the photos — and keeps the heading and
a single sentence visible with the detail behind a disclosure.

## The triage workspace

`/findings/intake` is now the queue and the decision on one screen.

**Left: the queue.** Status, evidence count, the opening of the report, where
and when. The selected row is marked. The header says how many are waiting —
the real count, and whether the list is showing all of it. The list reads at
most two hundred rows and now says so rather than reporting the page size as
the total.

**Right: the report, then the decision.** The employee's words, whole and
read-only, with where, when, the source and the contact beside them, and the
photographs with their real scan state. Then the five decisions ESH actually
makes:

1. **Accountable department** — suggested from the report's own location when
   it has one, and confirmed by a person. Where the sticker is and who is
   accountable are not the same question.
2. **Required correction** — the safe condition, in ESH's words.
3. **Action Owner** — an email address; no account, no registration.
4. **Risk** — the approved levels, chosen by a person. Nothing infers it.
5. **Due date** — the policy default where one exists, editable.

Everything the report already answered — the title, the description, where it
happened, evidence — is in **Report details**, collapsed, and opens itself if
one of its fields fails validation. Everything secondary stays in **Advanced
settings**, as it already did. Follow-up shows the department's default route
as one line with _Change route_ beside it, and the full editor only when there
is no default to apply.

**Selection is an address.** `?report=<id>` rather than client state: the back
button works, a report can be linked to, permissions are decided on the server,
and the queue and the decision cannot disagree about which report is in front
of you.

**Assign & next** saves, waits for the server to confirm, then moves to the
next report in the queue. If a photograph fails on the way, v291's rules apply
unchanged — the form stays, says what did not go up, and offers a retry that
cannot create a second finding.

**The other three decisions** — wireframe C's existing finding, not enough to
act on, no action needed — are the three server actions the queue has always
had, folded into disclosures under _Other decisions_. There is no "request
clarification" button, because nothing in the application can send one: an
anonymous report has nobody to ask, and a contact line is an address somebody
chose to leave rather than a channel this system writes to. What the screen
does instead is say whether there is anybody to ask, and hold the report while
somebody finds out.

## What the workspace needed underneath

- **`FindingForm` gained a `triage` variant.** The same fields, rules, defaults
  and server calls in one column instead of two steps. A small wrapper renders
  a card or the same contents behind a disclosure, so there is one copy of each
  field rather than two — a second copy is how two screens start disagreeing
  about what a finding needs.
- **Assigning claims the report.** `esh_accept_report_intake` refuses a report
  the coordinator has not claimed, which in the two-page flow was a separate
  button on a separate screen. A refusal telling somebody to press a button
  they cannot see is not a message, so a refusal of exactly that kind now
  claims and retries once. Nothing is loosened: the claim runs the same
  permission and scope checks and still refuses a report another coordinator
  holds — which the screen then says out loud.
- **Risk and urgency are read together.** A high or critical risk says, beside
  the choice, that the finding will show nothing protecting people until an
  immediate control is recorded. A severe risk left at normal priority says so
  too. Neither changes a value; both are sentences next to the decision.

## Two defects found while building this

**A `summary` styled `display: flex` does not open.** It is drawn as a
disclosure, reads as one to a screen reader, and does not toggle when clicked
in Chromium. Two shipped that way in this change — the privacy section and the
triage decisions — and a test caught them. Measured, not assumed: the same
element opens the moment its display is `list-item`. Layout now goes on the
children, never on the summary, and both specs assert that a click opens them.

**The public-reporting switch had no row to move.** v288 seeds
`esh_qr_intake_settings` from a migration that runs before any organisation
exists, so on every database built from these migrations the insert matched
nothing. `esh_set_qr_intake` requires exactly one row and resolves the
organisation from it, so an administrator's switch answered
`intake_not_configured` whatever they did, and public reporting could not be
opened at all. Production is unaffected only because its organisation predated
the migration. **v294** backfills the row and gives a new organisation one as
it is created, closed. This is the third control to ship unmovable here for
want of the row behind it.

A third, smaller one: the Today page put its three cards in three fixed
columns at any width above 720px, which at 768px is 148px each — narrower than
their own headings. The cards clip, so nothing scrolled and nothing looked
broken; the words were simply cut off. They wrap now.

## Does it actually save time?

Measured as interactions rather than minutes, for one straightforward report
with nothing to correct:

|                                   | Before                                     | After                  |
| --------------------------------- | ------------------------------------------ | ---------------------- |
| Page loads                        | 3 (queue → form → finding → back to queue) | 1, then one per report |
| Clicks before the first decision  | 3 (Claim, Review as Finding, Next)         | 0                      |
| Fields presented before assigning | 12 across two steps                        | 5, with 7 folded away  |
| Reading the report while deciding | Not on screen                              | On screen throughout   |
| Finishing and starting the next   | Back, find the next row, click             | One button             |

What did not get faster, deliberately: the risk assessment, the department
confirmation, the required correction and the due date. Those are the
judgements the module exists to record.

**The 60–90 second target is not claimed.** Nothing here measures a
coordinator's real working time, and the figures above are interaction counts
on local fixtures. It is a pilot target to measure, not a result.

## Tests

| Command                                                             | Result                                   |
| ------------------------------------------------------------------- | ---------------------------------------- |
| `npx tsc --noEmit`                                                  | clean                                    |
| `npx eslint … --max-warnings=0`                                     | clean                                    |
| `npx prettier --check`                                              | clean                                    |
| `npx supabase test db --local`                                      | **907 assertions across 40 files, PASS** |
| `esh-triage-workspace-v293`                                         | 4 passed                                 |
| `esh-public-report-lean-v293`                                       | 2 passed                                 |
| `esh-narrow-widths-v290` (320, 375, 430, 768, 1024 × Day and Night) | 2 passed                                 |
| `npm run verify`                                                    | see the final report                     |

New:

- **`esh-triage-workspace-v293`** — a day of 22 reports: the count is the real
  one, the selected report is the one the address names, there is no stepper,
  every disclosure opens, Assign & next accepts the report it is looking at and
  moves on, the finding carries `observation` provenance and the private-intake
  reference, two presses make one finding, a report another coordinator holds
  is refused with the right message and nothing is created behind their back,
  and somebody without triage authority never sees the workspace.
- **`esh-public-report-lean-v293`** — the sticker's location is stated and no
  department is asked for; the required field says so; an extension is accepted
  as a contact and stored; the privacy section no longer contains the three
  removed promises and does contain what replaced them.
- **`esh_qr_intake_settings_v294`** — every organisation has a switch, it is
  closed, one created later gets one too, and it is still only movable through
  its own procedure.

## Still outstanding

Unchanged from the remediation document, and none of it is settled by this
work:

1. **Production worker verification** — `npm run check:deployment -- --smoke`,
   run by somebody with the production credentials.
2. **Malware scanning** — no scanner configured; every file reads _Not
   scanned_. The residual risk on downloaded PDFs and Office files is accepted.
3. **Real phone testing** — camera and gallery behaviour on Android Chrome and
   iPhone Safari, including HEIC, is proven in emulation only.
4. **Who watches the QR queue** — named reviewer, backup, review frequency, and
   the site's own emergency instruction that the form points at without naming.

And two from this change:

5. **The 60–90 second pilot target** is unmeasured against real work.
6. **Notification delivery** is unchanged and still only as good as the mail
   transport: accepted by SMTP is not delivered, and the module says so rather
   than claiming otherwise.
