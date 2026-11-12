# PROJECT_PROGRESS.md

The single maintained checkpoint for current state, per `AGENTS.md` section 19.
Factual and verified against the repository, not against conversation claims.

`handoff.md` was an untracked duplicate of this information and has been
removed; what was durable in it is below. Do not reintroduce a second
current-state document.

**Checkpoint reconciled:** 12 November 2026 · this is a repository and
evidence reconciliation, not a new Production interrogation. `origin/main` @
`10825e6` contains the merged v4.1 work through the lean-package Stage D:
Stage 2 (PR #52), links and patterns (PR #53), hardening (PR #56), hazard
classification (PR #57), public-QR implementation (PR #58), readiness tooling
(PR #59), and QR locations (PR #60). The later operational evidence recorded
below states that v279, v280 and v286–v290 are applied in Production. No
current deployment setting was changed or inferred by this checkpoint.

---

## Current objective

Finish the independently implementable Finding Management v4.1 work through
S6 while preserving existing behaviour. The S2–S5 staff workflows, reviewed
links/patterns, workflow hardening and supplied hazard taxonomy are complete
in merged commits. S6 readiness tooling and QR-location administration are
also implemented. A pilot or any public/Production activation remains an
operational decision, not a remaining implementation task.

The current automation must keep public QR intake, public uploads, emergency
notification delivery, scanner hosting and rollout disabled. Existing historical
deployment records are evidence, not authority to change those controls.

## Current verified state

| Area                   | State                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Merged v4.1 work       | S0–S6 technical work is represented by PRs #49–#60; later work is on `origin/main` @ `10825e6`.                                          |
| Open implementation    | None identified for S2–S6. Public activation controls remain deliberately out of scope.                                                  |
| Migrations             | Historical owner evidence records v279, v280 and v286–v290 applied in Production.                                                        |
| Schema / type evidence | v287 added the supplied nine-category table and generated types; no drift is recorded.                                                   |
| Deployment evidence    | The latest record is `deployment-2026-11-04.md`, supplemented by the 7 November ledger note below. It is not a live read on 12 November. |
| Current validation     | This documentation reconciliation ran no test suite and makes no new validation claim.                                                   |

### Historical validation snapshot (30 October, for v271)

| Gate                  | Result                                                                    |
| --------------------- | ------------------------------------------------------------------------- |
| Full `npm run verify` | **16/16, exit 0.** Every gate, including production build and smoke.      |
| CI on the branch      | **7/7**, browser job included, via `workflow_dispatch` (PR #43)           |
| Suite inventory       | 31 pgTAP files, 118 Playwright specs, 50 unit files, 60 integration files |

Per-suite test counts were not captured from that run; the gate summary was.
The run needs Docker and roughly 3.5 GB free, and takes about 25 minutes.

Targeted figures that were captured, each proven by breaking what it guards:
19 new pgTAP assertions, 16 unit tests across two files, 4 browser tests on two
viewports.

### Backup prerequisite checkpoint (31 October)

- `scripts/backup-database.mjs` now writes a complete run directory with SQL,
  both private buckets' bytes and a manifest of exact keys, sizes and SHA-256.
  Failed or changing inventories remain `.incomplete`.
- `scripts/verify-restore.mjs` checks saved bytes before truncating local data,
  uploads them to local private Storage, downloads them and compares hashes.
- `tests/scripts/storage-backup.test.mjs`: 10/10 negative/positive guard tests.
  A real isolated local backup with the same nested key in both buckets copied
  2 objects; `npm run restore:verify` loaded all 40 populated tables at full
  count and read both restored objects back at matching size/hash. Proof
  fixtures were removed and `npm run db:reset` returned local to the seed.
- Full unpiped `npm run verify` passed 17/17 with exit 0 (748/748 pgTAP,
  401/401 integration, 626 passed / 155 intentionally skipped Playwright).
  The final ten backup guards passed separately after the full gate began.
  Published implementation commit `8f13d37`; PR #50 and dispatched full
  workflow run 41180345379 passed static, database and browser jobs. The CI
  browser job reported 626 passed and 155 intentionally skipped. The final CI
  unit script passed 550 unit tests and ten backup guards locally. PR run
  41183430389 passed static, database/RLS/integration and production build on
  documentation-only handover commit `149c1aa`; its browser job was skipped by
  the pull-request trigger rule.
- The user ran a **local**, zero-object backup on 31 October at
  `D:/AI Project/Task Management/tamco-focus-backups/tamco-focus-local-2026-10-31T05-51-03-158Z-445267`.
  Its manifest lists both buckets and zero objects. `npm run restore:verify`
  loaded all 40 populated local tables at full count, then `npm run db:reset`
  returned local to fixtures with exit 0. This does not establish a current
  Production inventory or byte recovery.
- The authorized user then ran a fresh **Production** backup at
  `D:/AI Project/Task Management/tamco-focus-backups/tamco-focus-production-2026-10-31T06-30-14-696Z-014892`.
  Local artifact inspection found 354 objects: 349 task attachments and 5
  finding evidence, 107,357,176 downloaded bytes in total. All saved files
  matched their manifest sizes and SHA-256 hashes. The user's first restore
  attempt safely refused because its target resolved to Production. The agent
  obtained the local URL and service-role key from local Supabase CLI status
  without printing them, set the process target to local, then ran
  `npm run restore:verify -- <run>`. It loaded 69 populated Production tables
  and 8 identities, uploaded all 354 objects to isolated local Storage,
  downloaded them and matched each size/hash. `npm run db:reset` exited 0 and
  returned local to fixtures. **Production evidence backup is restore-proven.**
- GitHub rejected the original push because its PAT cannot update workflow
  files. The unpublished branch was rebuilt without a workflow-file diff:
  `test:unit` now invokes `test:backup`, so the existing CI unit step runs all
  ten backup guards. This passed locally (550 unit + 10 backup) and the branch
  pushed. The connected GitHub integration returned 403 on PR creation; `gh`
  opened draft PR #50. Dispatched full workflow run 41180345379 passed all
  three jobs, including on-demand browser coverage at `8f13d37`.
- The prior estimate of 354 objects is now corroborated by this fresh run,
  but is not a permanent expected count. No Production read or write was made
  by the agent; only the user's saved local artifacts were inspected.

### v4.1 Stage 0 preliminary delta (read-only, 31 October)

Source: `D:/Download/TAMCO_Finding_Management_v4.1_Claude_Complete_Build_Package.zip`
(integrity checked; numbered Markdown read in order; illustrative HTML/screenshot
concept inspected). The package's claims about v269/v270 being on an unmerged
branch are stale: this checkout contains v269–v271 migrations and code. The
current ESH navigation is Dashboard / Register / Verification / Closed, with
Settings secondary; Today / Findings / Patterns is absent. Existing guest
owner, verification, interim control, follow-up, escalation, scanning state,
effectiveness and private evidence paths are present. No QR intake route,
`esh_report_intake`, `esh_qr_locations`, QR rollout flag, hazard taxonomy or
confirmed pattern relation table was found in local source/migrations. The
original ESH v1.3 spec explicitly excluded public QR; v4.1 adds it behind
separate security and rollout gates. The fresh user-run Production schema dump
was searched locally with `rg`: v271 source/scan guard symbols are present;
`esh_report_intake` and `esh_qr_locations` are absent. Current deployment
configuration and staging readiness were not verified here.

The Stage 0 risk/delta report, `07_BUILD_TRACKER.md` and eight fixture-only
desktop/mobile captures are committed as `030bf19` on
`codex/finding-v41-stage0`, in worktree
`C:/Users/User/.codex/visualizations/2026/10/31/01a18fb9-87ef-7f11-aeba-43d8967c29d9/v41-review/stage0-worktree`.
Draft PR #49: `https://github.com/Asyrafbangs/tamco-focus/pull/49`.
Dispatched full workflow run 41179525074:
`https://github.com/Asyrafbangs/tamco-focus/actions/runs/41179525074`
passed all three jobs at `030bf19`, including 626 passed and 155 intentionally
skipped browser cases. The captures use only local seed and temporary
fixture findings; both targeted capture runs passed 2/2 and local fixtures
were reset. The user approved local-only Stage 1 testing. PR #49 is stacked
on backup PR #50 and Stage 0 passed its rebased dispatched full CI. Stage 1
implements its navigation and queues in a separate branch.

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

- **v310–v318 — the UI/UX audit, and what it found.** An audit crawl of the core
  product (ESH excluded) as three roles, at three widths, in both themes — 120
  page states, with axe, overflow, touch-target, type and focus-ring checks and
  a screenshot each. `tests/e2e/uiux-audit.spec.ts` is the instrument; it
  asserts nothing, because its output is evidence to rank.

  What it found, in the order it was fixed:

  - **v310** The Day/Night control was a blank circle on every authenticated
    page below 768px, in both themes: the phone rule hid every span inside it
    and the component renders two, the word and the knob. axe passed it — the
    button keeps its `aria-label`. Only a screenshot showed it.
  - **v311** Eighteen controls under 44px, and a guard that could not see them.
    `design-system.spec.ts` measured height alone, on one page, over six
    hand-listed selectors. It now measures both dimensions across nine routes
    over every interactive element, and understands three patterns it must not
    punish: the stretched link (`.row-primary-link::after` makes the row the
    hit area), a checkbox aimed at through its label, and a visually-hidden
    input behind its own button. Sizing is keyed to `pointer: coarse`, not to
    viewport width.
  - **v312** 415 declarations below 12px in seven values, and no type token in
    the stylesheet at all — 2,265 colour `var()` references and not one
    `font-size: var(…)`. One token, `--text-xs: calc(12px * var(--font-scale))`,
    replaces them. Because every size had been a literal, the personal
    text-size setting (§22.2) reached only inherited text: somebody choosing
    Large got a larger body and the same 9px labels. The steps below 12 are
    gone from the locked scale, so the next 9px rule fails the gate.
  - **v313** The audit crawl itself.
  - **v314** My Day and My Work: three tab rows turned out to be **six** idioms
    — different levels in one costume and one level in several. Replaced by a
    `.tab-rail` family at three weights. Seven eyebrow labels retired; four
    copy and empty-state faults.
  - **v315** Plan and Goals: the month cell clipped titles at fifteen
    characters and spent a line on "Task"; the phone agenda headed every day
    with a bare number; the Goals column named "progress" counted measures and
    showed none; a goal row's Revise was invisible on a tablet and still took
    the tap; health was stated twice and an unfinished allocation was painted
    as a warning.
  - **v316** More, Settings and the record screens, leaned: 25 eyebrows, a dead
    component, four `aria-hidden` spans styled as buttons, two facts repeated
    per record row, a column, and a media-type string that wrapped to three
    lines of a phone to say what ".pptx" says in five characters. The records
    table stacks below 600px with its ARIA roles written out, because Chromium
    drops a table's structure as soon as a `tr` takes a non-table `display`.

  **Integration found what no area could.** The three areas were revised in
  parallel, each locally right, and together produced two tab systems and two
  class names for one label. Both are now one. It also caught a server
  component importing a plain value out of a `'use client'` module — the server
  receives a client reference proxy, `SETTINGS_SECTIONS.filter` threw at
  request time, and the settings page rendered the error page. The type checker
  and 944 unit tests both passed it; only a browser run found it. Its unstyled
  `h1` was also the "27px off the scale" failure, so one cause had produced two
  red tests that looked unrelated.

  **v317 — the calendar refusal.** A stale-move test reported a missing error
  toast. The toast was never at fault: a probe shows it render at 100ms with
  the right words and stay. The move never reached the server. Titles wrap to
  two lines since v315 instead of being clipped at fifteen characters, so the
  month grid is taller and the last week sits partly below a 900px viewport;
  Playwright scrolls a target into view as part of the action, mid-drag, and
  that loses the drag. `due_at` was unchanged afterwards, which settled it.
  Separately and in its own right, a refusal used to expire after ten seconds
  on the same timer as the success notice — the notice carries an Undo offer
  with a deadline, a refusal is the only account of why a move did not take,
  and the grid behind it has already jumped to somebody else's date. It now
  stays until dismissed.

  **v318 — the settings menu, and a fault of my own making.** The mobile
  appearance panel could not be used: "Save theme" was visible, stable and
  unobstructed, and no tap reached it. Removing the settings rows'
  descriptions and carrying them in a `visually-hidden` span — absolutely
  positioned, `white-space: nowrap` — pushed the document to 722px. The layout
  viewport expanded past the 390px device, the browser zoomed out to fit, and
  controls near the foot of a panel fell outside the tappable area.
  `window.innerWidth` read 722 against a 390px device and removing the span
  restored it, which is how it was settled rather than guessed. An
  `aria-label` was worse in a quieter way: `getByLabel` reads `aria-label` but
  not a button's own text, so `getByLabel('Text size')` matched the
  Accessibility row as well as its control. The description is visible again,
  under the label, wrapping. The original fault was that it was clipped to one
  line, not that it existed.

## Partial work

Stage 2 is the only v4.1 work started and not finished. `codex/finding-v41-stage2`
/ PR #52 carries 59 files of QR intake and triage, stacked on Stage 1. It has
**not been reviewed**, and its policy inputs — anonymous reporting, the
emergency-contact route, retention and EXIF, and whether a public scanner is
hosted — are all undecided. A green run on that branch proves nothing about
those questions. Do not merge it on the strength of one.

Stage 2 has its private core on draft PR #52 (`4946115`): v272–v278 provide
RLS-protected disabled QR settings, scoped staff access, manual report capture,
claim/decline/duplicate decisions and a claimed report's atomic conversion to
the existing Finding/assignment transaction. There is no anonymous database
policy, active public intake route, public upload, emergency dispatch or
automatic owner action. `npm run db:reset`, `npm run check:sql`, `npm run db:types:check`,
TypeScript, the focused unit test and `esh_intake_accept_v278.test.sql` (11/11)
pass locally. Full Stage 2 regression and browser/CI confirmation are pending.

## Remaining work

1. **Stage 2 final verification** — add relevant browser coverage, run the full
   local acceptance gate once, inspect the final diff, then dispatch CI on PR #52.
   Public QR intake, uploads and emergency delivery remain disabled regardless
   of the private staff workflow's completion.
2. **`ATTACHMENT_ALLOWED_MIME` and `EMAIL_TRANSPORT` in Vercel** — user action.
   Vercel values cannot be read back. If `ATTACHMENT_ALLOWED_MIME` carries the
   stale list, production refuses HEIC photos and PowerPoint while the file
   chooser offers them. Unset is correct. Production once ran for weeks on the
   `log` email transport with every cron run returning 200, so `EMAIL_TRANSPORT`
   deserves the same check.
3. ~~`/findings/import/[batchId]`~~ — done in v257. The seed carries a staged
   batch of four rows, one per outcome, and the walk resolves it from the
   import list rather than hardcoding the id.
4. **`TREND_MINIMUM_EVENTS = 10`** in `src/domain/esh-dashboard.ts` — decides
   when the sign-in-free page will name a backlog direction. A product
   judgement, not a measurement; one line to change.
5. **Prove a current Production evidence backup.** Local implementation is
   tested; an authorized user must run the production command, then the
   resulting artifacts must pass local restore byte verification. See
   _Exact next action_.
6. **Host the scanner.** Built in v270–v271 and inert until `ESH_SCANNER_URL`
   and `ESH_SCANNER_TOKEN` are set. Not a defect: every file reads "Not
   scanned" and nothing claims otherwise.
7. **The email provider adapter** remains stubbed and blocked on an external
   service.

> Superseded: this list previously said virus scanning was stubbed and that
> `virus_scan_state` must stay pinned to `not_scanned`. v270 reversed that at
> the Product Owner's request and v271 made it work. Do not reinstate the pin.

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
- **Evidence scanning was approved in v270 and repaired in v271.** Without a
  hosted scanner the honest state is `not_scanned`; do not represent it as clean.
- **Successful email delivery is not shown to the user**, and a normal Action
  Owner gets no bulk actions.
- **A direction needs both sides to have happened.** `backlogTrend` returns
  `too-early` rather than naming a direction from too few events, mirroring
  `onTimeRate` returning `null` rather than 100% from no closures.
- **Action Owners stay passwordless. No Microsoft SSO** (6 October). SSO would
  need an Entra app registration and, depending on two tenant switches nobody
  here can see, an administrator's consent — to save one tap for staff on
  managed devices, while the audience that matters is on a personal phone in a
  plant, for whom SSO is a full Microsoft login and therefore worse. Identity
  is already keyed on the verified email address rather than an account, so
  SSO can be added later as another way to verify the same address without
  touching My Actions, the digests or the escalation engine.
- **The emailed link lives 24 hours** and that is deliberate: it is the
  exposure if a notification is forwarded or leaked. How long an already
  verified person stays verified is a different question, answered by the
  session rules below.
- **A guest session is eight hours idle, twelve hours absolute** (v262). Two
  hours was shorter than walking to the machine and back with the photograph.
  The twelve-hour cap is what stops a verified session becoming a standing
  login on a shared or personal phone, and it is now the rule that ends most
  sessions.

## The local gate ran one of three script suites (fixed 8 November 2026)

`npm run verify` named `tests/scripts/storage-backup.test.mjs` by file, so
`ai-answer-grader` and `environment-key-target` passed the local gate by
never being executed - while CI ran all three, because `npm run test:unit`
chains `test:backup`'s glob. A local gate that is a subset of CI reports a
green CI can contradict. The gate now uses the same glob: 35 tests where it
ran 18. **When adding a `node:test` suite, check it is actually reached by
both.** Vitest does not match `tests/scripts` at all; its projects are
`tests/unit` and `tests/integration` only.

## UI/UX branch: verification and merge position (8 November 2026)

The work above sits on `claude/uiux-integrated`, 49 commits on `cf2bad0`, and
now contains `origin/main` (`cf95e80`) by merge. `origin/main` is an ancestor
of the branch and the local `main` is 24 behind it, so both the merge and the
push are fast-forwards. **Not yet merged or pushed at the time of writing.**

Verified at the time of writing:

| Check                                                                         | Result                      |
| ----------------------------------------------------------------------------- | --------------------------- |
| Unit                                                                          | 944 pass, 83 files          |
| `design-system` (type scale, touch targets, settings panels, tab rails)       | pass, every viewport        |
| `theme-appearance-v108`, `a11y-sweep-v192`, `more-admin`                      | pass, every viewport        |
| `plan-reschedule-v153`, `goals-v33`, `tab-hierarchy`, `plan-goals-legibility` | pass                        |
| Full acceptance gate                                                          | **running; result pending** |

Gate history, because each score names a different fault and the pattern is
the point:

- **15/17** — Format, plus three browser failures: audit output written inside
  the repository, the records cell not stretching to 44px, the calendar drag,
  the settings menu width. All four fixed.
- **16/17** — the touch-target guard, reporting ten rows of
  `/more/attachments` at 338x39px. Not a defect in the product: `offsetParent`
  is the nearest `td`/`th`/`table` for anything inside a table whether or not
  it is positioned, while the `::after { inset: 0 }` that makes a row
  pressable resolves against the nearest _positioned_ ancestor — the row, at
  362x127px on a phone. Fixed in v320, which also stops that route reading as
  a pass when the table is empty.
- **16/17 again**, on a different fault: `evidence-upload-v135` found no
  `Complete work` button in the task drawer on mobile, while the same test
  passed on desktop in the same run and six of six passed in isolation. Fixed
  in v322.
- **16/17 once more**, this time with the browser suite green and only Format
  failing, on sixteen files that `git checkout` and the `origin/main` merge
  had rewritten as CRLF. `autocrlf=true` here, so Prettier's LF check fails
  while `git diff` shows nothing; `md5` of each file with CR stripped matched
  its committed copy exactly. Nothing in the commit was wrong and CI, which
  checks out LF, would never have seen it.
- **17/17, EXIT=0** on the re-run. Re-run rather than argued, because "all
  seventeen passed, just not in one process" is the shape of reasoning the
  17/17 bar exists to stop.

### Landed (9 November 2026)

`claude/uiux-integrated` is **merged and pushed**: `origin/main` is `a6a9c69`,
identical to the branch head, reached as a fast-forward. The series v300-v322
is on `main`.

`origin/main` had moved to `ddceccd` while this work was paused — PR #78
(v307), which touched `src/server/queries.ts`, the same file as v322. It was
merged in and the merge checked rather than trusted: `readCapabilities` and
`TASK_CAPABILITIES_UNAVAILABLE` both survived, types clean, unit 1011/1011.

One environment note worth keeping. Before that final run, every browser test
failed at sign-in with `?error=invalid`, which reads exactly like an
authentication regression. It was not: Kong, REST and nine other local
services had stopped while `db`, `auth` and `storage` stayed up, so `db:reset`
succeeded against Postgres on 54322 while every API call went through a dead
gateway. `supabase start` only reprints status for a half-up project — it
takes `supabase stop --no-backup` then `start`. The tell was that _all_
thirty-two tests failed at the identical line: a clean cliff is environment, a
scatter is code.

## My Team is a board, and TAMCO AI organises its evidence (v323)

Two screens the user called out by name: the AI answer page ("so ugly, and not
organised") and My Team ("messy, not much help, hard to observe, a lot of
things hidden, and it is a long list").

**My Team.** The roster is a column of cards and the person being read is the
column beside it. The expansion opened _underneath_ the row from v143, which
honoured §6 and defeated it at the same time: the panel is about a thousand
pixels tall, so opening the second of six people pushed the other four off the
screen and the comparison a manager came for was back to being done from
memory. Below 1000px the panel follows the roster down the page, which is the
same reading order on a phone.

What a card carries changed with it. Four columns of prose down six people was
most of what made the list long, so what somebody is working on and what they
agreed to deliver are read from the panel — open the whole time now — and the
card carries the name, a load bar drawn to the team's own scale, the exception
counts as chips, and the reason where a decision is owed. The bar is volume
only (active, shared steps, waiting): a red segment would make it a verdict,
and §6's refusal of a score still stands.

The panel opens on what needs answering. Decisions, then deadlines, then
current focus, then the week and the active list — all open; the five
reference sections stay folded under a label that says what they are. The
variable sentence of figures became five fixed cells in a fixed order, because
a sentence that changes length and order with its contents cannot be compared
across two panels, which is what the panel is now for.

"Keep open" is **Compare**: the same mechanism, the same `?kept=` URL, and two
panels side by side wherever there is room. Three strips of tabs became two —
the Everyone / Needs attention filter sits on the end of the views row it
narrows.

**TAMCO AI.** Three structural faults, not decorative ones. Every cited record
was a bulleted full-length link, so one answer citing thirty made the evidence
several times taller than the reasoning it supported; it is now a disclosure
stating the count, grouping by kind and laying the titles in columns. The
question was a small tinted pill and the answer was body text one step
smaller, so a thread had no landmark to scroll back to; the question is the
exchange's heading and a rule separates one exchange from the next. The
composer is docked rather than floating over the end of the conversation.

### What the specs had to be told

Nine spec files, because the roster's contract changed. The ones worth
remembering:

- **A section that opens by itself breaks an unconditional `click()` on its
  summary.** `ask-for-update-v184` and `own-steps-v159` both opened "Other
  active work" that way, which now _closes_ it, and every row they then reach
  for is invisible for the rest of the test. `openPanelSection` in
  `tests/e2e/support/work-list.ts` asks for the state rather than assuming it.
- **An exception chip that draws `⚠3` and speaks "3 overdue" must be asserted
  on the words.** The drawn half is a red smudge to anybody not looking at it,
  so `team-deadlines-v189` and `team-contributions-v157` read the accessible
  text, which is the half that can be dropped without anybody noticing.
- **`team-context-v48` caught a real height regression** — 151px against its
  140px cap at 1440 — and the fix was the card, not the cap: the reason is one
  line inside the board's roster column, where the panel beside it states the
  case in full, and keeps both lines below the board where there is no panel.
- **Two guards were one keystroke from measuring nothing.**
  `team-phone-layout-v239` finds reasons by `[data-cell="attention-reason"]`,
  which nearly left the card; it now asserts the count before the clipping.
  `team-row-density-v235` asserts the load bars are ordered by load and that
  the heaviest fills the track, because a per-row normalisation draws a full
  bar for everybody, says nothing at all, and looks exactly like a working one.

## My Team reads as a dashboard, not a register (v324)

v323 put the roster beside the person being read, which fixed the scrolling and
left the card illegible. The manager's own words: it should say who needs
attention, why, what decision is theirs, and who has nothing flagged — inside
ten seconds, without reading anybody's task list.

**Four named states, decided in one place.** `teamRowState` in
`src/domain/prioritisation.ts` returns `manager_action`, `work_attention`,
`due_soon` or `none`, and the card, the sort and the panel headings all read
it. The distinction between the first two was asked for outright: not every
overdue task is the manager's to intervene in. `getTeamAttention` already
defaults an unmarked candidate to `action_required` — "a branch that forgets
should over-report rather than hide a request" — so the classification fails
towards flagging, and `teamRowState` reads that field rather than re-deriving
it.

**No inferred status.** "Steady" and "on track" were proposed and rejected:
they are judgements about a person that no count on this screen supports, and a
quiet week and a week nobody recorded look identical from here. `none` says
only that nothing has been flagged. Whether somebody has work at all is a
separate factual line — "4 active · 2 waiting · updated 3h ago", or "No open
items · no updates recorded".

**The workload bar is gone, and nothing replaced it.** It drew each person's
open items as a share of the busiest person's, on a scale nothing on screen
stated, inches from a red overdue count — so it said that carrying more work is
carrying worse work. `teamLoadMax` went with it rather than being left unused.
Comparison shows the counts themselves.

**Comparison is a table.** Six measures across the people, a `Needs you` row
carrying each decision and its control, and `Open <name>` per column. No panels
underneath: two full registers was the thing that made comparing them a memory
exercise. Nothing marks a winner — more overdue is worse, more done is better,
more active is neither, so one highlight rule would say three different things
with one mark. `teamStatCells` is shared with the panel so the same person
cannot be counted two ways.

**The panel stopped rendering nothing.** A tail section with no content renders
no disclosure at all; the empty ones are named in one sentence, which is
shorter and says strictly more than four shut drawers. The active list is
folded again because, open, it repeated the tasks "Work needs attention" had
just listed 300px above.

**Sorting.** The rank keyed off `sourceType === 'barrier' || 'goal'`, so a
request with any other source would have sorted below an overdue task. It now
checks `kind === 'action_required'` first. Ranks: request 1, overdue exception
2, other exception 3, overdue with no item raised 4 (a guard), due soon 5,
nothing flagged with work 9, nothing flagged and nothing assigned 10. The old
rule put everyone without an attention _item_ at 9, which is how a person with
work due inside the window sorted below two people carrying nothing.

### What the specs had to be told, again

Fourteen cases across seven files, every one a test pinned to the v323
contract rather than a product defect. Worth keeping:

- **A one-pixel margin is a flake, not a pass.** At 1024 the card measured
  139px against `team-context-v48`'s 140px cap, because a 272px roster left
  242px of content and the longest name wrapped the state onto a second line.
  The floor came up to 300px. Measured at nine widths on both pointer types:
  36 of 36 clear, worst case 119/140.
- **v132 asserted order _and_ roll call in one `toHaveLength`**, so it failed
  on a person who had completed nothing — which has nothing to do with the
  ordering it exists to protect. It now walks the headings as a subsequence and
  requires any absent section to be named in the empty-tail sentence.
- **A hidden phrase for one reader is worse than a visible one for all.** v235
  gave screen readers "Nothing needed from you" in a `visually-hidden` span
  because sighted readers took the absence of a flag as the answer. The state
  label says "No issues flagged" to everybody now, so the hidden span is gone
  rather than duplicated — and the spec asserts both halves of that.

## Known test brittleness

## What the parallel pass taught (v310–v316)

Three agents revised three areas at once, in separate worktrees, with the
database and the browser held by the integrator. The engineering came out well;
every lesson worth keeping is about the seams.

**A cross-area contract must name the mechanism, not the intent, and exist
before the work starts.** The one rule issued mid-flight — how to classify an
eyebrow label — produced near-consistency. It said what to classify and
forbade touching the shared class, without saying what to use instead, so an
agent obeying it invented `.kicker` and CSS-module scoping forced it to
duplicate the same five lines five times. The one axis left unspecified, the
tab treatment, diverged outright: the rail landed on My Work and nowhere else,
and the defect it was built to fix moved from inside one screen to between
screens.

**Guards fail by construction, in ways their own suites cannot show.** Four
distinct blind spots surfaced, each found by a different pair of eyes:

- the touch guard walked a fixed list of default URLs, so every `?panel=`,
  `?view=` and `?tab=` state in the product was unmeasured — a 20px control
  sat behind one through a whole 44px pass;
- `touch-targets-v183` skipped `opacity: 0`, which is exactly the state where
  a control is unaimable _and still takes the click_;
- the page-level overflow assertion passed while the records table was
  unusable on a phone, because the table scrolls inside its own box;
- `more-admin` asserted `getByRole('table')` is visible for an employee with
  no attachments: the table rendered anyway and its head gave it a box, so the
  assertion was about a list while asserting nothing in it.

**A static guard is cheaper and finds more than a visual pass.** Six eyebrows
were removed by reading screenshots; a 300ms unit guard written afterwards
found twelve more in component files no screenshot showed. Write the guard
first.

**Measure the thing a person touches, not the element.** Three of the audit's
"defects" were patterns working correctly: a stretched link whose row is the
hit area, a checkbox aimed at through its label, and a visually-hidden input
behind its own button. A fourth, `.cal-item-move`, was reported at 22px only
because a 390px desktop window reports `pointer: fine` and every
`@media (pointer: coarse)` rule in the stylesheet was inert.

**Hydration is not arrival.** The first crawl measured the loading skeleton on
all 120 states and reported zero accessibility violations. The numbers were
plausible and meaningless; the screenshots exposed it. Wait for
`.loading-skeleton` to detach, and prove an all-clear by seeding a violation
the tool must catch.

**Database suite (v258, v259): resolved.** Assertions that counted whole tables
or whole organisations now state what their own fixtures contributed, so
`npx supabase test db` passes whether or not the end-to-end import spec has run
first. Verified both ways: 23 files, 648 tests.

One assertion is order-dependent on purpose: `esh_weekly_reports_v204` test 28
checks the open count a leadership report recorded, and that report is org-wide
by definition, so any other open work belongs in its total.

**Browser suite (v260, v261): resolved.** Eleven fixture-gated skips became
assertions, so a test that stops running now fails instead of printing a dash,
and the one real gap behind them is closed.

`evidence-upload-v135` used to search Izzah's lists for anything completable and
skip when it found nothing. The seed gives her exactly two such tasks, one of
its tests completes the work it opens, and the viewport projects share one
database and run one after another -- so desktop consumed one, mobile consumed
the other, and its last three tests on mobile had been skipping silently.
Seeding her more work is not available, because `scripts/check-schema.mjs` holds
her active count as a fixture invariant. Each test now creates its own active
task through the service role, opens it by id at `/work?tab=active&task=<id>`,
and removes it afterwards -- binned rather than deleted where the completion
left audit rows. All twelve cases pass on both projects **with no completable
work left in the seed at all**, which is the condition that used to break them.
Proved load-bearing by inserting the fixture as `backlog` instead of `active`:
the test then fails naming the reason, rather than quietly finding something
else or skipping.

**That fix exposed two defects in `team-person-overview-v236`**, which had been
living off the side effect. Not completing Izzah's work leaves her two more
active tasks by the time the team panel is read, which is enough to cross
`ACTIVE_PAGE_SIZE` and put a "Show N more" fold inside Other active work -- and
the test's `details.locator('summary')` was not scoped to the section's own
summary, so it matched two elements and threw a strict-mode violation. It is now
`> summary`, which is what the rest of that file and every neighbouring spec
already used. Proved both ways against a panel holding the extra rows.

The second: `openPerson` clicked the person's name without waiting for
`data-app-hydrated`, and that name is a button handled in the client. Inside the
full suite the server and browser cache were warm enough that it worked; the
file could not be run on its own at all, failing every time with the panel
simply never appearing. The wait is now there, and the file passes standalone in
a sixth of the time.

Two conditional skips remain, both rightly: one person in a loop with no active
work, and a routine occurrence the schedule has not reached. Neither is
per-fixture.

One conditional assertion is worth replacing when there is a reason to.
`completion-pattern-v133`'s "does not ask twice for evidence the work already
has" asserts only while `.completion-existing` is on screen, which depends on
whichever seed task it happened to open. Making it unconditional needs a fixture
that already carries evidence -- a storage object as well as an attachment row,
not the bare task used above -- so it was left as it is rather than made to look
finished. Nothing consumes Izzah's completable work any more, so that file is
order-independent in the meantime.

## The Action Owner's screens (v262)

Walked at 390px as an owner rather than reasoned about, which found three
things no passing test had noticed, because each is about what the screen looks
like rather than what it says:

- **The count on the selected tab was invisible.** `.guest-tab-count` keeps its
  pale pill background inside a tab that sets `color: #fff`, and it set no
  colour of its own — white on `#fafbfc`, a contrast ratio of about 1.03. The
  number it was hiding is how much work the owner is being told they owe.
- **Overdue had never been marked anywhere.** The rule was written
  `small.esh-overdue`; the class sits on a `span` inside the `small`. That is
  the only use of the class in the product, so late work had looked exactly
  like work due next month, on the one screen an owner ever sees.
- **The action page was 4px wider than the screen.** The sticky header bleeds
  to the page edges with `margin: 0 -20px` while the phone gutter is 16px, so
  the page dragged sideways under a thumb.

Urgent and High now carry weight rather than sitting in the same grey as the
department name — weight and not a second colour, because amber already means
"late" and two alarm colours on one line is a traffic light with two reds.

`esh-owner-floor-v262` asserts all four by appearance — contrast ratio,
difference against a non-overdue row, computed weight, document width — because
asserting the markup is what let them through. Each proved to fail without its
fix.

A trap worth remembering: the phone override for the sticky header first went
in with the other phone rules higher up `globals.css` and did nothing, because
the base rule appears later in the file and a media query adds no specificity.
It now sits immediately after the rule it overrides.

**Not changed, and worth a decision.** On a 390px phone the owner scrolls past
the whole read-only finding record — description, department, evidence needed,
ESH contact — before reaching the box they came to type in. Measured, the
compose box starts at 742px of an 844px viewport, which is below the fold on a
real phone once browser chrome is counted. Collapsing "The original finding"
behind a disclosure would put the update box, the camera and Submit on the
first screen without removing anything.

## Corrective action quality (v263-v267)

Five changes answering an external review of the module, each verified against
the repository first -- six of that review's recommendations were already built
(operational health in v210, the shared-device identity and sign-out in v198's
top bar, the private evidence bucket with no `storage.objects` policy at all,
the `principal` actor kind in the audit trail, the claim/complete dispatch with
a 15-minute reclaim and eight backoff attempts, and the v262 regression checks
it suggested adding).

**v263 - what protects people while the finding is open.** The record could say
who owns a fix and when it is due. It could not say whether anybody is safe in
the meantime, which for a six-week procurement is the only question that
matters. Four facts on the finding: what was done immediately, what controls
the hazard until the permanent fix and who keeps it in place, who checked it
and when, or an explicit decision that none is needed with a reason. The rule
with teeth is that **changing the control clears its verification** -- a barrier
nobody has checked since it changed is not a verified barrier. The owner sees
it pinned beside the instruction, because the person standing next to the
machine is the one who most needs to know a temporary gate is fitted.

**v263 also reordered the owner's phone screen.** The read-only finding record
was pushing the update box to 771px of an 844px screen. The fix is source order
plus explicit grid placement, not folding: the v227 desktop arrangement is
unchanged and asserted, and nothing is hidden from an owner who needs to know
what they are fixing.

**v264 - whether the owner was slow, or we were.** Closure against the date
first promised was one number doing two jobs. Measuring only the first
submission rewards sending anything before the deadline; measuring only the
accepted one blames an owner for a review that took eleven days. Both now, plus
ESH review turnaround and how long owners take to answer a rejection, each
carrying the number of events behind it.

**v265 - blockers as facts.** Category, what help is needed, who can give it,
when the next decision is expected. It changes nothing else: no pause, no new
deadline, no reminder skipped, because a self-service pause is how a tracker
quietly stops tracking.

**v266 - what kind of proof.** A photograph shows a walkway was cleared and
shows nothing about an interlock. The kind is a field now, chosen at
assignment and shown to the owner before they walk to the machine. Null where
nobody said, because a default would answer a question ESH never asked.

**v267 - did the fix hold.** A date, somebody to look, and what they have to
see. A failure raises a linked finding and leaves the original closed: that
closure was true on the day it was made, and overwriting it would destroy the
only evidence that the fix was once in place and later was not.

### v269-v270 — the audit gaps, and scanning

An audit of what was built against what could be _reached_ found four things
the database could do that no screen could ask for. All four are closed: a
blocker can be cleared, the kind of evidence can be corrected after assignment,
significant closed work is prompted to book an effectiveness check, and
unassessed findings are a register view rather than a number with nowhere to go.

**v270 reverses the "evidence is never scanned" decision** at the Product
Owner's request (30 October). Scanning runs on the scheduled worker _after_
the file has landed, so an owner on one bar of signal never waits for it. The
scanner is whatever answers `ESH_SCANNER_URL`; unset, the feature is inert.
`unavailable` is deliberately distinct from `clean` — see `docs/evidence-scanner.md`.

Photographs are now resized to 2000px and re-encoded before upload, which costs
the EXIF block. The trade is recorded in `compress-image.ts`: the record
already carries who uploaded what and when, which is better provenance than a
phone clock, but it would be the wrong trade if these photographs ever had to
prove where or when.

### v271 — scanning that works, and the camera's own file kept

**v270 could not scan a single real file.** A trigger from v199 refuses any
update to an evidence row whose `message_id` is set, and v199 also pins such a
row to `state = 'ready'`. Every file that matters is sent in a message, so
`esh_scan_claim` raised an exception on the first row it claimed, and
quarantine could not have moved a file out of 'ready' either. v270's own
fixture never sent a file, so eleven assertions passed over an inert feature.
The guard now separates the record — what a file is, where it lives, who sent
it, which cannot change — from what we have since learned about it, and lists
the mutable columns rather than the immutable ones, so a column added later is
immutable until somebody names it. Every scanning assertion now runs against a
sent file.

**The photograph that came off the camera is kept.** v270's compression costs
the EXIF block and every pixel past 2000px; that is right for getting work
reported from a plant floor and wrong for the one photograph somebody later has
to argue about, and which one that is cannot be known at upload. So both are
kept: the compressed copy is what is sent first and what everybody views, and
the untouched file follows in the background into the same private bucket. The
owner waits for neither. If the second upload never finishes, `source_state`
says so rather than implying an original exists — the same rule as `unavailable`
versus `clean`. The full-size file is reachable only by ESH, through
`/findings/files/<id>?source=1`, and it is the file the scanner looks at.

**A remote scanner now needs a shared secret.** Every byte of somebody's
evidence is POSTed to `ESH_SCANNER_URL`, and the worker refuses to send it to a
host with no `ESH_SCANNER_TOKEN` in front of it. Loopback is exempt, which is
how it runs locally.

### Not done, and worth knowing

- **No scanner is hosted yet.** The container, the hosting options with current
  costs and the deployment steps are in `docs/evidence-scanner-deployment.md`
  and `deploy/evidence-scanner/`; what remains is a decision and a credit card.
  Cloud Run scaling to zero is nearly free if the signature databases are baked
  into the image and that image is rebuilt weekly; Fly.io always-on is about
  $13/month at 2GB, $25 at the 4GB ClamAV recommends. Until `ESH_SCANNER_URL`
  is set, every file stays `not_scanned` and nothing claims otherwise.
- **Backup PR is ready for review.** Production bytes are saved and restore-proven;
  dispatched workflow run 41180345379 passed all three jobs. The backup guard
  runs via `test:unit` in existing CI, with no workflow-file change. The PR is
  not merged or deployed.
- **Only ESH evidence is scannable.** `virus_scan_state` on `task_attachments`
  and the goal evidence tables is untouched.
- **The public dashboard's counts are not a privacy guarantee.** Differencing
  two monthly snapshots of a small population can reveal a single finding's
  timing. Suppression below a threshold is the fix, not redacting more fields.

## Known risks

| Risk                                        | Severity | Note                                                                                                               |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| Hosted Staging remains unverified           | Medium   | User approved local-only Stage 1 testing; no hosted demo or Production rollout is authorized.                      |
| Vercel `ATTACHMENT_ALLOWED_MIME` unverified | Medium   | A stale list silently refuses HEIC and PowerPoint that the file chooser offers. Vercel values cannot be read back. |
| Vercel `EMAIL_TRANSPORT` unverified         | Medium   | Production once ran for weeks on `log` with every cron run returning 200.                                          |
| No scanner hosted                           | Low      | Honest: every file reads "Not scanned". Nothing is misreported.                                                    |
| Public dashboard differencing               | Low      | Two monthly snapshots of a small population can reveal one finding's timing.                                       |

## Blocker

Nothing blocks the independent S2–S6 engineering work. The lean package
supplied the nine hazard categories and v287 implements them as optional,
audited classification; no historical finding was inferred or overwritten.

What remains blocked is operational activation, not code:

- **Public QR and public uploads** require the owner to settle and record the
  privacy notice, immediate-safety route, retention/EXIF policy, scanner or
  text-only posture, daily queue ownership and pilot terms. This automation
  must leave the public controls disabled.
- **Emergency notification delivery, scanner hosting and Production rollout**
  require external configuration and operating ownership. No setting is to be
  invented or enabled by an agent.

Every Production change remains gated on explicit approval.

## The lean package (approved 3 November 2026)

A second approved package arrived after the v4.1 stages: "Lean Implementation,
UX Improvement and Production Readiness". It settles three decisions that had
blocked building - the administrator role split is **deferred and must not
block this workstream**, the hazard taxonomy is supplied as nine candidate
categories, and the scanner stays optional provided nothing is ever labelled
scanned or clean - and asks for four stages.

- **Stage A (PR #56)** - repairs to what exists. The scanner recorded a clean
  bill of health for every answer whose `infected` was merely falsy, including
  a scanner reporting its own failure in valid JSON; pixel limits now refuse
  the flat PNG that fits inside every byte limit and asks a browser for 3.6
  billion pixels; a PNG is converted to JPEG only when JPEG clearly wins; and
  v286 sweeps uploads that never finished.
- **Stage B (PR #57)** - v287's hazard classification: a table rather than an
  enum, stable codes, one primary and an optional secondary, optional and
  never required, with the register and Patterns both counting what is
  uncategorised.
- **Stage C (PR #58)** - v288's public QR reporting, built and left closed.
  Nothing is granted to `anon`; the reporter is anonymous unless they choose
  otherwise; every photograph is re-encoded on the phone and rebuilt on the
  server, so no EXIF block and nothing appended survives.
- **Stage D (PR #59)** - `npm run check:deployment`, which asks the deployment
  what is applied and what is configured instead of asking a document, plus the
  rotation runbook and rollout plan in `stageD-readiness-and-rollout.md`.

All five of those migrations - v279, v280, v286, v287 and v288 - **are now
applied in Production**, together with v289, v290 and v294. Verified 7 November
2026 against the project's own migration ledger, not against a document: the
latest applied version is `20261107001000 v296_ai_shared_quota`. Nothing is
waiting for `npx supabase db push --linked`.

## TAMCO AI, configured and limited to named accounts (v295-v301)

Merged to `main` as `fe2f41d` (v295-v298) and `36f9d10` (v299, PR #68) on
7 November 2026, and deployed to Production - `tamco-focus-gborm9vtu`, built
from `36f9d10` and aliased to `tamco-focus.vercel.app`. The merge commit's tree
is byte-identical to `b1671b9`, which is the commit the dispatched CI run
verified with the browser job included, so the deployed artefact is the
verified one and not merely its descendant. Migrations `v295_ai_coworker`
and `v296_ai_shared_quota` are applied in Production, confirmed both by the
migration ledger and by probing the live API: the four `ai_*` tables answer
`42501` to anon, so they exist and are closed.

**It is switched off, and switching it on is not one variable.** The feature
needs `Boolean(apiKey) && AI_ENABLED !== 'false'`, and `apiKey` is read from
whichever variable the _provider_ names. `AI_PROVIDER` defaults to `groq`, so:

- setting only `OPENAI_API_KEY` in Vercel leaves the assistant **off** - the
  config reads `GROQ_API_KEY`, finds nothing, and reports itself disabled;
- `AI_PROVIDER=openai` must be set explicitly;
- `AI_MODEL` must then be an OpenAI model. `.env.example` still carries
  `AI_MODEL=openai/gpt-oss-120b`, which is a Groq model name, and the config
  deliberately refuses a model belonging to the other provider rather than
  passing it through to a 404 per request;
- `AI_DAILY_LIMIT_USD` defaults to **1**. The v298 evaluation spent $0.62 on
  31 questions, so nine people asking ten questions a day is about $1.40 - the
  ceiling would stop the assistant mid-afternoon on day one.

The v299 disabled notice names whichever variable the running configuration
actually reads, so a half-finished setup now says what is missing instead of
naming Groq's key on an OpenAI installation.

**v301 - OpenAI is the default, and the audience is a named list.** Two
corrections after the owner saw a live screen asking for `GROQ_API_KEY`:

- `.env.example` now sets `AI_PROVIDER=openai` and `AI_MODEL=gpt-5.4-mini`.
  The old defaults were `groq` and `openai/gpt-oss-120b` - the latter a Groq
  model whose name merely begins "openai/" - so a fresh installation ran as
  Groq and said so, two versions after the provider became OpenAI and after an
  evaluation conducted entirely on OpenAI. `AI_TIER` is now left **empty** so
  it follows the provider: the literal `free` that was there is true on Groq
  and a lie on OpenAI, where it would record billed requests as costing
  nothing - and `AI_DAILY_LIMIT_USD` is enforced against that recorded figure.
- `AI_ALLOWED_EMAILS` names the accounts that may use the assistant. Empty
  means the role rule below applies. Set, it becomes the whole rule: those
  addresses and nobody else, whatever role they hold, so it admits a named
  manager and keeps out a second administrator. Emptying it widens the
  rollout with no deploy.

Note for whoever reads this next: a local `.env.local` carrying both keys and
no `AI_PROVIDER` has been running on **Groq**, not OpenAI, since v297.

**Merged and deployed, 8 November 2026.** v301 as `26ceccb` (PR #70) and the
v300 eval work as `7fd209b` (PR #71). The main run on the merge commit passed
the complete suite, browser job included. The owner then set `AI_PROVIDER`,
`OPENAI_API_KEY` and `AI_ALLOWED_EMAILS` in Vercel, and production was
redeployed, because **Vercel captures environment variables when a deployment
is built**: the live build predated the variables and kept running on Groq
until the redeploy, which is not a fault anybody can see from the dashboard.

**Then `/ai` answered 404 to the owner, and the gate was right.** Production
holds two accounts under the same name. The signed-in administrator is
`EHS-001`, whose address is on the `@tamco.com.my` domain; the separate
`EHS-ADM` "(System Administrator)" record holds the personal address that was
put on the allow list. So the configured list named a real account - just not
the one anybody signs in with. The rail hid the entry and the page answered
404, both correctly, which is also the first live evidence that the v301
wiring works. **Before changing code over an access complaint, read the
signed-in account's own email from the directory.** Listing both addresses is
the safe form.

**The eval grader had three defects of its own, found by review after v300
landed** (`76ac75b`, in PR #71). `READ_FAILURE` was the one phrase check
reading the raw answer rather than the normalised one, so it rejected `can't`
written with a curly apostrophe, `could not` with a non-breaking space, and
the plain sentence "the read of your finding register failed" - three honest
admissions graded as the dishonesty it exists to catch, which is the same
defect the ESH-0101 hyphen taught this suite once already. Rule 9c had it
pointing the other way, permissive rather than false. `must_not_match`
deliberately still reads raw, and a test pins that, because those patterns are
the scenario author's and may rest on characters normalising removes.

**Who may use it: manager and administrator** (`canUseAssistant` in
`@/domain/ai`), unless `AI_ALLOWED_EMAILS` names people. v295 shipped `/ai` with no role gate anywhere, so the v298
merge widened the audience to every signed-in person as a side effect of a
deploy. Nothing leaked - every tool runs as the asker, against the same RLS
they already have - but the decision had not been made. v299 enforces it in
three places: the rail hides the entry, the page answers 404, the route
answers 403. Hiding the link authorises nothing, which is why all three exist.

**Evaluation (v298):** 86/100 across 31 scenarios, 26 PASS / 4 PARTIAL /
1 FAIL, no security or permission failures, **CONDITIONAL GO**. Full record in
`jarvis-complex-evaluation-report.md` with every question, answer and grade
preserved verbatim. The remaining FAIL is two linked records describing one
hazard counted as two hazards: the recorded relation exists in the database but
is not in the register rows the model reads. Before wider rollout the summary
asks for that relation surfaced, `reported_on` exposed (no effort or duration
data exists anywhere, so the assistant correctly refuses completion dates),
the spend ceiling set deliberately, `high` effort measured, and the suite
re-run against production-shaped data.

**Re-run on OpenAI, 8 November 2026: 14 of 15.** The first run against the
corrected grader and the v300 prompt - `gpt-5.4-mini`, medium effort, 77,928
tokens, 5,195 a question, so the default `AI_DAILY_LIMIT_USD=1` buys roughly
38 questions a day shared across everybody. The one failure is real, not a
grader artefact: `review-preparation` never called `search_findings`, so a
performance-review answer left out the finding the person had raised, and
reported the empty result of an unfixtured `list_team_workload` as "the team
workload view is empty in the records I can see". An empty read presented as a
fact is the exact defect rule 9c exists for, arriving by a route the rule does
not cover.

**The run also exposed a blind spot in the suite.** Seven of the fifteen
scenarios never called a tool their own fixtures provide - almost always
`search_findings`. Only `review-preparation` failed for it, and only
because it happened to carry a `must_reference` that the unread fixture
supplied; the other six scored as passes on answers built from part of the
evidence they were given. v300 settled this argument for failed reads, where a
scenario that did not run its own premise is inconclusive rather than passing,
and the same reasoning covers any fixtured tool. It belongs as a **reported
reading rather than a failure**, like the tool-name count, because a fixture
may legitimately be offered and not needed.

Runs are not committed: `evals/ai/runs/` is gitignored, so the verbatim
answers live only on the machine that ran them.

## Exact next action

No additional S2–S6 implementation is scheduled. The next action is an
operational one only when the owner chooses to take it: use the current
readiness runbook to establish present deployment state, then explicitly
approve a restricted pilot with a queue owner, area, date and safety/privacy
arrangements. This automation must not make that change and must leave public
QR, public uploads, emergency delivery, scanner hosting and Production rollout
disabled.

The separate AI allow-list configuration noted in older history is not a
Finding Management v4.1 blocker and is not changed by this workstream.
