# Finding Management v4.1 — Stage 0 baseline and delta

Status: **review drafted; S0 gate pending**. This document contains no feature
change or authorization to deploy. The package's HTML and screenshots are an
approved visual concept with fictional data, not evidence of implemented code.

## Evidence and baseline

- Baseline: `origin/main` at `2591c277f1471a63e5b6347095f142eeddd348b3`.
  The backup change is isolated on `codex/evidence-storage-backup`; this review
  is isolated on `codex/finding-v41-stage0`. The supplied v4.1 package's numbered
  Markdown, prototype and screenshots were inspected. The package's statement
  that v269/v270 were not merged is stale: this baseline includes v269–v271.
- Local verification: unpiped `npm run verify` on the backup branch passed
  17/17 gates, including 748 pgTAP assertions, 401 integration assertions and
  626 passed Playwright cases (155 intentionally skipped). The backup changes
  did not alter the application UI or schema. Stage 0 is draft PR #49. Its
  dispatched full workflow run 41179525074 passed all three jobs at `030bf19`,
  including the on-demand browser suite (626 passed, 155 intentionally skipped).
  Subsequent report/tracker edits are documentation only. The user approved
  local-only testing for S1 on 31 October; current-branch CI after stacking
  Stage 0 on the backup branch remains to be confirmed before S0 closes.
- Backup draft PR #50 is published. Its dispatched full workflow run
  41180345379 passed static, database/RLS/integration and on-demand browser
  jobs at `8f13d37` (626 passed, 155 intentionally skipped). Its later
  handover-file edits are documentation only.
- Production evidence: an authorized operator created a fresh backup on
  31 October 2026. Local inspection found 349 `task-attachments` and 5
  `finding-evidence` objects (107,357,176 saved bytes). Every saved file matched
  its manifest size and SHA-256. The Production data dump restored 69 populated
  tables and 8 identities to isolated local. All 354 private objects were
  uploaded there, downloaded and matched size/hash. Local fixtures were reset
  afterward. The agent did not connect to Production.
- A search of that fresh local `*-schema.sql` found v271 `source_object_key`,
  `esh_scan_claim` and `esh_reject_sent_evidence_change`. It did not find
  `esh_report_intake` or `esh_qr_locations`. This verifies these schema symbols,
  not current Vercel configuration or scanner hosting.
- Current application baseline screens were captured from **local seed data**
  with an authenticated ESH fixture account. A temporary Playwright capture
  passed 2/2 desktop/mobile checks and was removed from the application tree.
  Six images show Dashboard, Register and Verification at 1440px and 390px.
  A second temporary Playwright capture passed 2/2 and added a populated
  finding detail at both widths using only a new local fixture; `npm run db:reset`
  exited 0 afterward. The eight images contain no Production records.

| Desktop baseline                                  | Mobile baseline                                  |
| ------------------------------------------------- | ------------------------------------------------ |
| [Dashboard](baseline-desktop-dashboard.png)       | [Dashboard](baseline-mobile-dashboard.png)       |
| [Register](baseline-desktop-register.png)         | [Register](baseline-mobile-register.png)         |
| [Verification](baseline-desktop-verification.png) | [Verification](baseline-mobile-verification.png) |
| [Finding detail](baseline-desktop-detail.png)     | [Finding detail](baseline-mobile-detail.png)     |

## Current system and v4.1 delta

| Area                         | Verified baseline                                                                                                                                                                                                                                                          | Required delta or preservation rule                                                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation                   | `/esh` is separate from `/findings`; `FindingNav.tsx` offers Dashboard, Register, Verification, Closed and secondary Settings.                                                                                                                                             | S1 places daily obligations under Today, canonical filters under Findings and historical insight under Patterns/Reporting. Preserve `/esh`, existing deep links, exports and settings.                                                               |
| Working queues               | `/findings/register`, `/findings/verification`, `/findings/closed`, finding detail, new finding and import routes exist. `src/server/esh/queries.ts` supplies scoped reads.                                                                                                | Reconcile the four Today counts to their drill-down rows and combine reasons for one obligation rather than duplicating it. Retain existing search, department scope and pagination.                                                                 |
| Owner spine                  | `/respond/access`, `/respond/my-actions`, `/respond/actions/[actionId]` and reply/file routes exist. `src/server/esh/guest.ts`, `guest-actions.ts`, `actions.ts` and verification actions support passwordless owner response and ESH review.                              | Keep email identity, baseline/current due dates, role scope, segregation of duties, audit history, reply versus completion, effectiveness and linked failure behavior. Do not add employee login.                                                    |
| Safety and evidence          | Interim controls, follow-up/escalation, evidence kind, effectiveness, scanner state and restricted source files are implemented through v271. `vercel.json` schedules `/api/cron` at 01:00 UTC, corresponding to 09:00 Malaysia time; the endpoint requires `CRON_SECRET`. | Keep real immediate-hazard alert/fallback separate from daily cron. Do not imply unscanned files are clean, broaden private file access or change due-date rules. Scanner hosting and live delivery configuration are not proven by repository code. |
| QR intake                    | No `/report` route, QR location/intake tables or `qr_intake_enabled` flag was found in source and migrations. The original ESH v1.3 specification excluded public QR.                                                                                                      | S2 adds separate private intake, disabled by default, with no automatic finding or public read of findings. Anonymous reporting, privacy, emergency routing, scanning, retention and pilot rollout need named human decisions.                       |
| Categories and relationships | No v4.1 hazard taxonomy or `esh_finding_relationships` table found. Existing duplicate outcomes and linked effectiveness failures must be retained.                                                                                                                        | S3 adds reviewed classification and explicit duplicate/recurrence/related links. Do not infer historical categories or causes.                                                                                                                       |
| Patterns                     | Existing dashboard panels and leadership reports are present.                                                                                                                                                                                                              | S4 must preserve those views, reconcile counts with scoped source rows, and open only findings visible to the viewer. No predictive score or parallel task tracker.                                                                                  |

The operational sources behind this map are also present: `src/domain/esh-dashboard.ts`
distinguishes significant work without verified protection from unassessed
findings; `src/server/esh/queries.ts` supplies the scoped dashboard and register
queries. `src/server/esh/dispatch.ts`, `email.ts` and `schedule-dispatch.ts`
handle outbox claims, templates and delivery; `src/domain/esh-rollout.ts`
defines the existing restricted/live contact gate. That gate is separate from
the new, independent QR intake flag. `src/domain/esh-reports.ts` and
`src/app/(esh)/findings/register/export/route.ts` support reporting/export.
The current test inventory has 118 Playwright specs, 50 unit files and 60
integration files; RLS policies are authoritative in SQL migrations.

## Deployment and acceptance gaps

`DEPLOYMENT.md` names Vercel Preview with Supabase `tamco-focus-staging`, but
`MIGRATION_STATUS.md` records that this Staging project does **not** exist
because the available free slot went to Production. It names local Supabase as
the fallback and forbids Preview from connecting to Production. This is the
last documented state, not a current infrastructure inspection. An authorized
operator must confirm whether Staging has since been provisioned or approve a
specific local-only demonstration path before S1's deployment gate is judged.
The user chose the local-only path for Stage 1 testing on 31 October 2026;
there is no permission to use a hosted Preview or Production as the test
database. A hosted Staging project remains unverified.
The repository does not prove the current deployed commit, environment
variables, scanner service, email transport, QR policy or rollout permission.
The Production migration claim is corroborated only for the v271 schema
symbols listed above; no live Production migration query was made. The
package's prototype screenshots remain concept references; the fixture-only
captures above show the current implementation.

## S0 gate and next action

S0 remains unchecked in `07_BUILD_TRACKER.md` until the rebased Stage 0 branch
passes its full dispatched workflow. The backup and original Stage 0 browser
runs passed; local-only Stage 1 testing is approved. Current hosted deployment
configuration remains unverified, so no hosted demo or Production rollout is
authorized. No schema or v4.1 application feature changed here.
