# TAMCO Focus — cloud migration assessment

Date: 11 August 2026
Scope: infrastructure migration only. No product redesign, no ESH modules.

This is Phase 1: what exists, what depends on this PC, and what has to be
decided before anything leaves it.

---

## A. Application

| Item              | Value                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Framework         | Next.js 16.3 (App Router, Turbopack), React 19.2                                                               |
| Language          | TypeScript 5.9, strict                                                                                         |
| Package manager   | npm 11.13 (`packageManager` pinned)                                                                            |
| Node              | `>=20.11`; developed on 24.16                                                                                  |
| Build             | `npm run build`                                                                                                |
| Typecheck / lint  | `npm run typecheck` / `npm run lint` (`--max-warnings=0`)                                                      |
| Tests             | `test:unit` (138), `test:integration` (98), `db:test` (50 pgTAP), `test:e2e` (87 across 5 viewports)           |
| Full gate         | `npm run verify` — 16 gates, currently all passing                                                             |
| Deployment so far | None. `CLAUDE.md` explicitly forbade deploying, linking hosted Supabase, adding a remote or connecting Vercel. |

**`CLAUDE.md` now contradicts the approved instruction** and is updated as part
of this migration; the prohibition was for the local-build stage, which has
ended.

---

## B. Supabase

Local stack: Postgres 17, GoTrue, PostgREST, Storage, Mailpit. Realtime,
imgproxy, edge runtime, analytics, vector and pooler are disabled.

| Object class    | Count / note                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Migrations      | 60 forward-only files, `20260805000100` → `20260811001000`                                                                                                                                                         |
| Schemas         | `public` (application), `focus` (private helpers), plus Supabase-managed                                                                                                                                           |
| Tables          | ~45 in `public`                                                                                                                                                                                                    |
| Views           | `task_overview`, `goal_overview`, `shared_contributions`, `plan_events`, `team_directory`, `action_requests_overview`, `goal_plan_overview`, `goal_session_overview`, `decisions_pending` — all `security_invoker` |
| RPCs            | ~70 `security definer` procedures in `public`, all `revoke`d from `public`/`anon` and granted to `authenticated`                                                                                                   |
| Private helpers | `focus.*` — RLS predicates, audit writers, idempotency (`replay_operation` / `remember_operation`)                                                                                                                 |
| Triggers        | version bumps, `updated_at`, terminal-projection cleanup, notification fan-out, audit immutability                                                                                                                 |
| Enums           | `app_role`, `task_status`, `focus_bucket`, `goal_status`, `goal_health`, `goal_session_kind`, and others                                                                                                           |
| RLS             | Enabled on every application table; policies delegate to `focus.*` predicates                                                                                                                                      |
| Auth            | `enable_signup = false` (administrators provision accounts); email provider enabled; refresh-token rotation on                                                                                                     |
| Storage         | One bucket, `task-attachments`, **private**, 10 MB limit, MIME allow-list, RLS-backed policies                                                                                                                     |
| Scheduled work  | **None inside Supabase.** See section D.                                                                                                                                                                           |
| Realtime        | Not used                                                                                                                                                                                                           |

---

## C. Environment variables

| Variable                            | Purpose                                  | Class         | Local | Staging | Production |
| ----------------------------------- | ---------------------------------------- | ------------- | ----- | ------- | ---------- |
| `NEXT_PUBLIC_SUPABASE_URL`          | Supabase endpoint                        | PUBLIC        | ✔     | ✔       | ✔          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`     | Browser key, constrained by RLS          | PUBLIC        | ✔     | ✔       | ✔          |
| `SUPABASE_SERVICE_ROLE_KEY`         | Bypasses RLS; provisioning + workers     | SERVER_SECRET | ✔     | ✔       | ✔          |
| `ORG_TIMEZONE`                      | Duration and overdue rendering           | PUBLIC-ish    | ✔     | ✔       | ✔          |
| `WEEKLY_SUMMARY_DAY` / `_HOUR`      | Weekly worker schedule                   | CONFIG        | ✔     | ✔       | ✔          |
| `ATTACHMENT_MAX_BYTES`              | Upload limit (mirrors bucket)            | CONFIG        | ✔     | ✔       | ✔          |
| `ATTACHMENT_ALLOWED_MIME`           | Upload allow-list                        | CONFIG        | ✔     | ✔       | ✔          |
| `ATTACHMENT_SIGNED_URL_TTL_SECONDS` | Signed-URL lifetime                      | CONFIG        | ✔     | ✔       | ✔          |
| `ATTACHMENT_VIRUS_SCAN_ENABLED`     | Honest `false`; nothing is fabricated    | CONFIG        | ✔     | ✔       | ✔          |
| `EMAIL_TRANSPORT`                   | `log` locally; provider later            | CONFIG        | ✔     | ✔       | ✔          |
| `EMAIL_FROM`                        | Sender identity                          | CONFIG        | ✔     | ✔       | ✔          |
| `EMAIL_SMTP_HOST` / `_PORT`         | Mailpit locally                          | LOCAL_ONLY    | ✔     | —       | —          |
| `APP_BASE_URL`                      | Absolute links in email                  | CONFIG        | ✔     | ✔       | ✔          |
| `SEED_USER_PASSWORD`                | Local fixture accounts                   | LOCAL_ONLY    | ✔     | —       | **never**  |
| `TAMCO_ENV`                         | **New.** Positive environment identity   | CONFIG        | ✔     | ✔       | ✔          |
| `CRON_SECRET`                       | **New.** Authenticates the cron endpoint | SERVER_SECRET | —     | ✔       | ✔          |

No secret is committed. `.env.example` carries names and local defaults only.

---

## D. Dependencies on this PC

| Thing                           | Today                                     | Consequence if the PC is off                |
| ------------------------------- | ----------------------------------------- | ------------------------------------------- |
| Routine occurrence generation   | `npm run worker:routines` (manual, `tsx`) | **Routines never appear.** Go-live blocker. |
| Weekly summary email            | `npm run worker:weekly` (manual, `tsx`)   | No weekly summary. Lower severity.          |
| SMTP                            | Mailpit on `127.0.0.1:54325`              | No mail leaves the machine at all.          |
| Supabase                        | Docker Desktop containers                 | Application has no database.                |
| `APP_BASE_URL`                  | `http://localhost:3000`                   | Email links point at nothing.               |
| Auth `site_url` / redirect URLs | `http://localhost:3000`                   | Hosted sign-in would redirect to localhost. |

Everything above is addressed in this migration except SMTP, which stays
deferred: in-app notification is sufficient for the pilot, but **password
recovery needs a real mail path** and is tracked as a required input.

---

## E. Data classification

Local row counts, taken 11 August 2026:

| Table                     | Rows | Classification                                         |
| ------------------------- | ---- | ------------------------------------------------------ |
| `user_profiles`           | 7    | Development fixtures — every address is `@tamco.local` |
| `tasks`                   | 28   | Development fixtures                                   |
| `task_checklist_items`    | 46   | Development fixtures                                   |
| `barriers`                | 1    | Development fixture                                    |
| `goals` / `goal_versions` | 4/4  | Development fixtures                                   |
| `goal_milestones`         | 16   | Development fixtures                                   |
| `notifications`           | 2    | Development fixtures                                   |
| `meeting_queue_items`     | 1    | Development fixture                                    |
| `work_proposals`          | 1    | Development fixture                                    |
| `audit_events`            | 26   | Development fixtures                                   |
| `routine_templates`       | 2    | Development fixtures — but the _shape_ is reference    |
| `performance_periods`     | 2    | **Reference** — generated by migration, not seeded     |
| `employee_goal_plans`     | 3    | Derived from fixture Goals                             |
| `org_settings`            | —    | **Reference** — application configuration              |

**There is no genuine business data on this machine.** Nothing needs migrating
into Production: Production is built from migrations plus reference
configuration plus the six approved users. No ambiguous data exists, so no
owner review of ambiguous records is required.

---

## Findings that need a decision

### 1. Vercel Hobby forbids commercial use — go-live blocker

The Hobby plan is licensed for personal, non-commercial projects. An internal
work-management tool used by TAMCO employees for company work is commercial use,
however small the pilot. Deploying there would breach the plan terms, and §34
and §58 of the instruction forbid misrepresenting usage.

Options, for the owner:

- **Vercel Pro** — $20/user/month, permits commercial use. Smallest change.
- **A different free host whose terms permit business use** — Cloudflare Workers
  (OpenNext adapter) or self-hosting on a small VPS. Both need build changes.
- **Defer** — keep the pilot on the local machine until a plan is chosen.

Marked `BLOCKED_PENDING_CONFIGURATION`. Everything up to the Vercel connection
proceeds regardless; the choice only gates Phases 9, 13 and beyond.

### 2. `administrator` currently carries business-manager authority

`focus.is_admin()` appears throughout the Goal and Task authority helpers, so
today an administrator can agree a Goal, cancel a Goal, reassign work and cancel
work. Sections 17 and 52 require the opposite: account administration and
business management must be separate, and §52 makes it a go-live gate.

Addressed in this migration as a designed change with tests, not a quiet edit —
see `SECURITY_ACCEPTANCE_REPORT.md`.

### 3. Supabase Free has no automated backups

Point-in-time recovery and scheduled backups are paid features. With free
Production, backup is our responsibility, which is why §40–41 exist. A scripted
logical backup plus a proven restore is part of this migration.

Free projects also pause after 7 days without activity. A pilot in daily use
will not hit that, but a quiet week will, and the cron job below also keeps the
project warm.

### 4. `.env.example` contained a plaintext password

`SEED_USER_PASSWORD=LocalFocus123!` was committed. It is a local fixture
password with no reach beyond this machine, but §23 forbids plaintext passwords
in environment examples without qualification. The value is removed; the name
stays.

### 5. Two free Supabase projects are available

The free tier allows two active projects per organisation, so Staging and
Production can both be hosted and Preview never needs to touch Production.
