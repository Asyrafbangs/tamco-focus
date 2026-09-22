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
