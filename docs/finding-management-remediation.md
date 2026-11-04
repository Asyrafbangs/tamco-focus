# Finding Management remediation

One file, as asked. What the audit raised, what was true, what changed, what
was tested, and what is still somebody else's.

Branch `esh/remediation-v290`. Nothing here deploys, opens or closes a
channel, touches production data or changes a secret.

## What each audit item turned out to be

| | Item | Verdict |
| --- | --- | --- |
| A | QR status visible and accurate; intake errors not shown as empty | **Partly already there, partly confirmed.** The Today page already renders an error notice and a disabled counter when the intake read fails. The reporting status was wrong — see J |
| B | New-finding photo uploads skipped silently | **Confirmed. Fixed** |
| C | Compression inconsistent across the four evidence paths | **Confirmed for the new-finding path. Fixed** |
| D | Camera capture on mobile | **Confirmed for the public form. Fixed.** Already correct for staff since v199 |
| E | A failed monitoring query makes the app look healthy | **Confirmed. Fixed** |
| F | Scheduled jobs and notification delivery | **Needs production evidence.** See *Limitations* |
| G | Misleading empty states | **Already fixed** by v282, v283 and the Today page's own branches; one verification added |
| H | Malware scanning | **Already honest.** Risk restated, no scanner invented |
| I | Security regressions | **Already covered**, re-run |
| J | Hard-coded "public QR reporting is not enabled" | **Confirmed. Fixed** |
| K | Screen-by-screen UI audit | **Re-run against the real interface**, no new defects |
| L | Copy says "Copied" before the clipboard took it | **Confirmed. Fixed** |
| M | Interface complexity | **No change made.** Nothing was added that could be removed, and removing a working screen is not remediation |

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

The read now returns a *reading* — available or not — and an unavailable
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
access, and the page now says open, closed, or *could not be read*.

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
uploader has had since v199, with one handler behind them, and a *preparing*
state that refuses to send until the last re-encode finishes.

HEIC is unchanged and deliberate: it is refused with the setting to change
(Settings › Camera › Formats › Most Compatible), because nothing on the server
can decode it, so it could be neither stripped of its co-ordinates nor rebuilt
— and storing it as it arrived would quietly break the anonymity the form
promises. Converting it in the browser is not reliable enough to bet a privacy
guarantee on.

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
  file reads *Not scanned*, and the bucket is protected by the signature
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

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint . --max-warnings=0` | clean |
| `npx prettier --check .` | clean (CRLF noise aside — `autocrlf=true` here) |
| `npx vitest run --project unit` | **673 passed** |
| `npx supabase test db --local` | **902 assertions, PASS** |
| `npm run test:e2e -- esh-` | **98 passed** across desktop, tablet and mobile |
| `npm run test:e2e -- esh-crawl-v218` | 2 passed — the role × viewport × Night-mode crawl with axe and overflow checks |

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
- One existing assertion was corrected rather than loosened:
  `esh_qr_locations_v289` counted audit events across the whole database, so
  browser fixtures left behind by earlier runs made it fail for a reason that
  had nothing to do with the code. It now counts its own.

## Limitations

- **F — scheduled jobs and delivery cannot be proven from here.** Runtime logs
  on this plan cover 30 minutes, the migrations table is not exposed to
  PostgREST, and this session cannot read production. What *can* be read is
  `esh_worker_runs` through `npm run check:deployment -- --smoke`, which
  reports the last run and its outcome honestly. That command is the evidence;
  a successful deployment is not.
- **Real devices.** Android Chrome and iPhone Safari camera behaviour is not
  proven by emulation. The two-button shape removes the defect that was
  provable; the hardware path needs a phone.
- **Compression against real photographs** is still unmeasured. Every figure
  is from synthetic fixtures.
- **CI's end-to-end job** runs only on `main` or a dispatch, and was dispatched
  for this branch. Branch protection was not changed: the minimum effective
  configuration is to require the two always-on jobs and dispatch the browser
  job before merging, which is what has been done throughout.

## Human decisions, not invented

Public QR reporting is **open** in production for an *Office 1st Floor* pilot.
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
