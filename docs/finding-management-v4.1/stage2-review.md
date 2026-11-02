# Stage 2 — Private intake, reviewed against its own gate

Stage 2 was built on `codex/finding-v41-stage2` (PR #52) and reported complete
with fifteen passing pgTAP assertions and a browser case. This document records
the review that followed, on 2 November 2026, and the two corrections it led to.

## What the stage got right, and it is the harder half

Stage 2 is named "QR intake" in the plan, and the plan's QR half depends on
five decisions nobody has made: anonymous reporting and its notice,
emergency-contact routing in and out of hours, photo retention and EXIF,
hazard categories, and scanner hosting. The stage built only the part that
needs none of them, and then made the rest unreachable rather than merely
unused:

- `esh_qr_intake_settings` carries `check (enabled = false)`. The public toggle
  cannot be turned on by configuration, an environment variable or a careless
  `update`; it takes a migration, which is a reviewed change.
- `/report` renders a closed notice and no form at all — no textarea, no
  upload, no submit.
- `esh_report_intake` has no reporter-contact and no evidence columns, so the
  anonymity and retention questions do not arise yet because there is nothing
  anonymous or uploadable to retain.
- Acceptance reuses `public.esh_save_finding(null, payload, p_assign, null)`
  rather than reimplementing assignment: one row lock, one idempotency key, one
  audit event, and a unique index on `accepted_finding_id` so a retry cannot
  turn one report into two Findings.

No business policy was invented anywhere in it. That was the right call and it
is why the stage could be reviewed at all.

## The defect: `<> any` where the predicate needs `<> all`

Six scope checks across five migrations — v274, v275, v276 (twice), v277 and
v278 — were written as:

```sql
intake.department_id <> any (focus.esh_visible_department_ids())
```

`'a' <> any {a,b}` is **true**: the array holds _some_ element that `a` differs
from. The predicate the code needs is `<> all`, which is true only when the
value differs from every element.

The effect was that every triage procedure refused every coordinator who covers
two or more departments — the only kind of department-scoped coordinator there
is — on reports in departments they do cover. The v273 row-level security
policies use the correct positive form, so the rows appeared in the queue and
then refused `claim`, `decline`, `mark duplicate`, `manual entry` and `accept`
with `not_found` or `department_not_found`. An organisation-wide coordinator
never saw it, because `focus.esh_scope_all()` short-circuits the branch.

**Why fifteen assertions passed over it.** `esh_intake_accept_v278.test.sql`
acts as `f0c05000-…-002`, whose access is seeded `scope_all_departments = true`.
Every scope branch in every procedure returns before reaching the broken
comparison. The suite fixtured the one role the defect cannot reach, which is
the §27 rule in a new costume: ask which rows a guard actually governs, and
fixture _those_.

The repository's own idiom is the positive form, `x = any (…)`, used in
twenty-odd places since v205. These six were the only negated uses in the
codebase, and a repository-wide search for `<> any` and `!= any` now returns
nothing.

### Proof

`supabase/tests/esh_intake_department_scope_v278.test.sql` runs twelve
assertions as a coordinator scoped to **two** departments, granted through
`public.esh_set_staff_access` rather than by writing the access rows by hand.
Its first assertion is that the fixture really covers two departments: at one
department the wrong operator reads exactly like the right one, so a
single-department fixture would prove nothing.

Each of the six sites was then broken on its own and the failing assertion
recorded:

| Site                      | Assertion that fails when reverted                   |
| ------------------------- | ---------------------------------------------------- |
| v274 claim                | claims a report in a department they cover           |
| v275 decline              | declines a report in a department they cover         |
| v276 intake scope         | links a covered report to a covered Finding          |
| v276 target-Finding scope | links a covered report to a covered Finding          |
| v277 manual entry         | records a verbal report against their own department |
| v278 accept               | accepts the report they claimed                      |

With all six reverted, six of the twelve assertions fail. The two v276 sites
were separated by reverting the target-Finding line alone, which fails that one
assertion and no other — the negative cases cannot distinguish them, because a
wrong `any` also refuses what should be refused.

## The queue nothing linked to

`/findings/intake` had no inbound link anywhere in the application. The only
references to the route were a `revalidatePath` call and the browser spec's own
`page.goto`. Stage 1's "Incoming reports" card — the card that exists to
surface these reports — still said public QR reporting was not enabled and
showed a permanently empty queue. A coordinator could not reach the feature
without being told the address.

Today now carries it on both routes Stage 1 established:

- the **New reports** counter is live, links to `/findings/intake`, and is read
  through the register's own query under RLS rather than from a procedure, so
  the number and the list behind it are two answers to one question;
- the **Incoming reports** card previews six rows and states how many it is not
  showing, the rule Stage 1 fixed on the verification card;
- neither appears for a reader without coordinate authority, because
  `/findings/intake` refuses them and a counter leading nowhere is worse than
  no counter.

Every triage decision now revalidates `/findings` as well as the queue.
Clearing only the queue left Today's counter showing its pre-decision value.

## The page itself

Five of the classes the intake page used do not exist in `globals.css` —
`esh-workspace`, `esh-page-head`, `esh-empty-state`, `esh-register-list` and
`status-chip` — as does `settings-card` on the manual-entry form and
`esh-intake-actions` on the triage controls. The page rendered as unstyled
browser default, and `/findings/intake` was in neither crawl, so nothing
noticed. It now uses the register's real classes, `esh-intake-actions` is
defined, the triage controls carry the repository's button classes instead of
bare `<button>`, and the route is in both crawls at every viewport they walk.

Three smaller corrections:

- the page rendered its own `<main className="esh-workspace">` inside
  `findings/layout.tsx`'s `<main id="esh-main">`, a duplicate landmark;
- dates used `Intl.DateTimeFormat('en-MY', …)` with no `timeZone`, unlike every
  other page in the module — including `/findings/new`, which passes the
  profile's zone — so a hosted deployment would have rendered UTC;
- the row title was the raw `report_text`, up to 4000 characters, on a single
  line.

## The manual form could not see what it recorded

`esh_create_manual_report_intake` takes a department and the server action
passes one, but the form never offered the field, so every manually recorded
report had `department_id = null`. Because the v273 policy is
`department_id = any (…)`, a NULL department is NULL-safe-false: an unassigned
report is visible only to a coordinator who covers the whole organisation. A
department-scoped coordinator writing down a verbal report would not then see
it in the queue.

The form now asks for the department, offering the ones in the coordinator's
scope. "Not known yet" is available only to a coordinator who can see every
department, because they are the only ones who could act on the result. This
chooses between two behaviours the database already permits; it does not invent
a routing policy, and the question of who owns unrouted reports in production
remains open under _Decisions requiring human ownership_.

## What is still not built, by design

The public half of Stage 2 — the QR codes, the anonymous route, public photo
upload, emergency notification delivery and the sticker/location mapping —
remains closed behind the `check (enabled = false)` constraint and is blocked
on the five decisions above. Nothing in this review changes that, and the
constraint means activation cannot happen by accident.

## Two things in Stage 1 that this stage changed or exposed

**Stage 1 asserted that New reports was disabled.** It was the honest
assertion at the time — nothing had reached the intake store — and Stage 2
makes it wrong. The case now asserts the opposite and the same rule: the
counter carries `href="/findings/intake"` and is not disabled, because a
counter is a way in to the list it counted.

**The overdue comparison was time-dependent, and flaked once in four runs.**
`v4101 every Today counter lands on a list holding exactly what it counted`
failed with 105 against 106. The two definitions are identical --
`a.state in ('assigned','in_progress') and a.due_at < now()` on both sides,
confirmed equal on the data at 109 against 109 -- and the test passed three
times in a row afterwards. The mechanism is the clock: the counter and the
register total are read from two pages about twenty seconds apart, over a
database holding a hundred-odd past-due fixtures left by earlier cases, so one
action falling due inside that window makes the two numbers differ by one with
nothing wrong. It is the only one of the four counters whose value depends on
`now()`.

The pair is now read again rather than once. That does not soften the guard,
which was checked the only way worth checking it: with the register's
`is_overdue` filter removed, so the view holds every open action instead of
the overdue ones, the difference is 29 on every poll and the case still fails.
Only a difference that resolves itself is tolerated, and only because the clock
moving is not a defect.

## Environment, not this stage

`esh-navigation-v217` and the v272 case each failed once on this machine by
losing their session -- one redirected to `/sign-in?next=...`, the other to
`/sign-in?error=invalid` -- after several suites had been run back to back.
That is the socket-exhaustion symptom recorded in `AGENTS.md` section 27, and
both pass on their own. The verdict for the stage comes from a dispatched CI
run, not from this machine.
