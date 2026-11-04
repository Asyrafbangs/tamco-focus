# Finding Management remediation

One file, as asked. What the audit raised, what was true, what changed, what
was tested, and what is still somebody else's.

Branch `esh/remediation-v290`. Nothing here deploys, opens or closes a
channel, touches production data or changes a secret.

## What each audit item turned out to be

|     | Item                                                             | Verdict                                                                                                                                                                              |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A   | QR status visible and accurate; intake errors not shown as empty | **Partly already there, partly confirmed.** The Today page already renders an error notice and a disabled counter when the intake read fails. The reporting status was wrong — see J |
| B   | New-finding photo uploads skipped silently                       | **Confirmed. Fixed**                                                                                                                                                                 |
| C   | Compression inconsistent across the four evidence paths          | **Confirmed for the new-finding path. Fixed**                                                                                                                                        |
| D   | Camera capture on mobile                                         | **Confirmed for the public form. Fixed.** Already correct for staff since v199                                                                                                       |
| E   | A failed monitoring query makes the app look healthy             | **Confirmed. Fixed**                                                                                                                                                                 |
| F   | Scheduled jobs and notification delivery                         | **Needs production evidence.** See _Limitations_                                                                                                                                     |
| G   | Misleading empty states                                          | **One confirmed and fixed.** The review queue reported a failed read as "Nothing is waiting for verification"; the Today page and register were already honest                       |
| H   | Malware scanning                                                 | **Already honest.** Risk restated, no scanner invented                                                                                                                               |
| I   | Security regressions                                             | **Already covered**, re-run                                                                                                                                                          |
| J   | Hard-coded "public QR reporting is not enabled"                  | **Confirmed. Fixed**                                                                                                                                                                 |
| K   | Screen-by-screen UI audit                                        | **Two defects found and fixed.** The module switcher ran off a 320px screen; the department combobox could be shut for good by one early click                                       |
| L   | Copy says "Copied" before the clipboard took it                  | **Confirmed. Fixed**                                                                                                                                                                 |
| M   | Interface complexity                                             | **No change made.** Nothing was added that could be removed, and removing a working screen is not remediation                                                                        |

## The fixes

### E — a monitor that cannot be read is not a quiet one

`getOperationalHealth` returned `null` when the read failed **and** when there
was nothing to report, and the panel renders nothing for `null`. A monitoring
query that could not run therefore made Finding Management look healthy.

This is the defect class v282 and v283 removed from the access and finding
reads, left in the one place whose entire job is to say when something is
wrong. It is also not hypothetical: on 4 November I reported a production
scheduler as working on the strength of that panel being absent, and had to
withdraw the claim.

The read now returns a _reading_ — available or not — and an unavailable
monitor gets its own line saying that nothing on the page speaks for the
scheduled run, the mail queue or the escalations. Healthy, failed, late,
never-reported and unreadable are five distinct outcomes, each with its own
sentence.

### J and A — the Today page said reporting was off while it was on

"Public QR reporting is not enabled" was hard-coded. True when written; false
from the moment an administrator opened the channel, leaving the people
watching the intake queue told that nothing could arrive while the form was
live.

The page could not have done better. v288 gave `esh_qr_intake_settings` a
single select policy, for administrators, so the row is invisible to the
coordinators who triage what comes through it — a screen cannot report a state
it may not read. **v290** adds a policy for anybody with Finding Management
access, and the page now says open, closed, or _could not be read_.

### B and C — evidence discarded in silence, and twelve megabytes a picture

`attachStaged` had two bare `continue`s. A refused upload and an interrupted
one both fell through, and the form navigated to the finding as though
everything had attached. Evidence taken at the scene was lost without a word.

Each staged file now carries its own state — preparing, ready, uploading,
uploaded, failed — and its own reason. When one fails the form **stays** and
offers two honest choices: try again, or open the finding without them. The
retry attaches to the finding already saved, which is what makes it safe: the
form stops being one that creates a finding and becomes one that is finishing
it, so pressing twice cannot produce two findings. A file whose bytes never
arrived releases its agreed record, so a retry starts afresh.

The same change closes the compression gap. This path sent the camera's file
untouched while the owner, additional-evidence and public paths all shrink
first; it now uses the same `compressImage` and keeps the original beside the
copy as v271 does elsewhere. Saving is blocked while a picture is still being
prepared.

### D — the camera was the only option

The public form had one input with `capture="environment"`. On a phone that
does not mean "offer the camera"; it means the camera and nothing else, so
somebody who had already photographed the hazard could not send it. Two
buttons now — **Take photo** and **Choose photo** — the shape the staff
uploader has had since v199, with one handler behind them, and a _preparing_
state that refuses to send until the last re-encode finishes.

HEIC is unchanged and deliberate: it is refused with the setting to change
(Settings › Camera › Formats › Most Compatible), because nothing on the server
can decode it, so it could be neither stripped of its co-ordinates nor rebuilt
— and storing it as it arrived would quietly break the anonymity the form
promises. Converting it in the browser is not reliable enough to bet a privacy
guarantee on.

### K — what the widths nobody had opened were hiding

The configured browser projects are 1440, 1280, 1024, 768 and 390. An iPhone SE
is 375 and the oldest handsets on a plant floor are 320, so two of the widths
the audit asked about had never been opened. Both now are, in Day and in Night,
across every Finding Management screen and the public form — and each found
something.

**The module switcher ran off the screen at 320.** Its menu is 290px wide and
anchored `left: 0` to a summary that starts 54px in, so it ended at 344 on a
320px screen: the last quarter of "Finding Management" and of every description
sat outside the window, with no sideways scroll to reach it. The width cap added
at 720px could not help, because the anchor was what was wrong. Below 480px the
menu now belongs to the bar rather than to the summary and fits by
construction. (The rule it needed had been written for `.topbar`; Finding
Management's header is `.esh-topbar`, so it had never applied there at all.)

**The department combobox could be shut for good.** It opened on `focus` and
nothing else. A click that lands while the form is still hydrating focuses the
field natively, with no handler attached to notice — and every later click, on
a field that is already focused, fires no `focus` event at all. The list then
never opens again, and the only way out is to click somewhere else and come
back, which nobody discovers. It opens on click as well now.

That second one was found the hard way: a browser test reported that
"Operations does not exist" and the department list was empty, which looks
exactly like a permissions or data defect. It was neither. Reading
`aria-expanded` rather than the symptom is what separated them.

### G — the review queue was telling the same lie its own counter refuses to

`countAwaitingVerification` — the number beside the menu item — already refuses
to answer a failed read with zero. The comment above it says why, in as many
words: a count that says nothing is awaiting verification when it does not know
is "the same lie v282 and v283 closed".

The list underneath it did exactly that. `listVerificationQueue` returned an
empty array when its read failed, and the page renders an empty array as
**"Nothing is waiting for verification."** Its second read — the one that turns
submissions into register rows — did not look at `error` at all, so a failure
there produced an empty queue with nothing in the log either. Corrections
submitted by Action Owners would sit unreviewed while the screen said there was
nothing to review.

Both reads now go through `requireAnswer`, which is what the counter beside them
already does, so the page fails visibly instead of quietly.

The same `return []`-on-error shape remains in readers this assignment did not
touch: the departments in scope, the verifier list, the email contacts, the
escalation defaults, the hazard categories, the dashboards and the rollout
status. None of them states an absence as flatly as the review queue did, and
each needs its own judgement about whether to fail the page or mark the
section; they are listed here so the next person does not have to find them
again.

### L — "Copied" before the clipboard had it

Fire-and-forget: a browser that refuses clipboard access still reported
success while the address a sticker is printed from was not on the clipboard.
It now waits for the write, and when it is refused says so and asks the reader
to select the address instead.

## What needed no code

- **G.** The Today page already distinguishes "no reports" from "the queue
  could not be read", and the counter is disabled rather than showing zero.
  v282 and v283 did the same for the access and finding reads.
- **H.** Nothing has ever been called clean. With no scanner configured every
  file reads _Not scanned_, and the bucket is protected by the signature
  check, the pixel limits, the server-side rebuild of public photographs,
  private storage and five-minute signed links. The residual risk is
  unchanged: a staff member downloading an unscanned PDF or Office file opens
  it on their own machine. Hosting a scanner remains an infrastructure
  decision, and the worker refuses a remote scanner with no shared token.
- **I.** The existing suites cover the boundaries the audit lists — guest
  sessions and expiry (v198), evidence access (v199), verification (v200),
  identity and scope (v203), intake scope (v278), public reporting grants
  (v288) — and all of them pass.
- **M.** Nothing was added that could be removed. The one new control is a
  retry button that appears only when a photograph failed.

## Tests

Run on this branch, against the local stack:

| Command                              | Result                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------- |
| `npx tsc --noEmit`                   | clean                                                                           |
| `npx eslint . --max-warnings=0`      | clean                                                                           |
| `npx prettier --check .`             | clean (CRLF noise aside — `autocrlf=true` here)                                 |
| `npx vitest run --project unit`      | **677 passed**                                                                  |
| `npx supabase test db --local`       | **902 assertions, PASS**                                                        |
| `npm run test:e2e -- esh-`           | **CI: the whole suite green** on the branch; see _Limitations_ for this machine |
| `npm run test:e2e -- esh-crawl-v218` | 2 passed — the role × viewport × Night-mode crawl with axe and overflow checks  |

New regression tests:

- `esh-finding-evidence-retry-v290.spec.ts` aborts the storage upload
  mid-flight — what a plant floor's signal does — and holds that the form
  stays, the failure is legible, the retry attaches, exactly one finding
  exists, and the stored photograph is under half what was chosen with the
  original kept. Restoring the old "navigate anyway" behaviour fails it.
- `esh-health-reading-v290.test.ts` — seven cases over the five health
  outcomes and the three reporting states, including that the unreadable
  wording never reads as open or closed.
- `esh-public-reporting-v288.spec.ts` gained the two-button assertion.
- `esh-narrow-widths-v290.spec.ts` opens every Finding Management screen and
  the public form at 320 and 375, in both themes, and names the element that is
  too wide rather than only reporting that the page scrolls. Restoring
  `left: 0` on the switcher fails it.
- `esh-foundations-v197` gained a case holding that the department list opens
  on a click and not only on gaining focus. Removing the click handler fails
  it.
- `esh-review-queue-call-site-v290.test.ts` asks both of the review queue's
  reads what they do about an upstream 502, in the shape v284 established. Its
  two failure cases fail against the old behaviour and its two success cases
  pass either way, so it is not merely asserting that something throws.
- One existing assertion was corrected rather than loosened:
  `esh_qr_locations_v289` counted audit events across the whole database, so
  browser fixtures left behind by earlier runs made it fail for a reason that
  had nothing to do with the code. It now counts its own.

## Limitations

- **`check:deployment --smoke` was about to start failing for a correct
  deployment.** It asserted that public QR reporting is closed, which was true
  when it was written and false from the moment the channel was opened for the
  pilot on 4 November. A check that goes red for the state the owner chose is a
  check nobody reads — and this one is the only evidence anybody has that the
  scheduled run is working, which is item F's whole answer. It now reports the
  switch's state: closed is an `ok`, open is a `warn` saying reports can arrive
  and somebody must be watching. Not run from here: it needs production
  credentials this session does not have.
- **F — scheduled jobs and delivery cannot be proven from here.** Runtime logs
  on this plan cover 30 minutes, the migrations table is not exposed to
  PostgREST, and this session cannot read production. What _can_ be read is
  `esh_worker_runs` through `npm run check:deployment -- --smoke`, which
  reports the last run and its outcome honestly. That command is the evidence;
  a successful deployment is not.
- **Real devices.** Android Chrome and iPhone Safari camera behaviour is not
  proven by emulation. The two-button shape removes the defect that was
  provable; the hardware path needs a phone.
- **Compression against real photographs** is still unmeasured. Every figure
  is from synthetic fixtures.
- **Every field on the public form is controlled by React**, so anything typed
  before the page finishes hydrating is wiped when it does. In a production
  build that window is a fraction of a second, and somebody scanning a sticker
  spends longer than that reading the warning above the box; in development it
  is seconds, which is how four browser tests came to fail in a way that looked
  like the form dropping what it was given. It is not fixed here - making those
  fields keep what the browser already holds is a change to every form in the
  module, not to Finding Management - but it is why several specs now wait for
  the page before typing into it, and it is worth knowing before anybody
  reports that the first word of their report went missing.
- **This machine's development server loses races the production build does
  not.** Thirteen existing browser specs — the Action Owner's screens, the
  handover, the access directory — fail here by interacting before the island
  behind them has hydrated, and pass in CI against a production build. It is
  not fixture drift: they fail identically on a freshly reset database, a
  cleared build cache and a restarted server, and in isolation. Two helpers
  that open the owner's screen now wait for the page they land on rather than
  the one they left, which fixed four of them and costs nothing; the rest were
  left alone rather than papered over with sleeps, because the suite that
  decides whether this merges is the one that already passes. The underlying
  shape is worth knowing: on these pages a click or a file that arrives early
  is not queued or retried, it is simply never seen.
- **CI's end-to-end job** runs only on `main` or a dispatch, and was dispatched
  for this branch. Branch protection was not changed: the minimum effective
  configuration is to require the two always-on jobs and dispatch the browser
  job before merging, which is what has been done throughout.

## Human decisions, not invented

Public QR reporting is **open** in production for an _Office 1st Floor_ pilot.
These are deployment acceptance requirements and remain unanswered:

1. The **named primary reviewer** of the intake queue.
2. The **backup reviewer**.
3. The **review frequency** — the queue is not watched by anything automatic.
4. The **emergency escalation arrangement** the form points at without naming,
   and confirmation that it is stated beside the sticker.

Until those are answered by a person, the pilot is open without an owner.

## Production readiness

These changes are safe to deploy: they add one permissive select policy, make
three screens honest about states they previously misreported, and make one
upload path recoverable. Nothing weakens a permission check, and the full
local suite plus a dispatched CI run cover them.

They do not make the module production-ready on their own. That still rests on
the four decisions above and on F's evidence.
