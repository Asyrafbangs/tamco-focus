# TAMCO Focus v33 Goals implementation report

**Date:** 6 August 2026  
**Scope:** local-only update of the existing production application  
**Authority:** `UPDATE_EXISTING_APP_TO_V33_PROMPT.md` and the supplied v33 product-reference pack

## 1. What changed

- Added Goals as a dedicated primary workspace between Work and Plan. Calendar remains exclusively under Plan.
- Added compact My Goals and authorised Team Goals master-detail experiences with whole-row opening and independent Quick Update actions.
- Added a responsive, accessible Goal drawer with Overview, Milestones, Updates, and Evidence & Work tabs.
- Added manager-led two-step Goal setup with expectation, contribution/alignment, one-to-ten jointly defined milestones, Save for discussion, and Agree and activate outcomes.
- Added five-percent-step reported overall progress and independent milestone progress. Weighted milestone-derived progress is supporting context and never overwrites the reported value.
- Added structural version proposals, pending agreement, explicit activation, immutable agreement history, expected-version conflict handling, and idempotency.
- Added actionable support requests/resolution, manager update requests, meaningful My Day exceptions, Goal notifications/audit, and curated employee/manager weekly-summary sections.
- Added private Goal evidence, view logging, short-lived downloads, file validation/progress/failure UI, and linked task work without automatic progress coupling.
- Added loading, error, empty, responsive, dark-theme, reduced-motion, focus-management, and keyboard states.

## 2. Architecture and migration decisions

- The v33 schema is a forward-only migration chain: Goal enums/event vocabulary, relational tables, capability helpers and RLS, locked operations, security-invoker views, and two additive function repairs found by real-stack integration testing.
- `goals` owns lifecycle summary state. `goal_versions` and version-owned milestones preserve active and pending structural agreements. Updates, milestone updates, agreements, support, attachments/views, work links, audit events, and notifications retain explicit Goal foreign keys.
- Client roles receive read-only table access. `can_view_goal`, `can_update_goal`, `can_edit_goal_structure`, and `can_agree_goal` remain separate database authorities. All mutations use security-definer procedures with locks, expected versions, validation, idempotency, audit, and notification writes.
- Existing private Storage infrastructure is reused under `goals/<goal-id>/...`. Upload transactions verify ownership and path scope; failed application transactions remove only their newly staged orphan objects. Downloads recheck view permission, record a view, and return a short-lived signed URL.
- Existing task, authentication, visibility, administration, weekly-worker, navigation, drawer, modal, attachment, and design-token infrastructure was extended rather than duplicated. No task permission or state-transition authority moved into the browser.
- The canonical seed adds Safety Digitalisation (20% reported, 19% milestone-derived) and a coaching Goal. `scripts/seed-goals-v33.mjs` is a non-destructive backfill for already-seeded local databases, not a replacement for canonical reset-and-seed.

## 3. Important files and directories

- Schema and authority: `supabase/migrations/20260806000200_goal_enums_v33.sql` through `20260806000800_fix_goal_milestone_audit_cast.sql`
- Fixtures and RLS tests: `supabase/seed.sql`, `supabase/tests/rls_visibility.test.sql`, `scripts/seed-goals-v33.mjs`
- Domain and server: `src/domain/goals.ts`, `src/server/goal-queries.ts`, `src/server/actions/goal-actions.ts`, `src/app/api/goal-attachments/[id]/route.ts`
- UI: `src/app/(app)/goals/`, `src/components/goals/`, `src/components/ui/Modal.tsx`, `src/components/ui/SideDrawer.tsx`, `src/components/Navigation.tsx`, `src/app/globals.css`
- Cross-cutting integration: `src/app/(app)/today/page.tsx`, `src/server/workers/weekly-summary.ts`, `src/lib/database.types.ts`
- Tests: `tests/unit/goals.test.ts`, `tests/unit/weekly-summary.test.ts`, `tests/integration/goals.test.ts`, `tests/e2e/goals-v33.spec.ts`
- Source of truth: `MASTER_PRODUCT_SPEC.md`, `PRODUCTION_LOGIC.md`, `CHANGELOG.md`, `README.md`, and the v33 documents in `docs/`

## 4. Validation evidence

| Command / check                                   | Result                                                                                                                            |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `npm run preflight`                               | Pass outside the workspace sandbox: Node, npm, Git, Docker, Supabase CLI, local ports/stack, and environment present              |
| `npm run check:sql`                               | Pass: 33 SQL/seed/test files, 645 statements                                                                                      |
| `npm run check:schema`                            | Pass: all 31 migrations and seed apply from zero; behaviour checks pass                                                           |
| `npm run db:types:check`                          | Pass: checked-in strict types match the local schema                                                                              |
| `npm run db:test`                                 | Pass: 36 pgTAP assertions                                                                                                         |
| Non-destructive integration runs                  | Pass: 19 preserved transaction tests, then all 7 Goal integration tests after the additive repairs                                |
| `npm run test:unit`                               | Pass: 117 tests in 7 files                                                                                                        |
| `npm run format:check`                            | Pass                                                                                                                              |
| `npm run lint`                                    | Pass with zero warnings                                                                                                           |
| `npm run typecheck`                               | Pass                                                                                                                              |
| `npm run scan:secrets`                            | Pass                                                                                                                              |
| Full Playwright matrix through the live local app | Pass: 36 applicable, 14 intentional viewport/project skips, 0 failures across 1440×900, 1280×800, 1024×768, 768×1024, and 390×844 |
| `NEXT_DIST_DIR=.next-verify npm run build`        | Pass: optimised Next.js 16.3 production build                                                                                     |
| `npm run test:smoke`                              | Pass: compiled sign-in, security headers, and protected redirect                                                                  |

The broader prototype/before/after parity evidence remains under `docs/ui-parity/`; the final reconciliation is in `docs/ui-ux-parity-audit.md`. The live v33 Goal workspace, drawer, setup dialog, mobile layout, and dark theme were additionally inspected at identical 1440×900 and 390×844 viewports during this pass.

## 5. Security and permission review

- Anonymous and inactive accounts cannot access Goal rows or operations.
- Own/participant access, manager coaching, structural edit, and agreement are separate capabilities. Explicit visibility is view-only.
- Direct Goal table mutation is revoked from clients; procedures recheck authority and expected versions under row locks.
- Audit history remains append-only. Goal events and notification links are explicit and tested.
- Private evidence policies scope paths to the Goal and authorised user; view and upload authority differ; signed download access is logged.
- Structural proposal validation runs in a subtransaction, so malformed milestones cannot leave an orphan pending version.
- Real-stack tests found and fixed explicit PostgreSQL enum casts in Goal creation and milestone audit dispatch before handoff.

## 6. Remaining limitation

The repository-mandated `npm run db:reset` was not executed against the existing local developer database. The execution safety reviewer rejected that destructive operation, and no workaround or stronger deletion/reset command was attempted. Consequently the default clean-reset integration command was represented by non-destructive test-group runs, while the isolated schema gate separately proved all migrations and seed apply from zero. Explicit approval to replace the current local database is required to close this one gate.

No hosted Supabase project, Git remote, GitHub connection, Vercel project, deployment, or production email credential was created.

## 7. Local run instructions

```powershell
npm install
npm run preflight
npm run supabase:start
# Destructive: back up or explicitly approve replacing the current local database first.
npm run db:reset
npm run db:types
npm run dev
```

Open `http://localhost:3000`, sign in with an approved local fixture account, and select Goals between Work and Plan. After an approved reset, run `npm run verify` for the canonical all-in-one release gate.
