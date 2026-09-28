# Test strategy

## Layers

- Unit tests exercise pure classification, focus, prioritisation, duration, and weekly-window logic without services.
- SQL execution checks apply every migration and seed to an isolated PostgreSQL-compatible engine and exercise schema behaviour.
- pgTAP tests prove RLS and denial properties against local Postgres.
- Integration tests use real local Auth sessions, PostgREST, Storage, procedures, and service-role worker paths. They do not mock the database.
- Playwright runs the same application at desktop and mobile viewports. Critical journeys include Axe WCAG A/AA scans.
- The production build and generated-type comparison catch server/client boundary and schema drift.
- The production smoke test starts the compiled server and verifies sign-in, security headers, and protected-route redirects against the built output.

## Critical properties

The suite prioritises denial and invariants: anonymous access, view without edit, deactivated sessions, append-only audit, private attachments, stale-version conflict, idempotency, evidence-required completion, guarded deletion, audited settings, effective visibility, worker duplicate prevention, and routine-generation idempotency. Goals add reported-versus-derived progress separation, five-percent steps, manager-only setup/agreement, pending-version isolation, milestone-completion semantics, support notifications, Goal evidence privacy, and linked-work independence.

## Commands

```text
npm run check:sql
npm run check:schema
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run db:reset
npm run db:types:check
npm run db:test
npm run test:integration
npm run test:e2e
npm run build
npm run test:smoke
npm run verify
```

`verify` is the release gate. A database-dependent skip is not a pass; the command exits non-zero when Docker is unavailable. Tests are serial where they share retained seed history, and browser retries are disabled locally so flakiness is visible.

## Fixture policy

Seed users and records are explicit local fixtures. Integration setup resets the database once because audit retention correctly prevents ad-hoc cleanup of historical records. A mutating browser test must create a uniquely named record instead of borrowing a canonical seed record that a later test reads; audited fixtures remain until the next reset, while unaudited read-only fixtures may be deleted in `finally`. Test identities, passwords, and content must never be copied to a hosted environment.

The canonical v33 fixture is Safety Digitalisation with five milestones and deliberately divergent progress (20% reported, 19% derived). A second coaching Goal exercises manager summaries. `npm run db:seed:goals` is an idempotent, non-destructive local backfill for databases seeded before v33; it does not replace the canonical reset-and-seed gate.

## v69 Team regression coverage

The pgTAP suite asserts the Team workload/focus projection under administrator, manager,
explicit-only and no-visibility identities. `team-visibility-v69.test.ts` repeats the boundary
through real Auth/PostgREST clients and proves an administrator rule change takes effect
immediately. `team-visibility-v69.spec.ts` verifies the rendered administrator roster includes
Izzul, keyboard/Escape/focus-return behavior works, responsive layouts do not overflow, and a
shared task does not promote its unauthorised owner into Team Available work. Existing Team context,
attention, Available work and User Directory specs remain regression gates.

## v53 critical properties

`execution-goal-v53.test.ts` runs against real Auth/Postgres and covers Task terminal projection
cleanup, Mandatory authority, state-stable reassignment, Shared recalculation, generic source
constraints, proposal discussion, aggregate monthly/quarterly uniqueness, pre-write session
validation, manager self-governance, exact plan finalisation, shared Goal support, Response versus
Resolution, terminal Goal outcomes and audited Active revision. The pgTAP suite adds plan/session
read and direct-write denial. Playwright verifies the aggregate Goal session UI, truthful measure
presentation, Major Project decision drawer, responsive containment and accessibility.

## v70 Team member workload detail coverage

`team-member-workload-v70.spec.ts` creates and removes its own unaudited Izzah Available Task and
uses canonical routine/Goal fixtures to verify that the disclosure renders named records; displayed counts
match the rendered lists; keyboard and pointer selection open exact records; Task and Goal Close
restore the person layer; and the 390 px project has no horizontal overflow. A direct unauthorised
person parameter is also tested to ensure neither the person nor their record titles are rendered.
Unit coverage rejects absolute, protocol-relative, and backslash-normalised external return paths
before Goal Detail can use them for layered Close navigation.

The E2E gate builds its own `.next-e2e` production output and serves it with `next start`. It does
not keep the development compiler alive across the desktop/mobile suite; this prevents CI heap
growth from killing the application server and verifies the same production artifact model used by
the deployment gate.

## ESH Finding Management v201 coverage

`esh_followup_v201.test.sql` drives the scheduler with fixed instants and proves policy snapshots,
working-day review timing, duplicate prevention, missed-level coalescing, escalation scope,
acknowledgement, staff reply notifications, stale dispatch suppression and idempotent delivery
callbacks. The real-stack integration test opens a recipient-specific escalation link, proves it
cannot submit owner work, checks the staff notification worker and verifies a due-date change
suppresses queued mail. Playwright repeats the Verifier settings page and escalation response on
1440 × 900 and 390 × 844, including a first interaction before hydration.

## ESH Finding Management v202 coverage

`esh_overview_v202.test.sql` proves that department and signal totals reconcile, a multi-action
finding counts once as a finding but every overdue action appears in the action drill-down,
Unassigned is explicit, awaiting/accepted actions are excluded from owner-overdue work, closure
periods do not hide old open findings, and reopening/reclosure changes the current closure count.
It also checks RLS and the export projection. Unit tests cover formula neutralization and CSV
escaping. The real-stack integration test repeats scope enforcement, and Playwright verifies the
Overview, period stability, exact overdue rows, old Closed redirect, downloadable safe CSV and both
desktop/mobile containment.

## ESH Finding Management v203 coverage

`esh_identity_access_v203.test.sql` proves the explicit role migration, platform/Focus/Finding
separation, unknown-email assignment without Auth provisioning, live participation counts, no
silent identity merge, selective relationship transfer, old grant/session revocation and preserved
historical authorship. The real-stack integration test repeats the RLS boundary and correction
transaction. Playwright verifies the consolidated All / Registered users / Email-link contacts
directory, independent module controls and contact access operations at desktop and mobile widths.

## v227 one-screen-one-job evidence

- pgTAP (13) proves: editing an open finding records before and after and refuses an unchanged
  save; reassessing risk needs a reason and leaves the deadline where it was; the register reports
  changes requested and no longer counts a held email as attention; Withdraw is refused and Raised
  in error is recorded as cancelled.
- Unit tests cover the human/technical split of the activity trail, the three outcomes, the import
  summary, and the four-state next-actor rule with its overlays.
- Playwright: every ESH journey was updated to the screens it now describes. The held-email journey
  reads the one register line, clears the contact, and releases with v224's Release all; the import
  journey reads the summary and imports and notifies in one press.

## v223 department-route evidence

- pgTAP (11) proves that only ESH within scope may record a route, that an invalid level or
  address is refused before anything is written, that replacing a route removes what it replaced
  rather than merging, and that listing somebody creates no contact and grants no access.
- Playwright records a route in settings, checks a new finding in that department is offered it,
  and that switching department replaces it. It then clears the route, because this suite shares
  one database.

## v221 closure-record evidence

- The v200 journey closes a finding and then checks the page shows before, after and who verified
  it, that the working page's Required action heading is gone, and that View full record brings it
  back. Preservation is asserted by reaching it, not by trusting that it still exists.

## v220 ESH-layout evidence

- The v216 layout journey now asserts that the administrative controls are nowhere on the page
  until the menu is opened, and present once it is. The verification and outcome journeys open the
  menu before using a control.

## v219 owner-layout evidence

- Playwright opens the owner's link at 1440, checks the context column sits left of the working
  column, that the page claims more than 1000px, that the requests are behind Need help? until
  asked for, and that choosing one writes the opening of the message.
- The reuse of an already-sent update is asserted where it now lives: one line beside the composer
  naming the update and its file, rather than a button under every message.

## v218 crawl evidence

- Nine Finding screens are opened at 1440 and 390, in Day and in Night, and each is held to a
  WCAG A/AA axe scan (serious and critical) and a sideways-scroll check.
- The scroll check asks the page to scroll and reads back whether it moved, rather than comparing
  `documentElement.scrollWidth` with the viewport: that metric counts an inner scroll container's
  content, so a table scrolling correctly inside its own box reported the whole page as broken.
- The contrast fix was proved by removing it: without the rule the crawl fails on exactly the
  link it was written for.
- The crawl seeds a finding in more than one state, so every next-action tone is on screen. The
  first version passed locally and failed in the full suite purely because the register held no
  owner-toned rows at that moment: a crawl only sees what the data shows it.

## v217 navigation evidence

- Playwright checks the module offers Register, Verification and Closed; that the register itself
  now offers three views rather than four; and that opening Closed marks it as the current
  destination and the register as not. The verification journey asserts the required outcome is on
  screen with the before-and-after it is judged by.

## v216 layout evidence

- Playwright checks that the conversation is in the main column and the action, the finding and
  its original evidence in the side one; that the administrative controls are no longer above the
  composer; and that a held assignment opens the Activity disclosure so its remedy is on screen.

## v215 two-step evidence

- Playwright records a finding across both steps, attaches a PNG on step one, and then checks in
  the database that the asset belongs to that finding, is `ready`, and carries purpose `original`
  — the upload is asserted at the store, not at the screen that reported it.
- It also checks that risk is asked for at registration while priority is not, and that an
  escalation level states when it fires.

## v214 next-actor evidence

- Nine unit tests fix the rule: the owner and the deadline are named rather than a state; lateness
  is counted in days; an undelivered assignment outranks an overdue one; a held assignment reads
  differently from a bounced one; a submission turns the queue over to ESH with the waiting time;
  and closed or set-aside findings say nothing is waiting.
- Playwright reads one finding in the register and on its own page and checks both say the same
  thing, and that the register's occasional tools are behind their menu.

## v213 bulk clearance evidence

- Playwright records two findings for two uncleared contacts, checks the panel lists both, refuses
  the batch until a reason is given, clears them in one press, and then asserts in the database
  that both carry the reason and that every notice raised while they were switched off is still
  held. The confirmation is asserted after the list empties, because the panel would otherwise
  unmount and take its own answer with it.

## v212 handover and step evidence

- pgTAP (13) proves that naming a successor keeps the address canonically with the message while
  creating no contact and no grant and leaving the assignment untouched, that the request comes
  back on the next read, that a malformed address is simply not a request, and that only ESH can
  hand the work over.
- Playwright walks the handover across both sides, unblocks a held email as an administrator who
  is also ESH — checking that enabling sends nothing and the release is still separate — and steps
  through the finding form.
- One assertion in the handover test waits on the owner row rather than the successor's address
  anywhere on the page: the address is already on screen inside the request, so the looser wait
  would have passed before anything moved.

## v211 owner-conversation evidence

- pgTAP (14) proves that asking for more time writes the date onto the message while the deadline,
  to the hour, stays where it was and nothing is recorded as a due-date change; that saying
  anything still starts the work; that the ask comes back on the next read, which is what makes it
  answerable; that somebody outside ESH cannot grant it and ESH cannot grant it without a reason;
  and that granting it records the change and tells the owner.
- Playwright walks both sides in one test: the owner opens their link on a 390px screen, reads what
  ESH needs without opening anything, asks for more time, and sees the deadline unmoved; then ESH
  opens the finding, sees the ask and moves the deadline to exactly that date with one press. A
  second test counts the fields the new finding form asks for and checks the defaults are under
  More settings rather than dropped.
- Both assertions that could have passed vacuously were rewritten: the words "15 Oct 2026" appear
  in the owner's own ask, so the test waits on the deadline itself changing instead.

## v210 letter, preview and health evidence

- pgTAP (35) proves the scheduler's record cannot be rewritten or deleted, that a browser cannot
  claim a run, that the health read refuses somebody outside Finding Management and reports the
  absent scanner as absent rather than as zero, that a preview names its audience and counts its
  work while capturing nothing and sending nothing, that the weekly letter summarises every
  department it captured with the overdue one first and still says how many were left out, and
  that the register claims an escalation only while it stands for the current assignment.
- Unit tests cover the letter's department table, its truncation line and its silence when a run
  carries no summary, and the rules for what is worth saying about the machinery — including that a
  slow Monday is not a stopped scheduler and a deep queue is information rather than a fault.
- Playwright previews a saved draft from Finding settings, checks it says nothing was sent and that
  no run was captured, and reads the Overview with a scheduled run four days old.

## v208 priority evidence

- pgTAP (15) proves a colleague outside ESH cannot change a priority, that a change needs a reason
  and a real level, that setting it to what it already is changes nothing, and that after a change
  the deadline, the risk assessment and the follow-up events are exactly as they were.
- The v200 browser journey now also changes a priority from the action menu and checks the due date
  it set a moment earlier is still the one shown.

## v209 outcome and policy evidence

- pgTAP (34) proves an outcome needs a reason, that closing is not one of the outcomes on offer,
  that a duplicate must name what it repeats and keeps the link, that the record is kept while its
  work stops and its links die, that nothing claims verification, that an outcome cannot be
  recorded twice, that priority beats risk beats the organisation policy when an assignment is
  stamped, that quiet hours defer a routine notice across midnight but not a morning one, and that
  the catch-up rule decides whether missed stages are sent or recorded as skipped.
- Playwright records a duplicate from the finding page and checks the register keeps it without a
  closure, then adds a critical-risk schedule and quiet hours from Finding settings.

## v207 consolidated-notice evidence

- pgTAP (25) proves reminders are gathered once per person per cycle, each event is marked as
  carried rather than queued, a second run gathers nothing again, a member whose schedule moved is
  dropped and closed off with its reason, the owner receives one link to their own list, completion
  is recorded against each carried event, and a delivery whose every line has moved on is
  suppressed rather than sent.
- Integration runs the real worker: one message listing three actions, one link in it, three events
  recorded as accepted, and nothing sent on a second drain.
- Unit tests pin the letters themselves — every action named rather than summarised away, an
  escalation digest carrying per-action links and no inbox link, and a released backlog that does
  not pretend its dates are new.

## v206 bulk-operation evidence

- pgTAP (29) proves an action link cannot do batch work, one update reaches each chosen action as
  its own attributed message and submits nothing, a repeated key returns the first answer, a
  request for more time changes no deadline, submitting several creates one submission each, an
  action that needs a photograph fails on its own while the rest go, an action already with ESH is
  skipped rather than resubmitted, and the records cannot be rewritten.
- Integration runs the same journey through real sessions and PostgREST, including the mixed
  outcome where two items are skipped and one fails for its own reason.
- Unit tests pin the wording: a partial batch never reads as a success, and no operation offered
  can finish an action without ESH.
- Playwright selects two of three actions in the owner's inbox, sends one update, submits both, and
  checks the counts move to Awaiting ESH review while the third stays the owner's.

## v205 backlog-import evidence

- pgTAP (34) stages a mixed sheet, proves a blank row is ignored explicitly, a missing address
  needs assignment rather than a guess, a missing corrective action blocks the row, an unready row
  stops the whole release, evidence must be answered for, the original row survives amendment, old
  due dates survive release, each owner receives one summary, and a repeated release key returns
  the first answer.
- Integration stages a hundred mixed rows over four owners plus the four kinds of trouble a real
  register has, releases 102 of them in one transaction against real Auth/RLS/PostgREST, and proves
  the summaries, the preserved deadlines, the follow-up start and the refusal of a repeat file.
- Unit tests cover the workbook reader — sheets in tab order, cell kinds, Excel serial dates and
  the 29 February 1900 that never happened — and the date conventions, where 04/05/2026 is read
  only the way it was told to read it.
- Playwright walks the whole journey: a file whose headings are on row 2, suggested mapping,
  staging, writing the corrective action the file lacked, release, and the finding arriving in the
  register still as overdue as the file said it was.

## v204 weekly-report evidence

- pgTAP proves the new tables and RLS boundary, service-only scheduler/read procedures, the required
  report grant shape, empty default configuration and safe scheduler no-op.
- Integration creates a scoped report against real Auth/RLS/PostgREST, proves idempotent capture,
  restricted-row exclusion, individual link exchange, snapshot read and pause-without-revoke.
- Unit tests pin the report-purpose URL and concise email contract. Playwright configures a Draft,
  activates/captures it through local fixtures, redeems a unique link and reads the signed-out
  read-only dashboard.
