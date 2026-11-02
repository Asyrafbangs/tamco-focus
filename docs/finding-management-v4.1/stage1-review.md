# Stage 1 — Navigation and working queue, reviewed against its own gate

Stage 1 was built on `codex/finding-v41-stage1` and reported complete with a
passing dispatched CI run. This document records the review that followed, on 2
November 2026, because a green suite is evidence about the assertions that
exist, not about the ones the stage promised.

Gate S1, in the package's words: _all existing finding/guest role tests green,
counts exactly match their drill-down rows, old route links work, query
filtering remains scoped, no regressions on mobile._

## What was already right

The navigation is Today / Findings / Patterns with Configuration kept
secondary, and the old destinations still resolve: `/findings/closed` redirects
into the Findings filter, `/findings/verification` redirects into the Today
queue and carries its department through, and `/findings/register` keeps every
link and bookmark. Patterns says plainly that it has nothing yet and does not
infer a cause from titles or a handful of observations. The historical panels —
risk, age, closure, responsiveness, protection, trend and the department
breakdown — were **moved, not rebuilt**: `/findings/patterns/insights` renders
the same `DashboardPanels` components from the same queries, and the
sign-in-free leadership route is untouched. Incoming reports is present and
explicitly disabled rather than quietly absent. That is the stage's shape, and
it is sound.

## Five defects the stage's own gate asks about

**The verification queue showed six rows, whatever the number waiting.** The
`slice(0, 6)` meant for Today's summary card applied to the full queue as well,
and that queue is the only route to a submitted correction. On the local
database at the time, 57 actions were awaiting verification and the page showed
six, with nothing on screen saying so. Today's card is a preview again and now
says how many it is not showing; the queue shows all of them.

**Four things the old verification page could do had gone.** Its department
chooser, each row's priority flag, the file count and the `N waiting` total were
all dropped in the move. "Preserve existing working functionality" is the
stage's own instruction, and these are restored.

**The protection counter linked to a list that was not its own.** _Significant
risks without verified protection_ is computed by `esh_dashboard` as open
findings at high or critical risk with nothing verified standing in the way. It
linked to `?filter=open` — every open finding. It said three and the page behind
it held forty. There is now an `unprotected` register view built from the same
predicate, read through the register's own row-level security rather than
through the procedure, so the number and the list are two independent answers to
one question and a test compares them.

**Findings was missing two views the stage asks for.** `Waiting verification`
and `All records` are both named in the deliverable and neither existed.
`Waiting verification` reads the per-action register rows, so it counts the same
obligation the counter reports; `All records` carries closed findings too, which
is what the view is for.

**"Overview by department" went to Today.** The register's tools menu kept its
old address after `/findings` became Today, so the reader asked for a department
breakdown and arrived somewhere with no departments on it.

## Proof

Four new cases in `tests/e2e/esh-today-counts-v4101.spec.ts`, and each was
proven by breaking what it guards rather than by passing:

| Guard                                    | What it caught when removed     |
| ---------------------------------------- | ------------------------------- |
| counter equals its drill-down total      | counter 4, list 14              |
| the queue shows every waiting submission | 12 expected, 6 rendered         |
| the card declares what it is not showing | 19 expected, 6 rendered         |
| the tools menu reaches what it names     | landed on Today, no departments |

The new routes were added to both existing crawls, which is how this repository
gets its overflow and accessibility coverage: `/findings?queue=verification`,
the three new register views, `/findings/patterns` and
`/findings/patterns/insights`, at every viewport the crawls walk.

## Three things found that were not Stage 1's doing

`esh-verification-v200` was clicking client-component controls before the page
had hydrated. It passed in CI and timed out for three minutes locally on each of
three cases, reporting a product failure where there was none. It now waits for
`data-app-hydrated`, which is this repository's established pattern.

The framework's own development badge renders a button named "Open Next.js Dev
Tools" on every page, so three `esh-foundations-v197` cases died in strict mode
matching it alongside a form's own Next button. The badge is now off for the
browser suite's server only.

`layout-invariants-v244` fails on this machine in both themes with
`Execution context was destroyed`, four runs out of four — and identically with
every local change stashed, which is how that was established. CI passes the
same spec, and the crawl's own rules are what caught the bare link above, so it
is working. The mechanism is a hard navigation landing inside the crawl's
measuring window rather than anything the walk asserts, and it has not been
found yet; it is being chased separately rather than worked around, because
loosening a crawl to get a green run is how the bare link would have shipped.
All three are recorded in `AGENTS.md` §27.

**Gate S1:** met, on the evidence of a dispatched CI run rather than a local
one. Existing finding and guest role tests green — `esh-verification-v200`,
`esh-foundations-v197`, `esh-guest-v198`, `esh-navigation-v217`,
`esh-overview-v202`, `esh-dashboards-v230` and both ESH crawls were run
locally and pass — each counter matched its drill-down, the old links resolve,
the department scope is applied by the database, and the crawls walk the new
routes at both widths in Day and Night. No schema change.
Stage 2 remains blocked on the QR, privacy, emergency-contact and retention
decisions, which are the user's to make.
