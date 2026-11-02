# MEMORY.md — agent handover for TAMCO Focus

**Read this first, then `PROJECT_PROGRESS.md`.**

This page orients a new agent in two minutes and hands it a line number. It is
deliberately short.

> **`PROJECT_PROGRESS.md` is the single source of truth** (`AGENTS.md` §19).
> When state changes, update that file. Update this one only where the five
> sections below stop being true. If the two ever disagree,
> `PROJECT_PROGRESS.md` wins and this file is the bug.
>
> `AGENTS.md` holds the permanent development rules, including §27 — nine
> environment facts that have each already produced a wrong conclusion here.
> Read §27 before running anything.

**Last verified:** 31 October 2026 · backup prerequisite on `codex/evidence-storage-backup` based on `origin/main` @ `2591c27`; fresh user-run Production schema dump inspected locally on 31 October (v271 evidence objects present, v4.1 QR intake absent).

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

The Production evidence backup is restore-proven. The authorized user ran it on 31 October; the saved manifest has 354 objects (349 task attachments, 5 finding evidence). The agent checked every saved byte hash, restored all 354 objects to isolated local Storage, downloaded them and matched sizes and SHA-256. The Production data dump loaded 69 populated tables and 8 identities locally. `npm run db:reset` returned local to fixtures with exit 0. Full unpiped `npm run verify` passed 17/17. Backup PR #50 is ready for review; Stage 0 PR #49 is stacked on it. Each passed all three jobs in a dispatched workflow on its original implementation commit (626 browser cases passed, 155 intentionally skipped). The user approved local-only Stage 1 testing on 31 October. Stage 0 awaits full CI on its rebased branch before its gate closes.

**Deployed and complete:** v262 (owner screens on a phone, 8h idle / 12h maximum
guest session) · v263–v267 (interim controls, who is actually slow, blockers,
evidence kind, effectiveness checks) · v268 (effectiveness reminders) · v269
(four audit gaps) · v270 (background evidence scanning, photo compression) ·
v271 (**fixed v270, which was inert**, and keeps the camera's own file).

**Known risks** — the full register is in `PROJECT_PROGRESS.md`:

| Risk                                                            | Severity |
| --------------------------------------------------------------- | -------- |
| Hosted Staging remains unverified; S1 testing is local only     | Medium   |
| Vercel `ATTACHMENT_ALLOWED_MIME` / `EMAIL_TRANSPORT` unverified | Medium   |
| No scanner hosted (honest: files read "Not scanned")            | Low      |
| Public dashboard differencing                                   | Low      |

---

## 3. Next steps, in priority order

1. **Complete backup PR #50 review.** Local recovery and dispatched CI passed; the PR is ready for review and unmerged. Its ten backup guards run in the existing CI unit step without a workflow-file change.
2. **Finish v4.1 Stage 0 gate.** PR #49 has the baseline/delta report, package tracker and eight fixture-only desktop/mobile captures. The user approved local-only Stage 1 testing; no hosted or Production deployment is approved. Confirm dispatched CI on the rebased Stage 0 branch, then begin S1 in its own branch/PR.
3. **Host the scanner** — a decision and a card, not engineering. Cloud Run
   scaling to zero is ≈$0/month if the signature databases are baked into the
   image *and that image is rebuilt weekly*; Fly.io always-on is ≈$13/month at
   2GB, ≈$25 at the 4GB ClamAV recommends. Then set `ESH_SCANNER_URL` **and**
   `ESH_SCANNER_TOKEN` in Vercel and redeploy. See
   `docs/evidence-scanner-deployment.md` and `deploy/evidence-scanner/`.
4. **Check two Vercel variables** — user action; they cannot be read back.
5. **`TREND_MINIMUM_EVENTS = 10`** in `src/domain/esh-dashboard.ts` — a product
   judgement about when the sign-in-free page may name a backlog direction.
6. **Public-dashboard suppression below a threshold.**

Item 2 needs the deployment/approval decision; items 3–6 need a credential or
product decision.

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

## 5. Last agent handover note

Current branch: `codex/finding-v41-stage0`, stacked on backup branch
`codex/evidence-storage-backup` @ `1de7ef0`. Check current HEAD and PR state;
the approval/checkpoint commit will advance HEAD.
Check current HEAD and PR/workflow state before continuing.
`PROJECT_PROGRESS.md` is the current-state authority.

The backup prerequisite now copies actual bytes from both private buckets into
an outside-Git, complete-run directory. `storage-manifest.json` records exact
bucket/key, downloaded size and SHA-256; a failed run stays `.incomplete`.
`scripts/verify-restore.mjs` validates saved bytes before truncating local,
then uploads to local private Storage, reads back and compares size/hash. See
`scripts/lib/storage-backup.mjs`, `BACKUP_AND_RECOVERY.md` and the ten guard
tests in `tests/scripts/storage-backup.test.mjs`.

Verified locally on 31 October: `node --test tests/scripts/storage-backup.test.mjs`
passed 10/10. A real local backup copied two harmless proof objects with the
same nested key in different buckets; `npm run restore:verify` restored all
40 populated tables at full count and read both objects back at matching
size/hash. The proof objects were removed and `npm run db:reset` returned
local to fixtures. The user then made a new local run at
`D:/AI Project/Task Management/tamco-focus-backups/tamco-focus-local-2026-10-31T05-51-03-158Z-445267`;
its manifest lists zero objects. `npm run restore:verify -- <that directory>`
restored all 40 populated tables, and `npm run db:reset` exited 0 afterward.
Full unpiped `npm run verify` passed 17/17 gates with exit 0:
748/748 pgTAP, 401/401 integration and 626 passed / 155 intentionally skipped
Playwright cases. The final ten backup guards passed in a separate targeted run
after the full gate began. The final `test:unit` script also passed 550 unit
tests plus all ten backup guards. GitHub rejected the original branch because
the configured PAT cannot update workflow files. The unpublished branch was
rebuilt without a workflow-file diff; the existing CI unit step now invokes
the backup guards. Backup PR #50, ready for review, is
`https://github.com/Asyrafbangs/tamco-focus/pull/50`; full workflow run
`https://github.com/Asyrafbangs/tamco-focus/actions/runs/41180345379`
passed static, database/RLS/integration and on-demand browser jobs at
`8f13d37`; the browser job reported 626 passed and 155 intentionally skipped.
PR CI run `41183430389` passed static, database/RLS/integration and production
build on documentation-only handover commit `149c1aa`; its browser job was
skipped by the repository's pull-request trigger rule.
Stage 0 draft PR #49 passed the same three jobs at `030bf19` in run
`https://github.com/Asyrafbangs/tamco-focus/actions/runs/41179525074`.
Subsequent checkpoint edits are documentation only. Neither PR is merged.

**Production backup and recovery were proven on 31 October** from a fresh
user-run backup, without agent access to Production. Complete run:
`D:/AI Project/Task Management/tamco-focus-backups/tamco-focus-production-2026-10-31T06-30-14-696Z-014892`.
The manifest lists 354 objects, 349 in `task-attachments` and 5 in
`finding-evidence`, totalling 107,357,176 downloaded bytes. Every saved file
matched its recorded size and SHA-256. The first user restore attempt correctly
refused because `.env.local` resolved to Production. The agent then set the
Supabase URL and service-role key from positively identified **local** CLI
status in a process environment, ran `npm run restore:verify -- <run>`, and
confirmed that 69 Production data tables loaded (8 identities) and all 354
objects uploaded to isolated local Storage, downloaded and matched size/hash.
The local `npm run db:reset` exited 0 afterward. The fresh schema dump was
searched locally with `rg`: v271 source and scan guard symbols are present;
`esh_report_intake` and `esh_qr_locations` are absent. Do not infer current
Vercel variables or staging readiness from this dump.

The v4.1 package at
`D:/Download/TAMCO_Finding_Management_v4.1_Claude_Complete_Build_Package.zip`
was read in numeric order and its illustrative screenshots inspected. The
Stage 0 baseline/delta report, tracker and eight local-fixture captures were
originally committed as `030bf19` in `codex/finding-v41-stage0` at
`C:/Users/User/.codex/visualizations/2026/10/31/01a18fb9-87ef-7f11-aeba-43d8967c29d9/v41-review/stage0-worktree`.
Draft PR: `https://github.com/Asyrafbangs/tamco-focus/pull/49`. Full workflow:
`https://github.com/Asyrafbangs/tamco-focus/actions/runs/41179525074`
passed all three jobs at `030bf19`, including the browser suite. The branch
is now stacked on backup PR #50; its new HEAD requires a dispatched full run.
The user approved local-only Stage 1 testing, but the S0 gate stays unchecked
until that run passes. No v4.1 feature is implemented. Do not deploy Production
or publish QR intake before the package's security, operational and approval
gates pass.
