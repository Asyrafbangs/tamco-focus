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

**Last verified:** 2 November 2026 · Stage 1 reviewed and corrected on `codex/finding-v41-stage1`, based on `origin/main` @ `10848ba` (Stage 0 and the backup prerequisite are merged). The last Production evidence is still the user-run schema dump of 31 October: v271 evidence objects present, v4.1 QR intake absent.

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

The backup prerequisite and Stage 0 are **merged** (PR #50, then PR #49 as merge commit `10848ba`). The backup loop now checks its own completeness against `storage.objects` rather than against the bucket listing it was built from, so a short listing can no longer produce a backup that passes every check while missing files; that was proven against the 31 October Production run, 354 recorded and 354 saved with every byte re-hashed.

Stage 1 is implemented and has been **reviewed against its own gate**, which found five defects the stage's own acceptance criteria ask about — a verification queue that showed six of however many were waiting, four controls lost from it in the move, a counter linking to a list that was not its own, two missing register views, and a menu item pointing at what is now Today. All five are fixed, each with a browser case proven by breaking what it guards. See `docs/finding-management-v4.1/stage1-review.md`. No schema change in Stage 1, and no hosted or Production deployment is approved.

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

1. **Await the Stage 2 decisions.** Stage 2 is QR intake, and it cannot begin until the anonymous-reporting, privacy, emergency-contact, retention/EXIF and safety-routing decisions are made. They are in `docs/finding-management-v4.1/07_BUILD_TRACKER.md` under _Decisions requiring human ownership_. **Do not invent any of them.**
2. **Everything the stage plan can do without those answers** — S3's category work and S5's hardening both touch them, so there is no stage to run ahead on. Ask rather than guess.
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

## 5. Current Stage 1 checkpoint

Today / Findings / Patterns navigation, the four Today counters, the Needs
attention queue, the disabled Incoming reports queue and the
department-preserving verification redirect are implemented on
`codex/finding-v41-stage1`, now based on `main`. The historical panels were
**moved, not rebuilt**: `/findings/patterns/insights` renders the same
`DashboardPanels` from the same queries, and the sign-in-free leadership route
is untouched.

Two rules this screen now keeps, and that a later stage must not undo:

- **A counter links to a list that holds exactly it.** Each of the three live
  counters has a named register view behind it, and a browser case compares the
  number with the view's own total. They are read through different paths — the
  `esh_dashboard` procedure and the register views under RLS — so the
  comparison is two answers to one question, not an assertion with itself.
- **The verification queue is complete.** It is the only route to a submitted
  correction, so it shows every waiting row; Today's card shows six and says
  how many it is not showing.

Stage 2 remains blocked by the documented QR, privacy and emergency-contact
policy decisions; do not invent them.

## 6. Last agent handover note

`main` is at merge commit `10848ba`: the backup prerequisite (PR #50) and Stage
0 (PR #49) are both in. Run `git log --oneline -1` rather than trusting that
hash. Stage 1 lives on `codex/finding-v41-stage1` / PR #51, rebased onto `main`,
reviewed and corrected; `docs/finding-management-v4.1/stage1-review.md` says
what the review found and how each fix was proven. The stacked Stage 2 branch
(PR #52, `codex/finding-v41-stage2`) exists but is **unreviewed** and its policy
inputs are undecided — do not merge it on the strength of a green run.

Three things worth knowing before you run anything:

- **Read `AGENTS.md` §27 first.** It is the list of environment facts that have
  each already cost a day here, and it now includes two more: the framework's
  development badge is a button on every page that collides with a spec looking
  for a form's Next button, and the browser suite leaves its fixtures behind so
  a register view outgrows its first page. `npm run db:reset` before a gate run
  you intend to believe.
- **A green pull request has run no browser test.** The e2e job runs only on a
  push to `main` or a dispatch: `gh workflow run verify.yml --ref <branch>`.
- **Production is not readable from here.** To establish what it contains, ask
  the user to run `npm run backup:database` with `TAMCO_ENV=production` set in
  the shell, then grep the resulting `*-schema.sql`. Take a fresh dump; `db
push` reporting "up to date" has misled before.

`PROJECT_PROGRESS.md` is the current-state authority, and the history that used
to sit in this section lives there.
