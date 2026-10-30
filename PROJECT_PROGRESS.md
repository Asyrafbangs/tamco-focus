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

## Known test brittleness

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

## Blocker

None.

## Exact next action

Nothing unattended remains. Items 1 and 3 under _Remaining work_ need a
credential and a product decision respectively.
