# Stage 5a — an urgent notice does not wait behind the post

Stage 5 is named "Workflow hardening" in the tracker and has no written scope
anywhere in the repository — no row in the Stage 0 baseline, no acceptance
criteria, only "Migration deployed: if needed". So rather than invent features
for it, the workflow was audited for defects that are real, verifiable and need
no decision from anybody.

## Three things that were already hardened

Worth recording, because each was a plausible place for this stage's work and
none of it was needed:

- **The cron does not lie about its outcome.** `api/cron/route.ts` wraps each
  worker in its own `try`, returns 500 when any failed, writes a row through
  `esh_record_worker_run` so the Overview can say when the scheduler last ran,
  and logs worker names and outcomes without payloads. The "every cron run
  returned 200 while mail was broken" failure is already closed.
- **A reviewer who loses ESH access does not strand the work.** v199 and v201
  both select the reviewer through
  `focus.esh_user_can_coordinate(a.reviewer_user_id, a.finding_id)` as a
  rank-0 candidate with a fallback behind it, so a revoked reviewer is ranked
  out rather than leaving an action nobody can decide.
- **Email does not wait for the cron in the normal case.**
  `scheduleEshDispatch` drains the outbox in `after()`, once the server action
  has committed, with the cron as retry rather than as the primary path.

## The defect

`runEshOutboxWorker` selected candidates with three queries — queued, failed
and due, and stale processing — each taking the **oldest `limit` rows** of its
state, then merged them, sorted oldest-first and sliced to `limit`.

So a notice queued _after_ a backlog was excluded twice over: not fetched,
because each query takes the oldest rows, and sorted last if it had been. It
then waited for whichever drain came next — another user's server action, or
the daily cron at 09:00 local.

The backlog is reachable, not hypothetical. v224's bulk release loops over held
notices releasing up to its own limit in a single call, and v205's import does
the same; the post-action drain runs with `limit: 20`.

Two notices cannot tolerate that:

- **`evidence_infected`** — a file on a finding is infected and quarantined.
  Somebody has to stop trying to open it and decide whether to ask the owner
  for a clean copy.
- **`escalation_exhausted`** — the automatic route has run out of people to
  ask, so nothing further happens without a human.

Both are the system reporting that it cannot carry on by itself, which is the
one kind of message a day's delay makes useless. Everything else —
assignments, replies, reminders, digests — is ordinary post and keeps strict
oldest-first order.

**What this is not.** There is no `immediate_hazard` event type: the public QR
half is not built, so the baseline's "keep real immediate-hazard alert and
fallback separate from daily cron" is a constraint for when it is, not
something being violated now. The two notices above are the live victims.

## The fix, and why it has two halves

No migration. The urgent event types get their own queries, and the merge is
ranked by urgency before created_at, de-duplicated by id because urgent rows
also appear in the unfiltered queries.

Both halves are necessary, and each was removed on its own to show it:

| Break                                                    | Result                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| urgency dropped from the ordering, the row still fetched | the urgent notice is not sent — it sorts past the slice                          |
| the row no longer fetched, the ordering still ranking it | the urgent notice is not sent — no ordering can rank a row that was not selected |

`tests/integration/esh-dispatch-v198.test.ts` holds the proof against the real
local database: two ordinary notices queued first, then an infected-evidence
notice addressed to ESH exactly as v270 addresses it — a staff recipient, and
exactly one of the two recipient columns, which the table enforces. The worker
then drains with `limit: 2`, which is the production condition at a size a test
can state exactly, and the urgent notice must have been sent and left in
`provider_accepted`.

## Two defects in the gate run that preceded this

**A contrast failure I introduced.** The Patterns page puts a link inside
`.esh-link-note`, which is `--muted` so that it recedes; an unstyled anchor on
that colour fails contrast outright in Night mode, and the v218 crawl caught it
at mobile width — five nodes. `.esh-link-note a` now takes the same `--blue`
the row's own link uses, which passes on the same background at this size.

**A second gate run failed differently, and that one had evidence.**
`esh-foundations-v197` failed at mobile width because `/findings` rendered
`404 — This page could not be found`, inside the ESH shell, for a signed-in
coordinator. The preserved `error-context.md` showed the 404 headings; the gate
log showed why, four times:

```
[getEshAccess] unknown: An invalid response was received from the upstream server
```

— a gateway 502 from the local Supabase stack under the suite's load, the last
of them immediately before the failing assertion, and the same message on
`getCurrentWeekStart`.

The browser failure is environmental. The product defect it exposed is not.
`getEshAccess` returned `NO_ESH_ACCESS` whenever the access RPC errored, and
every Finding route turns that into `notFound()` — so a coordinator holding
every permission was told the page did not exist whenever the database could
not be reached. The statement is false, it is indistinguishable from being
disabled, and it is invisible to anybody not reading server logs.

`accessFromAnswer` now separates the two: an answer that _says_ no access still
returns `NO_ESH_ACCESS` and still 404s, so nothing is disclosed to a disabled
person, while a _failed_ read throws and surfaces as an error. Both still deny
access, so the module still fails closed — only what the reader is told has
changed. `getEshAccess` also retries once, because the failure this guards
against does not survive being asked again.

It lives in the domain layer rather than beside `getEshAccess`, because
`access.ts` is `server-only` and cannot be imported by a unit test — which is
itself why this had no coverage before.

`tests/unit/esh-access-answer-v282.test.ts` holds five assertions. Reverting
the throw to `return NO_ESH_ACCESS` fails exactly the three that require it,
and leaves the two fail-closed assertions passing, so the security property is
demonstrably unchanged.

**One failure I could not reproduce, and am not claiming to have fixed.**
`esh-evidence-v199` failed once, 24 minutes into the gate, with
`#guest-composer-problem` not found after submitting with no file. It passes
alone, and it passes with the CPU throttled 20× to widen the pre-hydration
window I suspected — Playwright's own actionability waits close that window
before the click lands. The gate's trace was overwritten by later runs before
it was read.

What was changed is defensive only: `openAsOwner` waited for hydration on the
access page and then navigated to the action page without waiting again, so it
was the one interaction in that file not preceded by a hydration check. That is
now consistent with the rest of the file. **It is not evidence of the cause**,
and if the failure recurs the trace should be read before anything else is
changed.
