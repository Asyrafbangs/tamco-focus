# TAMCO Focus — build status

**Date:** 5 August 2026
**Baseline:** v30 (`MASTER_PRODUCT_SPEC.md`, `PRODUCTION_LOGIC.md`)
**Stage:** local-first. No GitHub remote, no hosted Supabase link, no Vercel project.

This document reports what was built, what was verified, and what was not. It
exists because `BUILD_ACCEPTANCE_GATES.md` requires failures to be reported
honestly, and because this build ran on a machine that could not execute every
gate.

---

## 1. The blocking constraint

**Docker is not installed on this machine, and WSL 2 is not available.**

```
FAIL  Docker engine  not installed
```

The local Supabase stack (Postgres, Auth, Storage, PostgREST) runs in
containers. Without a container runtime there is no database, which means the
following genuinely cannot be executed here:

- `supabase start` / `supabase db reset` — applying migrations and fixtures
- `supabase gen types` — generating `src/lib/database.types.ts`
- `supabase test db` — RLS and database tests
- integration tests, which exercise the real transactional procedures
- end-to-end tests, which need a running application with real data
- any manual sign-in or click-through of the application

Installing Docker Desktop needs administrator rights, a multi-gigabyte
download, a WSL 2 installation, and a restart. That is a change to the
machine, not to this repository, so it was left for the Product Owner to make.
`npm run preflight` prints the exact remedy.

**Nothing in this repository fakes its way around that.** No mock database, no
stubbed Supabase client, no test that passes because it was skipped.

---

## 2. Verification results

Produced by `npm run verify` on 5 August 2026.

| Gate                  | Result   | Notes                           |
| --------------------- | -------- | ------------------------------- |
| SQL syntax            | **PASS** | 355 statements across 15 files  |
| Secret scan           | **PASS** | No credentials in tracked files |
| Format check          | **PASS** | Prettier                        |
| Type check            | **PASS** | `tsc --noEmit`, strict          |
| Unit tests            | **PASS** | 86 tests across 4 files         |
| Production build      | **PASS** | `next build`, lint included     |
| Database reset        | _SKIP_   | Needs Docker                    |
| Generated types match | _SKIP_   | Needs Docker                    |
| RLS / database tests  | _SKIP_   | Needs Docker                    |
| Integration tests     | _SKIP_   | Needs Docker                    |
| End-to-end tests      | _SKIP_   | Needs Docker                    |

**7 passed, 0 failed, 5 skipped.** `npm run verify` exits 2 when anything was
skipped, so a skipped gate can never be mistaken for a green one.

### The schema does now execute

`npm run check:schema` applies all 14 migrations and the seed to a real
PostgreSQL 18 engine running in-process (PGlite — the genuine parser, planner,
and executor compiled to WebAssembly), then exercises the transactional
procedures against the loaded fixtures. It needs no Docker, so it runs on this
machine and in any environment.

Sixteen behaviour checks pass, covering the rules the product turns on:

- focus counting reads committed state, and the target resolves to the approved 5
- within-target activation succeeds in one call
- crossing the target returns `reason_required` at 5 → 6 of 5 — exactly one
  question, and activation is never blocked
- activation proceeds once a reason is given, with `over_target` set
- "Other" without a note is rejected
- a repeated click replays the first result rather than acting twice
- a stale version is rejected as `version_conflict`
- audit events reject a content rewrite
- routine occurrence generation is idempotent across re-runs
- a date-only commitment is not overdue during the afternoon of its due date
- a team member cannot delete a user; an administrator cannot delete one with
  retained history; a history-free account deletes after ID confirmation, and
  the security-log entry outlives the row
- Amer sees Izzah and Ajmal through the explicit grant, and does not see Lim

Running it found four real defects a syntax check could never have caught, all
now fixed: a seeded completed task with no `completed_at`; a `record` variable
passed where a `routine_templates` composite was required; an `ON CONFLICT` that
did not repeat its partial index predicate, which silently broke idempotent
routine generation; and a retained-history rule that counted an account's own
`user_created` event and so made every properly created account undeletable.

**What this still does not prove.** PGlite is a single-user engine with no
GoTrue and no PostgREST, so the harness stands in a minimal `auth` and `storage`
surface. RLS policies are verified only as far as compiling and attaching —
whether they **allow and deny correctly** for `anon`, `authenticated`, and
`service_role` under real JWTs is still unproven and needs `supabase test db`.
That is now the largest remaining piece of unverified work.

---

## 3. What is implemented

### Database (`supabase/migrations/`, 14 forward-only migrations)

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

- RLS tests (`supabase/tests/`) — including the Amer/Izzah/Ajmal case, which is
  an explicit acceptance gate. The fixtures for it are seeded and waiting.
- Integration tests (`tests/integration/`) — `vitest.config.ts` references
  `tests/integration/setup.ts`, which does not exist yet, so that project cannot
  run even with Docker present.
- End-to-end and accessibility tests (`tests/e2e/`).

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
