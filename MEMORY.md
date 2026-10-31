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

**Last verified:** 31 October 2026 · production at migration
`20261030004000` (v271) · documents written against `main` @ `9c7f6ee`

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
- `npm run verify` runs 16 gates. **Never pipe it** (AGENTS.md §27).

---

## 2. Current status

Nothing is broken, nothing is half-finished, and every branch worth keeping is
merged. Production runs every migration in this repository, confirmed against a
fresh schema dump rather than the CLI's word.

**Deployed and complete:** v262 (owner screens on a phone, 8h idle / 12h maximum
guest session) · v263–v267 (interim controls, who is actually slow, blockers,
evidence kind, effectiveness checks) · v268 (effectiveness reminders) · v269
(four audit gaps) · v270 (background evidence scanning, photo compression) ·
v271 (**fixed v270, which was inert**, and keeps the camera's own file).

**Known risks** — the full register is in `PROJECT_PROGRESS.md`:

| Risk                                                            | Severity |
| --------------------------------------------------------------- | -------- |
| **354 evidence/attachment files have no backup**                | **High** |
| Vercel `ATTACHMENT_ALLOWED_MIME` / `EMAIL_TRANSPORT` unverified | Medium   |
| No scanner hosted (honest: files read "Not scanned")            | Low      |
| Public dashboard differencing                                   | Low      |

---

## 3. Next steps, in priority order

1. **Back up the evidence files.** See §5 for exactly where to start.
2. **Host the scanner** — a decision and a card, not engineering. Cloud Run
   scaling to zero is ≈$0/month if the signature databases are baked into the
   image *and that image is rebuilt weekly*; Fly.io always-on is ≈$13/month at
   2GB, ≈$25 at the 4GB ClamAV recommends. Then set `ESH_SCANNER_URL` **and**
   `ESH_SCANNER_TOKEN` in Vercel and redeploy. See
   `docs/evidence-scanner-deployment.md` and `deploy/evidence-scanner/`.
3. **Check two Vercel variables** — user action; they cannot be read back.
4. **`TREND_MINIMUM_EVENTS = 10`** in `src/domain/esh-dashboard.ts` — a product
   judgement about when the sign-in-free page may name a backlog direction.
5. **Public-dashboard suppression below a threshold.**

Items 2–5 need a credential or a product decision. Item 1 does not, which is
why it is first.

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

**Backups are three files** — `*-schema.sql`, `*-data.sql` (`auth` + `public`,
the proven one) and `*-storage.sql`. `storage` is split out because Supabase owns
that schema and a hosted project runs a newer Storage than the local CLI bundles.
What _proved_ means depends on provenance: a local dump is checked against the
counts this database held a moment ago; a cross-environment dump is checked
against **itself** — it must load with zero errors, every table it carries must
hold rows, and `auth.users` must not be empty.

Three settled product decisions not to re-raise: no delivery ticks, no owner
bulk UI, rollout not yet. See `PROJECT_PROGRESS.md` → _Settled decisions_.

---

## 5. Last agent handover note

**Open `scripts/backup-database.mjs` at line 112.**

```js
110:  dump(targetArgs, schemaFile);
111:  dump([...targetArgs, '--data-only', '--schema', 'auth,public'], dataFile);
112:  dump([...targetArgs, '--data-only', '--schema', 'storage'], storageFile);
```

Those three lines back up the _database_. Nothing backs up the **bucket
contents** — 354 objects, 349 in `task-attachments` and 5 in `finding-evidence`.
`storage.objects` is a row per file, not the file, so today a restore produces a
database that names evidence nobody can open. That defeats the point of v271,
which exists so somebody can produce a full-size original years later.

Add a step after line 112 that copies both private buckets into the same
`../tamco-focus-backups/` folder, keyed by `object_key` so a restore can match
rows to files, with a manifest recording each object's size and sha256. Then
extend `scripts/verify-restore.mjs` to **prove** it the way the rest of the loop
is proven — restore the files and compare hashes, not merely count them — and
correct the _What is not in the backup_ section of `BACKUP_AND_RECOVERY.md`,
which currently states plainly that the files are not covered.

Read first, in this order:

1. `AGENTS.md` §27 — nine environment facts that have each cost a day
2. `BACKUP_AND_RECOVERY.md` — three faults that each reported a perfectly good
   backup as unprovable, and the shape of a proof that holds
3. `scripts/verify-restore.mjs` — the proof loop, especially `dumpSource()` and
   `tablesInDump()`
4. `PROJECT_PROGRESS.md` — the canonical current state

`src/server/esh/evidence.ts` shows how the server reaches a private bucket
(`createSupabaseServiceRoleClient().storage.from(…)`). Write backups **outside**
the repository, as the existing script does, so one can never be committed.
