# TAMCO Focus — build status

**Date:** 5 August 2026
**Baseline:** v30 (`MASTER_PRODUCT_SPEC.md`, `PRODUCTION_LOGIC.md`)
**Stage:** local-first. No GitHub remote, no hosted Supabase link, no Vercel project.

This document reports what was built, what was verified, and what was not. It
exists because `BUILD_ACCEPTANCE_GATES.md` requires failures to be reported
honestly.

---

## 1. Environment

Docker Desktop and WSL 2 are installed, and the full local Supabase stack runs:
Postgres, GoTrue, PostgREST, Storage, and Studio. The application signs in and
serves live data at `http://localhost:3000`.

Nothing in this repository fakes a service. There is no mock database, no
stubbed Supabase client, and no test that passes because it was skipped.

---

## 2. Verification results

Produced by `npm run verify`.

| Gate                  | Result   | Notes                                       |
| --------------------- | -------- | ------------------------------------------- |
| SQL syntax            | **PASS** | 355+ statements parsed                      |
| Schema executes       | **PASS** | 16 migrations + seed, 16 behaviour checks   |
| Secret scan           | **PASS** | No credentials in tracked files             |
| Format check          | **PASS** | Prettier                                    |
| Type check            | **PASS** | `tsc --noEmit`, strict                      |
| Unit tests            | **PASS** | 86 tests, pure domain logic                 |
| Production build      | **PASS** | `next build`, lint included                 |
| Database reset        | **PASS** | All migrations and fixtures from zero       |
| Generated types match | **PASS** | `database.types.ts` matches the live schema |
| RLS / database tests  | **PASS** | 24 pgTAP assertions                         |
| Integration tests     | **PASS** | 11 tests against the real stack             |
| End-to-end tests      | **FAIL** | Not written                                 |

**11 passed, 1 failed, 0 skipped.**

The RLS gate no longer passes vacuously: `scripts/run-rls-tests.mjs` fails when
`supabase/tests/` is empty, listing the properties the suite must cover. A
security gate that goes green with zero tests is worse than one that fails.

### What is now genuinely proven

Against a real database, with real GoTrue sessions and RLS active:

- `anon` is refused at the privilege gate on every table
- Amer views Izzah and Ajmal through the explicit grant, and not Lim
- Amer can view but cannot activate, move out, or reassign work he does not
  own — section 3.4, demonstrated rather than asserted
- a deactivated account reads nothing despite holding a valid token
- audit events cannot be forged or rewritten by a client
- activation is one call within target, asks exactly one question when it would
  cross the target, and proceeds on a reason with no approval step
- stale versions conflict, repeat clicks are absorbed, concurrent activations
  do not double-count
- undo reverses the transition while preserving both events
- completion is blocked while required evidence is missing

### Defects found by actually running it

Eight, none visible to static checking. Four from executing the schema
(a seeded completed task with no `completed_at`; a `record` passed where a
composite was required; an `ON CONFLICT` missing its partial-index predicate;
a retained-history rule that made every account undeletable), and four from
running the stack (`[auth.email] enable_signup = false` disabling email logins
outright; a policy subquery causing infinite recursion; `EXECUTE` revoked from
the policy helpers; and table privileges never granted to `authenticated` or
`service_role`).

---

## 3. What is implemented

### Database (`supabase/migrations/`, 18 forward-only migrations)

- Full normalised schema: identity and org, visibility, focus targets, settings,
  tasks, collaborators, relations, checklists, barriers, updates, attachments,
  evidence view log, Capture Work staging, routine templates and occurrences,
  governance proposals, meeting queue, completion reviews, immutable audit,
  separate administrative security log, notifications, weekly email delivery.
- Constraints carrying real business rules: focus bucket must match work class,
  a note required only for the "Other" activation reason, terminal timestamps
  consistent with terminal states, mandatory work requires justification,
  a paused task requires restart information, and a mandatory capture outcome is
  unreachable unless the urgency question was asked and answered.
- RLS enabled on **every** user-data table, plus private Storage bucket
  policies. Default deny throughout; `anon` is granted nothing.
- Authorisation helpers that keep **view separate from edit** — the property
  section 3.4 depends on. `focus.can_view_task` honours explicit visibility
  grants; `focus.can_edit_task` deliberately does not.
- Transactional procedures for every high-impact change, with row locking,
  optimistic version checks, idempotency keys, audit events, and notifications
  in one transaction.
- Local-only fixtures including the approved Amer/Izzah/Ajmal visibility
  example and a deliberately history-free account for the guarded-deletion path.

### Domain layer (`src/domain/`) — fully unit tested

- `duration.ts` — open, current-state, overdue, and stale ages from stored
  timestamps; organisation-timezone arithmetic; the date-only due-date rule that
  prevents the accidental one-day overdue.
- `focus.ts` — soft targets, the `6 / 5` badge with its written "Over focus
  target" label, and inline reason validation.
- `classification.ts` — deterministic Capture Work classification, with the
  urgency question that keyword detection can never bypass.
- `prioritisation.ts` — My Day ranking, the full tie-break order, "Why this?"
  explanations, Needs Attention, and Coming Up.

### Application

- Supabase server/browser/service-role clients with the service-role key
  confined to `server-only` modules.
- Session middleware and authentication gating.
- Server actions for activation (including the over-target flow), move to
  available, pause, resume, complete, cancel, reassign, undo, checklist
  completion and reopening, barriers, completion review, evidence view logging,
  and routine findings.
- Sign-in, My Day, and Work (Focus) pages, with the design system taken from the
  approved prototypes, Day/Night theming, task-age chips, and the over-target
  dialog with Undo.

---

## 4. What is NOT implemented

Stated plainly rather than stubbed. There are no placeholder pages, because a
page that says "coming soon" is the placeholder the engineering standard
forbids.

**Interface — not built:**

- Capture Work screens (`/capture`) — the domain logic and the `work_captures`
  table exist; the screens do not.
- Monthly Plan (`/plan`) — the `plan_events` view exists.
- Team Load (`/team`) — the `team_load_summary` view exists.
- More (`/more`): Records, Attachments, Audit History, Archive, Settings, the
  administrator user directory, and Visibility Rules administration.
- Routine sub-navigation (`/work/routine`).
- Task detail drawer — the master-detail panel of section 10.4, and with it the
  in-app checklist, update composer, attachment upload, and barrier form.

Navigation links to these routes exist because sections 4.1 and 4.2 define the
information architecture; they currently resolve to 404. That is visibly
incomplete, which is the intended signal.

**Server — not built:**

- Attachment upload and signed-URL download routes (the Storage policies and
  `attachments` table are in place).
- The weekly email worker (schema, idempotency key, and preference modes are in
  place; `PRODUCTION_LOGIC.md` sections 14 and "V30" define the content sets).
- The routine occurrence scheduler (`generate_routine_occurrences` exists and is
  idempotent; nothing calls it on a schedule).
- User provisioning server actions (`provision_user_profile`,
  `deactivate_user`, `delete_user_permanently` exist in SQL and are unreachable
  from the interface).

**Tests — not written:**

- End-to-end and accessibility tests (`tests/e2e/`). Playwright is configured
  for desktop and mobile viewports and `@axe-core/playwright` is installed, but
  no specs exist, so the browser journeys and the automated accessibility
  checks in BUILD_ACCEPTANCE_GATES.md section 6 remain unverified.

**Documentation — not written:**

`docs/` should contain `architecture.md`, `data-model.md`, `rls-permissions.md`,
`api-and-actions.md`, `local-operations.md`, `future-deployment.md`,
`test-strategy.md`, and `traceability-matrix.md`. Only this status document
exists. The schema and procedures are heavily commented in place, which is not
a substitute.

---

## 5. Recorded assumptions

Reversible local defaults, documented rather than silently chosen
(`MASTER_PRODUCT_SPEC.md` section 30 lists these as unresolved):

| Decision                    | Local default                     | Where                           |
| --------------------------- | --------------------------------- | ------------------------------- |
| Capture classification (8)  | Deterministic rules-based         | `src/domain/classification.ts`  |
| Request Changes outcome (9) | `return_to_available`             | `org_settings`, editable        |
| Attachment limits (1)       | 10 MB, fixed MIME allowlist       | `.env.example`, `org_settings`  |
| Virus scanning (2)          | **Not performed, not faked**      | `ATTACHMENT_VIRUS_SCAN_ENABLED` |
| Retention (3)               | 7 years, placeholder              | `org_settings`                  |
| Email provider (4)          | Local log transport only          | `EMAIL_TRANSPORT`               |
| Occurrence generation (12)  | Idempotent watermark, 14-day lead | `generate_routine_occurrences`  |

Two structural decisions worth surfacing:

1. **A routine occurrence is a task** (`work_class = 'routine_occurrence'`)
   rather than a separate record type. Section 16.1 requires each occurrence to
   carry its own due date, owner, checklist, evidence, findings, status,
   completion record, and audit history — which is the task machinery exactly.
   Modelling it separately would have duplicated every one of those tables.

2. **Package manager is npm, not pnpm.** `corepack enable pnpm` requires
   administrator rights on this machine. `LOCAL_FIRST_BUILD_GUIDE.md` section 3
   permits a different package manager provided equivalent commands are
   documented; they are, in `package.json`.

---

## 6. Confirmation of stage boundaries

- `git remote -v` returns nothing. No remote was added.
- No hosted Supabase project was linked.
- No Vercel project was created or deployed.
- No secrets are committed; `npm run scan:secrets` passes over tracked files.
- The default branch is `main`.

---

## 7. Next steps, in order

1. Install Docker Desktop and WSL 2, then run `npm run preflight` until it is
   clean. This is the only step that needs administrator rights and a restart,
   and it is the one thing that cannot be done from inside this repository.
2. Run `scripts/setup-local.ps1`. The schema now applies cleanly to a real
   PostgreSQL 18 engine, so `supabase db reset` has a good chance of working
   first time — but Supabase adds roles, JWT claims, and the `storage` service
   that the in-process harness only stands in for, so budget for a few
   platform-specific corrections.
3. Commit the generated `src/lib/database.types.ts`.
4. Write the RLS tests. This is the largest remaining verification gap: the
   policies are proven to compile and attach, not to allow and deny correctly.
   Start with the Amer/Izzah/Ajmal visibility case and the
   view-does-not-grant-edit denial cases.
5. Build the task detail drawer, then Capture Work — between them they unlock
   most of the remaining workflows.
6. Fill in the rest of `docs/`.
