# MEMORY.md — agent handover for TAMCO Focus

**Read this first, then `PROJECT_PROGRESS.md`.**

This page orients a new agent in two minutes and hands it a line number. It is
deliberately short.

> **`PROJECT_PROGRESS.md` is the single source of truth** (`AGENTS.md` §19).
> When state changes, update that file. Update this one only where the five
> sections below stop being true. If the two ever disagree,
> `PROJECT_PROGRESS.md` wins and this file is the bug.
>
> `AGENTS.md` holds the permanent development rules, including §27 — the
> environment facts that have each already produced a wrong conclusion here.
> Read §27 before running anything.

**Checkpoint reconciled:** 12 November 2026 · `origin/main` @ `10825e6`
contains the merged v4.1 implementation through S6: private intake, reviewed
links and patterns, workflow hardening, supplied hazard classification, public
QR implementation, readiness tooling and QR locations (PRs #52–#60). This
reconciliation made no live Production read or configuration change. Historical
owner evidence records v279, v280 and v286–v290 as applied; see
`PROJECT_PROGRESS.md` and `docs/finding-management-v4.1/deployment-2026-11-04.md`.

A commit hash in a document goes stale the moment the document is merged, so
treat that one as provenance, not as the current head. For the head, run
`git log --oneline -1`. The migration version above is the claim worth
checking, and `AGENTS.md` §27 says how to check it against production.

---

## 1. Project overview & tech stack

TAMCO Focus is a lean work-management system for one organisation, with three
surfaces in one codebase:

| Surface                  | Route group | Who uses it                                                             |
| ------------------------ | ----------- | ----------------------------------------------------------------------- |
| Today, Work, Goals, Team | `(app)`     | signed-in employees                                                     |
| ESH Finding Management   | `(esh)`     | ESH Coordinators and Verifiers                                          |
| Action Owner response    | `respond`   | factory-floor owners, **no account** — passwordless 24-hour email links |

- **Next.js 16.3.0**, App Router, React 19, Server Components and Server
  Actions, strict TypeScript. Read `node_modules/next/dist/docs/` before writing
  code: this is not the Next.js in anyone's training data.
- **Supabase** (hosted, ref `ypxbykvyjjtroyftzemi`, ap-southeast-1, free plan).
  RLS on every table, `SECURITY DEFINER` procedures returning
  `jsonb {ok, code, …}`, `security_invoker` views, two private storage buckets.
  **Migrations and RLS are the authority**; clients never duplicate permission
  or state-transition logic.
- **Vercel** hosting. The scheduled worker is `src/app/api/cron/route.ts`.
- **Tests**: Vitest (`unit`, `integration`), pgTAP via `supabase test db`,
  Playwright across 5 viewport projects — all Chromium, `workers: 1`,
  `fullyParallel: false`, **one shared database**.
- `npm run verify` runs 17 gates, including backup guards. **Never pipe it**
  (AGENTS.md §27).

---

## 2. Current status

S0–S6 implementation is complete in merged history. The lean package supplied
the nine-category taxonomy that had initially been held back; v287 preserves
the original safety rule by making classification optional and audited, with no
historical backfill. Stage A hardens uploads and scanner truthfulness, while
Stage D/E add readiness tooling and safe QR-location administration.

This does **not** authorize an activation. The current automation must leave
public QR intake, public uploads, emergency notification delivery, scanner
hosting and Production rollout disabled. Pilot operation still requires the
owner's privacy, safety-routing, queue-ownership and rollout decisions.

**Historical deployment evidence:** v279, v280 and v286–v290 were recorded as
applied by 7 November. Treat that as dated evidence only: before any new
Production change, establish current state using the readiness runbook.

**Known risks** — the full register is in `PROJECT_PROGRESS.md`:

| Risk                                                            | Severity |
| --------------------------------------------------------------- | -------- |
| Hosted Staging remains unverified; S1 testing is local only     | Medium   |
| Vercel `ATTACHMENT_ALLOWED_MIME` / `EMAIL_TRANSPORT` unverified | Medium   |
| No scanner hosted (honest: files read "Not scanned")            | Low      |
| Public dashboard differencing                                   | Low      |

---

## 3. Next steps, in priority order

1. **Do not add further S2–S6 code.** Reconcile the tracker and project
   checkpoint against merged history before treating older stage notes as live.
2. **Keep all public/operational controls disabled.** No QR opening, public
   upload, notification route, scanner host or rollout belongs to an agent.
3. **When the owner explicitly chooses a pilot,** use
   `production-readiness-runbook.md` to establish current deployment state and
   record queue ownership, safety routing, privacy/retention and pilot terms.

---

## 4. Technical decisions & context

**Nothing ever claims a file was checked when it was not.** `scan_state` has
five values, and `not_scanned` (nobody looked), `unavailable` (somebody tried
and could not) and `clean` are three different things. A pgTAP assertion holds
that line: without `unavailable`, an outage looks like a clean bill of health.

**Scanning never blocks the owner.** They upload, the file attaches, they
submit; the scan happens afterwards on the scheduled worker. Somebody on a plant
floor with one bar of signal is not made to wait for a virus scanner, and a
scanner that is down does not stop work being reported.

**Quarantine reuses `state = 'rejected'`**, which every existing read already
excludes — one change closed every download path instead of adding a condition
to each.

**Both copies of a photograph are kept (v271).** The compressed copy goes up
first and is what everyone views; the untouched camera file follows in the
background, and the owner waits for neither. If the second upload never arrives,
`source_state` says so rather than implying an original exists, and a CHECK
refuses `kept` without the key, size, hash and timestamp to back it. The
**scanner reads the source file**, and keeping one **resets the scan** — a canvas
re-encode cannot carry what the camera's file carried.

**Sent evidence is immutable; facts learned about it are not.**
`focus.esh_reject_sent_evidence_change` lists the _mutable_ columns, so a column
added later is immutable until somebody names it. The failure mode of
forgetting is a refused update, not an editable record. `state` is mutable for
exactly one move: `ready → rejected` with `scan_state = 'infected'`.

**A remote scanner needs a shared secret.** Every byte of somebody's evidence is
POSTed to `ESH_SCANNER_URL`, so the worker refuses a non-loopback URL with no
`ESH_SCANNER_TOKEN`. Loopback is exempt; that is how it runs locally.

**A complete backup run** contains `*-schema.sql`, `*-data.sql` (`auth` +
`public`), `*-storage.sql`, `storage-manifest.json` and the private bucket
bytes. `storage` SQL is split out because Supabase owns that schema and a
hosted project runs a newer Storage than the local CLI bundles. A local data
dump is checked against the counts this database held a moment ago; a
cross-environment dump is checked against **itself** — zero load errors,
rows in every table it carries, and nonempty `auth.users`. Storage proof
uploads saved bytes to isolated local Storage and checks downloaded hashes.

Three settled product decisions not to re-raise: no delivery ticks, no owner
bulk UI, rollout not yet. See `PROJECT_PROGRESS.md` → _Settled decisions_.

---

## 5. v4.1 completion checkpoint

The durable S2–S6 invariants are now implemented:

- staff intake stays server-authorized and department-scoped; a negated scope
  check is `<> all`, never `<> any`;
- reviewed links and pattern counts only expose findings both ends may see;
- hazard classification is an optional coordinator action over stable supplied
  category codes, never an inferred historical rewrite;
- urgent safety workflow notices are not left behind ordinary outbox backlog;
- public controls are reversible and must remain disabled until an owner runs a
  separately approved pilot.

## 6. Last agent handover note

The v4.1 stages are merged to `origin/main` through PR #60. Do not use the old
stage worktrees or their pre-merge notes as a current checkpoint. Read
`PROJECT_PROGRESS.md` first, then the tracker and the specific stage document
for historical rationale.

Three things worth knowing before you run anything:

- **Read `AGENTS.md` §27 first.** It is the list of environment facts that have
  each already cost a day here, and it now includes two more: the framework's
  development badge is a button on every page that collides with a spec looking
  for a form's Next button, and the browser suite leaves its fixtures behind so
  a register view outgrows its first page. `npm run db:reset` before a gate run
  you intend to believe.
- **A green run proves only the jobs that ran.** Confirm the browser job before
  treating CI as end-to-end evidence.
- **Production is not readable from here.** Establish current state from a
  fresh owner-run backup or the documented readiness procedure; never infer it
  from an old dump or `db push` output.

`PROJECT_PROGRESS.md` is the current-state authority, and the history that used
to sit in this section lives there.
