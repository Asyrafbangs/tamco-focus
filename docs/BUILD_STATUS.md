# TAMCO Focus — build status

**Date:** 6 August 2026

**Baseline:** approved v33 product specification and production logic

**Stage:** v33 implementation and non-destructive verification complete; destructive reset gate awaiting explicit approval. No hosted Supabase link, Vercel deployment, or Git remote.

This document records the implemented scope and the evidence used to accept the local build. `npm run verify` remains the authoritative release gate: a failed or skipped gate makes the command exit non-zero.

## Verification

The current suite covers fourteen independent gates:

| Gate                     | Evidence                                                                                                                     | Result  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------- |
| SQL syntax               | 645 statements across 31 migrations, seed, and pgTAP coverage                                                                | Pass    |
| Schema execution         | All 31 migrations and the canonical seed apply from zero in isolated PostgreSQL with behaviour checks                        | Pass    |
| Secret scan              | No credentials in tracked repository files                                                                                   | Pass    |
| Formatting               | Prettier passes                                                                                                              | Pass    |
| Lint                     | ESLint passes with zero warnings                                                                                             | Pass    |
| Type checking            | Strict TypeScript passes with no emit                                                                                        | Pass    |
| Unit tests               | 117 domain and summary tests                                                                                                 | Pass    |
| Production build         | Optimised Next.js 16.3 build succeeds with `/goals` and Goal attachment routes                                               | Pass    |
| Production smoke         | Built server, sign-in, security headers, and protected-route redirect succeed                                                | Pass    |
| Database reset           | Safety reviewer rejected resetting the existing developer database; no destructive workaround was used                       | Blocked |
| Generated types          | Checked-in database types match the migrated live local schema                                                               | Pass    |
| RLS/database tests       | 36 pgTAP assertions                                                                                                          | Pass    |
| Integration tests        | 19 preserved transaction tests passed before Goal repairs; all 7 Goal tests passed after additive repairs                    | Pass¹   |
| End-to-end/accessibility | 36 applicable Playwright journeys passed across five viewport projects; 14 project-specific cases skipped by viewport guards | Pass    |

¹ The canonical one-command integration run starts with `db reset`. Because that reset was blocked, the two groups were verified in non-destructive runs against the same local stack rather than one clean-reset invocation.

**Current result:** 12 gates passed, 1 passed with the noted clean-reset constraint, 1 blocked, 0 failed.

The UI/UX parity enforcement pass is included in that result: all main surfaces were compared against the executable prototype, the browser matrix covers 1440 × 900, 1280 × 800, 1024 × 768, 768 × 1024, and 390 × 844, local preflight passes, and `npm audit --omit=dev --audit-level=high` reports zero production vulnerabilities. Prototype/before/after evidence and the final disposition are recorded in `docs/ui-ux-parity-audit.md`.

## Implemented scope

- Complete local Supabase schema, forward-only migrations, private Storage, transactional procedures, immutable audit and security logs, authoritative RLS, and generated strict TypeScript types.
- Sign-in, My Day, Work, Routine, Monthly Plan, Team Load, Capture Work, and responsive task detail.
- Dedicated Goals navigation and workspace, compact My Goals, manager Team Goals master-detail, two-step setup, version agreement, independent milestones, dual progress, support, private evidence, linked work, Goal drawer, My Day exceptions, and curated weekly-summary content.
- Task lifecycle actions, checklists, evidence and evidence-view auditing, updates and mentions, barriers, attachments, collaborators, related work, completion review, and history.
- More hub with Records, Attachments, Audit History, Archive, personal and organisation Settings, administrator user directory, and Visibility Rules.
- Compensated local Auth provisioning and profile administration, deactivation/reactivation, controlled exception handling, and guarded deletion for history-free identities.
- Deterministic Capture Work classification, mandatory urgency question, staged private attachments, collaboration links, and transactional confirmation.
- Idempotent routine occurrence scheduler and weekly-summary worker with timezone windows, preference modes, manager team content, atomic claiming, retry/backoff, and local SMTP/log transport.
- Responsive desktop and mobile interfaces based on the approved prototypes, Day/Night themes, visible text state labels, and keyboard/accessibility coverage.
- Architecture, data-model, permissions, actions, operations, future-deployment, testing, and traceability documentation.

## Key properties proven by tests

- Anonymous and deactivated sessions cannot read user data.
- Explicit visibility grants permit viewing without granting lifecycle or reassignment authority.
- Audit records cannot be forged, changed, or deleted by clients.
- Activation is transactional, versioned, idempotent, and asks exactly one reason when crossing a focus target.
- Concurrent/repeated transitions do not double-count; undo preserves both audit events.
- Required evidence blocks completion until satisfied.
- Settings, effective visibility, private attachment access, and administrative account operations are enforced server-side.
- Weekly delivery and routine occurrence generation remain duplicate-safe on repeated runs.

## Recorded local defaults

| Decision                | Local default                                    |
| ----------------------- | ------------------------------------------------ |
| Capture classification  | Deterministic rules-based classifier             |
| Request Changes outcome | `return_to_available`, organisation-configurable |
| Attachment policy       | 10 MB and fixed MIME allowlist                   |
| Virus scanning          | Disabled and explicitly not simulated            |
| Retention               | Seven years, organisation-configurable           |
| Email provider          | `log`, `inbucket` or a real `smtp` relay         |
| Routine generation      | Idempotent watermark with a 14-day lead          |
| Routine recurrence      | Anchored to a start date, calendar-client shapes |

A routine occurrence is represented as a task with `work_class = 'routine_occurrence'`, so it uses the same ownership, checklist, evidence, state, completion, and audit rules without duplicating those domains. npm is the documented package manager because the local guide permits an equivalent package manager when pnpm cannot be enabled.

## Environment boundary

This section described a local-only build. That stopped being true with the cloud migration approved on 11 August 2026, and leaving it in place would have made this file assert the opposite of the deployment it documents.

- A hosted Supabase project and a Vercel project both exist; `MIGRATION_STATUS.md` and `DEPLOYMENT.md` hold their state and approval gates.
- Local Supabase remains the only place fixtures, stress testing and experimentation belong. Production holds real operational data.
- Secrets remain in ignored local environment files and in the hosting platform's own configuration. None are committed.

The approved v33 product slice has no intentionally omitted Goal feature or placeholder page.
