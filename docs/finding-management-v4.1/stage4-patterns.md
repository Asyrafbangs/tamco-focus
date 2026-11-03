# Stage 4a — Patterns, and the reconciliation the stage actually asks for

Stage 0 sets S4 as: "must preserve those views, reconcile counts with scoped
source rows, and open only findings visible to the viewer. No predictive score
or parallel task tracker." It is a reconciliation stage with one small feature
attached, not a feature stage.

## The audit, and two hypotheses that died

Before changing anything, the existing analytical screens were read for the
defect this stage exists to catch. Two plausible ones were not there:

- **`department=unassigned` is understood by the register.** The insights table
  emits it for the null-department row, and `register/page.tsx:49` reads it and
  passes `departmentUnassigned` into the query. The link does not land on an
  unfiltered list.
- **An action count cannot currently diverge from a finding list.** Two of the
  four columns count actions and two count findings, which would diverge the
  day one finding carried two overdue actions. Every path that creates an
  action — v197, v205's importer, v224's bulk release, v266 — inserts exactly
  one, with `sequence` hardcoded to 1. The equivalence holds, but **nothing
  enforces it**: there is no unique index on `esh_finding_actions (finding_id)`
  and the `sequence` column exists precisely to allow more. That is what the
  reconciliation guard is for.

Scope is enforced in the database on both screens — the queries run under the
reader's own policies rather than being recomputed in the page — so "open only
findings visible to the viewer" was already structural.

One observation left alone: the department table's accessible name sits on the
scroll region v218 added, not on the `<table>`, which has no caption and no
name of its own. The region is announced, so this is a small gap rather than a
defect, and changing existing markup is outside "preserve those views".

## The reconciliation guard

`esh-patterns-v280.spec.ts` walks every department row and compares each of the
four counts with the rows behind its own link — the Stage 1 rule applied to the
historical surface. It passes, so the stage's requirement is now evidenced
rather than asserted.

Two things it needed in order to mean anything:

- **Two departments.** The seed concentrates its findings in one, so a
  single-row table reconciled trivially and proved nothing about scope. The
  case creates a finding in a second department first and asserts the table has
  more than one row before comparing anything.
- **A re-read for overdue.** It is the one column whose value depends on the
  clock: both sides count `due_at < now()`, read from two pages seconds apart,
  so an action falling due in between differs by one with nothing wrong. Only a
  difference that resolves itself is tolerated.

Proven by breaking it: changing the register link's parameter from `department`
to `dept` — which the register silently ignores, so every count opens every
department — fails the reconciliation case and nothing else.

## Patterns now reports reviewed links

The page had said since Stage 1 that "recurring issues will appear after ESH
has reviewed categories and links", and showed nothing. The links exist as of
v209, v267 and v279, and each one is a decision a coordinator recorded, so
reporting them together infers nothing.

`v280` adds `public.esh_finding_connections`, a view over all three sources,
each read from both ends with the relationship named from the reader's side, so
a page asking "what is connected to this finding?" is one `where finding_id =
…`. Three groups on the page: came back after a correction, reported more than
once, related by a coordinator. Symmetric links are stored once and read twice,
so the page lists each pair once.

`security_invoker = true` is the view's entire access control, and **both ends
must be visible**, matching v279's rule: a reader who covers one department
would otherwise learn that a finding they cannot see exists and is connected to
theirs.

### Proof

19 pgTAP assertions as a coordinator scoped to **two** departments, with
`security_invoker` asserted directly from `pg_class.reloptions` rather than
inferred from rows — it is lost silently by a `drop view`, and the register has
leaked that way before. Each guard was then removed on its own:

| Break                                         | Assertion that fails                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| `security_invoker` dropped                    | the view runs under the reader policies (1), and the scope cases 9, 10, 13 |
| both-ends check on the duplicate branches     | a covered finding does not name the uncovered one it duplicates (12)       |
| both-ends check on the effectiveness branches | a recurrence whose far end is outside their scope is absent (9)            |
| the reverse half of the related union         | one related row is readable from either end (8)                            |
| the reverse duplicate branch                  | the finding that was kept says what came back (7)                          |

**The duplicate branches' check was unproven at first, and the fixture was
wrong rather than the code.** Removing those clauses changed nothing, because
the out-of-scope duplicate ran _invisible → visible_, where the source row's
own policy already excludes it. The clauses only bite the other way round: a
**visible** finding duplicating an **invisible** one, where the row survives
its source's policy and names a finding the reader cannot see. With that
fixture added, removing them fails assertion 12. This is the §27 rule again —
ask which rows the guard actually governs, and fixture those.

Two further defects in the test itself, found and fixed: one pair carried both
a duplicate and a related link, so a `select kind` subquery returned two rows;
and a fixture ran as `postgres` with no `auth.uid()` because it sat after a
`reset_role()`.

The browser cases were proven the same way — wrong `kind` for the recurrence
group, wrong `kind` for the duplicate group, and dropping the `.sort()` from
the pair key so a symmetric link lists twice. Each fails its own case. Note
that a break which _removes_ a usage fails `next build` on the unused variable
and never runs the suite, which proves nothing; every break here is a plausible
wrong value instead.

## Held, and not to be added

Patterns by hazard category need the category list confirmed by ESH and plant
representatives, and Stage 0 forbids classifying historical findings after the
fact. The page says so rather than omitting it silently. There is no predictive
score and no second place where work is tracked; neither is to be added at any
point.
