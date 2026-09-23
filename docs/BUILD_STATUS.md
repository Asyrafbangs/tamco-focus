# TAMCO Focus — build status

**Date:** 23 September 2026

**Baseline:** approved TAMCO Focus specifications through v191 and ESH Finding Management v1.3

**Stage:** ESH Finding Management v197–v210 implemented locally behind restricted rollout. No
hosted Supabase link, hosted migration, deployment or remote push is part of this stage.

This document records the implemented scope and the evidence used to accept the local build. `npm run verify` remains the authoritative release gate: a failed or skipped gate makes the command exit non-zero.

## Verification

The current suite covers sixteen independent gates:

| Gate                     | Evidence                                                                   | Result |
| ------------------------ | -------------------------------------------------------------------------- | ------ |
| SQL syntax               | Every migration, seed and pgTAP file parses                                | Pass   |
| Schema execution         | All forward migrations and canonical seed execute from zero                | Pass   |
| Secret scan              | No committed credential                                                    | Pass   |
| Format check             | Prettier checks the repository                                             | Pass   |
| Lint                     | ESLint with zero warnings                                                  | Pass   |
| Type check               | Strict TypeScript, no emit                                                 | Pass   |
| Unit tests               | Domain, rendering and worker logic                                         | Pass   |
| Production build         | Optimised Next.js 16 build                                                 | Pass   |
| Production smoke         | Built sign-in, security headers and protected-route redirect               | Pass   |
| Database reset           | Every migration plus local-only fixtures                                   | Pass   |
| Generated types          | Checked-in TypeScript matches the reset public schema                      | Pass   |
| RLS/database tests       | Full pgTAP suite; v210 adds 35 letter, preview and health assertions       | Pass   |
| Integration tests        | Real local Auth, PostgREST, Storage, procedures and worker paths           | Pass   |
| Reset before end-to-end  | Browser suite starts from canonical seed                                   | Pass   |
| End-to-end/accessibility | Desktop/mobile journeys plus the wider responsive and accessibility matrix | Pass   |
| Restore seed data        | Local stack is returned to canonical fixtures after verification           | Pass   |

**Current result:** 16 passed, 0 failed, 0 skipped.

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
- ESH Finding Management through v210: restricted staff access, finding assignment, accountless
  Action Owner links and conversation, private evidence, immutable submissions, ESH verification,
  closure/reopen, policy snapshots, reminders, escalation, reply follow-up and honest delivery
  evidence, reconciled Overview/Register definitions, closure periods, safe authorized export,
  configured weekly snapshots, purpose-separated read-only leadership links, and a reviewed
  backlog import that stages every row before anything becomes live, and owner bulk operations
  that never finish an action without ESH, consolidated routine notices, audited priority changes,
  administrative outcomes that are not closures, follow-up rules that differ by risk and
  priority, a weekly letter that summarises departments and names overdue owners, a preview of
  what a report would say before it is activated, an escalation indicator on the register, and an
  append-only record of scheduled runs surfaced on the Overview so a job that stops is noticed.
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
- ESH guests cannot cross actions or organisations; reassignment and access-off revoke live reach.
- Escalation grants support and acknowledgement only, never owner submission or ESH verification.
- Follow-up triggers are duplicate-safe, use assignment snapshots, and suppress stale mail before
  dispatch. Provider acceptance is never presented as delivery.
- Weekly report capture is duplicate-safe; snapshots are immutable, restricted findings are
  excluded, every recipient has an individual grant, and pause preserves already issued access.
- An imported backlog is staged before it is anything: every nonblank row has a traceable outcome,
  nothing is created or notified until release, original deadlines survive it, and a released batch
  sends one summary per owner rather than one email per row.
- A bulk operation is a batch of single actions: each item is rechecked and answered for
  separately, a repeated press is the same operation, and no operation closes or completes an
  action on the owner's word alone.
- A consolidated notice changes packaging only: every action keeps its own event, entitlement and
  delivery outcome, stale lines are dropped as the message goes, an empty summary is not sent, and
  nothing urgent is ever held back for one.

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

The current ESH continuation is local-only. Migrations apply only to the local Supabase stack;
fixtures, generated access links and test addresses must not be copied to a hosted environment.
No command in this stage links Supabase, deploys Vercel, adds or pushes a Git remote, or writes a
secret to the repository. Separate deployment documents describe future inputs without authorising
those operations.
