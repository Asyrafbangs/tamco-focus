# Stage B — ESH does the thinking

The employee reports what they saw. ESH decides what kind of hazard it is,
during review, from a short list. That division is the whole design, and
everything below follows from it.

Until this stage there was no taxonomy at all, and that was deliberate: v279
and v280 both say in their own headers that categories were an open decision
and that nothing was to be grouped by hazard type. The lean package supplies
the list, so this stage builds it — and nothing is overwritten, because no
finding in this database has ever carried a category.

## Four decisions, and why each went that way

**A table, not an enum.** ESH retires a category with `active = false` and
adds one with an insert. An enum would make both a schema migration, and
`drop type` is not something to do to a column thousands of rows deep.

**Stable codes, separate labels.** `slips_falls` is what the data says, for
ever. "Slips, trips and falls" is wording, and wording gets revised. A report
grouped by code survives a rewording; one grouped by label does not.

**One primary, one optional secondary.** Not a list. A finding recorded as
three things is a finding nobody has thought about, and a list makes every
count ambiguous — add up a distribution of multi-category findings and the
total exceeds the number of findings, which is the point at which people stop
believing the table.

**Optional, never required.** A finding exists before it is classified, so
making the category mandatory would mean either blocking the existing accept
flow or inventing a category for the system to apply — and inventing one is
the thing this project forbids. Historical findings stay uncategorised rather
than being guessed at, and both the register and Patterns count what is
uncategorised instead of leaving it out. A gap that is visible gets closed; a
gap that is hidden does not.

## The nine categories

| Code              | Label                              |
| ----------------- | ---------------------------------- |
| `electrical`      | Electrical and testing             |
| `machinery`       | Machinery and equipment            |
| `lifting_traffic` | Lifting and vehicle traffic        |
| `slips_falls`     | Slips, trips and falls             |
| `fire`            | Fire and explosion                 |
| `chemical`        | Chemicals and hazardous substances |
| `ergonomics`      | Ergonomics and manual handling     |
| `environment`     | Environmental                      |
| `other`           | Something else                     |

Each carries a one-line description, shown under the chooser once a category
is selected, so nobody has to infer what a two-word label covers. `other`
sorts last (999) so it reads as the answer of last resort rather than a
convenient first option — and its description asks the coordinator to say what
the hazard actually is.

## Who may classify, and on what

`esh_set_finding_hazard` is `security definer` and holds every rule:

- a Coordinator only — a viewer who can see the finding cannot classify it;
- a finding in a department they cover, with `<> all` and an explicit null
  branch, because `<> any` is true the moment a coordinator covers more than
  one department and an unrouted finding needs saying separately;
- a category that exists and is still active;
- a secondary that differs from the primary, and never without one;
- clearing allowed, which also clears the decision date rather than leaving a
  stale one behind.

The table refuses the same shape the procedure does, so nothing that gets past
one is caught by the other at the last moment, and every change writes a
`hazard_classified` audit event with what it was and what it became.

## Where it appears

**The finding's own page** — a chooser under "What kind of hazard", placed
immediately after the finding's evidence and deliberately **not** inside the
folded "Full record" details element. A control nobody can see is a control
nobody uses, and this module has shipped two of those.

**The register** — the label on each row beside the department and the risk,
and a Hazard filter that includes **Not categorised** as a choice of its own.
That last one matters more than it looks: "which open findings has nobody
classified yet" is the question that makes the gap fixable, and a number on a
reporting page cannot be worked through.

**Patterns** — a table of counts per category: findings, open, significant,
and recurring. Every active category is a row even at zero, because a category
nobody has used is itself worth seeing. Below it, how many open findings are
still uncategorised, said plainly.

No chart. Nine rows are read faster as a table than as a chart, the table works
at phone width inside the same scrollable, keyboard-reachable wrapper the
department table uses, and a chart of three findings implies a trend that three
findings cannot support. No score, no ranking by likelihood, no second place
where work is tracked — all four are the package's instruction and all four
were easy to add, which is why they are written down as refused rather than
left unmentioned.

"Recurring" is counted from v280's connections — duplicates, recurrences and
re-reports — so it is built only from links a coordinator recorded, never from a
title or a location.

## What is proven, and how

`esh_hazard_classification_v287.test.sql` holds 22 assertions as a coordinator
scoped to **two** departments. Two is the point: at one department a wrong
`<> any` reads exactly like a correct `<> all`, which is how six Stage 2
procedures shipped refusing the departments they covered behind fifteen passing
assertions.

`esh-hazard-classification-v287.spec.ts` drives the real screens, because the
failures this stage could plausibly ship are not database failures: a chooser
folded inside a details element, a register row that shows nothing, a filter
that silently matches everything. It also reads back from the database rather
than from the page that wrote it, and waits for the save to be acknowledged
before navigating — a click followed by a `goto` cancels the server action and
reads exactly like a product bug.

## Triage: what was already there, and the one thing that is not

§5 asks for Accept, Mark Duplicate, Request Information "where possible", and
Decline with Reason. Three of the four already exist and are unchanged here:
**Review as Finding** (v278), **Mark as duplicate** (v276) and **Decline
report** (v275), each demanding a reason and each recorded.

**Request Information is deferred to Stage C, because there is nobody to ask
yet.** `esh_report_intake` has no reporter contact column: v272 to v278 added a
department, a triager, a decision reason, a duplicate link and an accepted
finding, and deliberately no way to identify who reported anything. Optional
contact details arrive with the public form in Stage C, and that is the stage
where "ask the reporter for more" can actually send something.

Building it now would mean one of two things, and both are worse than waiting:
a button that opens a box and notifies nobody, or a sixth intake status that
means "we are waiting", which is an approval layer by another name — the thing
§5 asks us not to add. When it does arrive it will be offered only on a report
whose reporter left a way to be contacted, which is what "where possible"
means.
