# PROJECT_PROGRESS.md

The single maintained checkpoint for current state, per `AGENTS.md` section 19.
Factual and verified against the repository, not against conversation claims.

`handoff.md` was an untracked duplicate of this information and has been
removed; what was durable in it is below. Do not reintroduce a second
current-state document.

**Last verified:** 4 October 2026 · **main** @ `a91ee6b`

---

## Current objective

None outstanding. The My Team redesign (v233–v250), the CI and fixture
corrections that followed (v251–v255), and the test-quality work in v256 are
complete. Remaining items are listed under _Remaining work_ and are small or
need a decision.

## Current verified state

| Area         | State                                                                             |
| ------------ | --------------------------------------------------------------------------------- |
| Branch       | `main` @ `e4bee94`, in sync with `origin/main`                                    |
| Open work    | `behavioural-fixture-assertions` @ `d66296f` (v256)                               |
| Migrations   | 174; `local` == `remote` through `20261001001000`. **None created in v233–v256.** |
| Schema drift | None. Type diff is 48 lines, all `__InternalSupabase` and parenthesis formatting. |
| Local seed   | 9 users, 52 tasks. Waiting view renders 20 rows.                                  |
| Production   | Live, untouched by this work. No `db push`, no remote reset.                      |

### Validation last run (4 October)

| Gate                     | Result                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full `npm run verify`    | 15/16. The one failure was `Format check` on `scripts/check-schema.mjs`, CRLF-only with identical content; resolved, and `prettier --check .` now passes. |
| End-to-end               | 605 passed, 146 skipped, 23.5 min                                                                                                                         |
| RLS / database (pgTAP)   | 23 files, 648 tests, PASS                                                                                                                                 |
| Integration              | 401 passed                                                                                                                                                |
| Unit                     | 535 passed                                                                                                                                                |
| Production build + smoke | PASS — served sign-in, enforced headers, gated `/more`                                                                                                    |
| Generated types          | Match the local schema                                                                                                                                    |

This was the first complete local verification since v242. It needs Docker
running and roughly 3.5 GB free.

## Completed work

- **v233–v250** — My Team rebuilt as four views (Team, Waiting, Completed,
  Recent activity); density and severity brief implemented; `RevealCurrent`
  extracted; `layout-invariants-v244` added as a standing guard across 30+
  routes, two widths and two themes.
- **v251** — `ATTACHMENT_ALLOWED_MIME` removed from `.env.example`. It was
  restated there, had gone stale, and `scripts/write-env.mjs:22` copies that
  file to `.env.local` whenever none exists — so CI alone refused PowerPoint,
  HEIC, legacy Word and Excel. A unit guard now refuses any value there that
  narrows `DEFAULT_ALLOWED_MIME_TYPES`.
- **v252** — Team row titles clamp to one line above 860px and wrap again in
  the stacked form. A 64-character title previously wrapped a 38px row past
  56px at 900px. `team-row-one-line-v252.spec.ts` pins both halves.
- **v253** — Seeded titles lengthened to 61–70 characters; `TREND_MINIMUM_EVENTS`
  added; `SettingsWorkspace` now shares `RevealCurrent`; v244 extended to
  `/findings/new`, `/findings/import` and a resolved finding page.
- **v254** — Two dormant tests woken. `team-figures-v136` had skipped itself
  since v233, when the row gained columns and the owner moved out of
  `.team-waiting-main small`; it is the guard for a reported bug. The
  Playwright report now uploads on success so skips are auditable.
- **v255** — Seed backlog volume: 18 rows across two new fixture accounts,
  20 waiting in total.
- **v256** — Fixture-cardinality assertions replaced with behavioural ones
  (`AGENTS.md` §10, §11).

## Partial work

None.

## Remaining work

1. **`ATTACHMENT_ALLOWED_MIME` and `EMAIL_TRANSPORT` in Vercel** — user action.
   Vercel values cannot be read back. If `ATTACHMENT_ALLOWED_MIME` carries the
   stale list, production refuses HEIC photos and PowerPoint while the file
   chooser offers them. Unset is correct. Production once ran for weeks on the
   `log` email transport with every cron run returning 200, so `EMAIL_TRANSPORT`
   deserves the same check.
2. ~~`/findings/import/[batchId]`~~ — done in v257. The seed carries a staged
   batch of four rows, one per outcome, and the walk resolves it from the
   import list rather than hardcoding the id.
3. **`TREND_MINIMUM_EVENTS = 10`** in `src/domain/esh-dashboard.ts` — decides
   when the sign-in-free page will name a backlog direction. A product
   judgement, not a measurement; one line to change.
4. **Virus scanning and the email provider adapter** — both stubbed, both
   blocked on external services. `virus_scan_state` is pinned `not_scanned`
   deliberately; do not add scan states or a queue.

## Durable constraints

- `supabase/seed.sql` is local and CI only; its own header forbids applying it
  to a hosted environment. All fixture accounts are `@tamco.local`.
- The e2e CI job runs only on a push to `main` or a dispatch, so **a green pull
  request has run no browser test**. Check `gh run list --branch main`, or
  dispatch with `gh workflow run verify.yml --ref <branch>`.
- `autocrlf=true` here: `git checkout` rewrites files as CRLF and the Format
  gate then fails with an empty `git diff`. `prettier --write` on the named file
  fixes it without touching content. Several SQL test files have genuinely mixed
  endings within one file.
- The repository is shared with other sessions. Stage by name; never `git add -A`.
- Never pipe `npm run verify` — the exit code becomes the pipe's.

## Fixture constraints that reject work

Each of these refused a seed or test fixture and cost a run to diagnose:

- `urgency_level` has no `low`: it is `normal`, `high`, `critical`,
  `immediate_risk`.
- `work_origin` has no `assigned`: it is `manager_assigned`.
- A `paused` task requires restart information.
- The table is `task_checklist_items`, not `checklist_items`.
- `task_updates` carries `is_meaningful`, not `progress_percent`.
- Cancelling a completed task needs `completed_at: null` in the same update,
  or `tasks_completed_at_consistent` rejects it.
- `audit_events` is append-only, so a task carrying audit rows cannot be
  deleted. Fixtures must cancel instead.
- `supabase/seed.sql` is applied only by a local `db reset` and by PGlite in
  `scripts/check-schema.mjs`. Nothing deploys it.

## Settled decisions

Do not re-raise these without new information:

- **Team rows stay one line at 39px**, three columns. The two-line 52–58px
  reading of the density brief was considered and declined on 3 October.
- **Evidence is never scanned.** `virus_scan_state` is pinned `not_scanned`
  deliberately; do not add scan states or a queue.
- **Successful email delivery is not shown to the user**, and a normal Action
  Owner gets no bulk actions.
- **A direction needs both sides to have happened.** `backlogTrend` returns
  `too-early` rather than naming a direction from too few events, mirroring
  `onTimeRate` returning `null` rather than 100% from no closures.

## Known test brittleness

Resolved for the database suite in v258 and v259. Assertions that counted whole
tables or whole organisations now state what their own fixtures contributed, so
`npx supabase test db` passes whether or not the end-to-end import spec has run
first. Verified both ways: 23 files, 648 tests, with residue present and on a
reset database.

One assertion remains order-dependent on purpose:
`esh_weekly_reports_v204` test 28 checks the open count a leadership report
recorded, and that report is org-wide by definition, so any other open work
belongs in its total. Isolating it would mean narrowing the fixture's scope to
a single department and re-baselining several of that file's other assertions.
Run it on a reset database, as the gate order does.

## Blocker

None.

## Exact next action

Nothing unattended remains. Items 1 and 3 under _Remaining work_ need a
credential and a product decision respectively.

If more is wanted, the browser suite has the same habit in places: 148 of 751
tests skip, and 20 of those skip sites are conditional on fixture data rather
than on viewport. They were audited in v254 and all run today, but nothing
stops one going dormant again.
