# Stage 3a — the links between findings

Stage 0's baseline sets S3 as "adds reviewed classification and explicit
duplicate/recurrence/related links. Do not infer historical categories or
causes." Those are two halves with different blockers, so they are built
separately. This document covers the link half, which needs no decision from
anybody. The classification half is held; see the last section.

## What already existed, which is most of it

There is no `esh_finding_relationships` table anywhere in the repository, and
there should not be one. Two directed finding-to-finding links were already
stored, and both were already on the finding detail page:

| Link       | Stored                                               | Rendered before this stage                                    |
| ---------- | ---------------------------------------------------- | ------------------------------------------------------------- |
| duplicate  | v209 `esh_findings.duplicate_of_finding_id`          | `page.tsx:791` — "Duplicate of ESH-…" as text inside a notice |
| recurrence | v267 `esh_effectiveness_checks.follow_up_finding_id` | `page.tsx:555` — "Raised again as ESH-…" as text              |
| related    | nothing                                              | nothing                                                       |

Neither was migrated into a new table. `duplicate_of_finding_id` carries a
check constraint tying it to `resolved_outcome = 'duplicate'`, so the register
cannot record a duplicate without saying what of; moving it would trade a
database-enforced invariant for tidiness and leave two answers to one
question. v267's `follow_up_finding_id` is deliberate in the same way: a failed
effectiveness check raises a new finding rather than reopening the original,
because the original closure was a true statement about the month it was made
in.

So the gaps were narrower than "add the links", and more specific:

1. **Neither reference was navigable.** Both rendered as bare text, so a
   coordinator reading "Duplicate of ESH-2026-0041" had to go and search the
   register for it by hand.
2. **Both links were one-directional.** The duplicate knew what it repeated;
   the original did not know what repeated it. The finding raised by a failed
   check did not say what it came from — only the check carried that pointer,
   and the check belongs to the other finding.
3. **There was no undirected link at all** for two findings that merely inform
   each other: the same guard on a different machine, two reports from one
   walk, a correction whose scope turned out to cover both.

## What v279 adds

`public.esh_finding_links` holds the symmetric case **only**. Because the
relation is symmetric, storing it twice in opposite directions would let the
two copies disagree, so there is one row per pair with the ordering enforced by
the database:

```sql
constraint esh_finding_links_ordered check (finding_id < related_finding_id)
```

That constraint is what makes the unique index on
`(organization_id, finding_id, related_finding_id)` the whole uniqueness rule:
a pair cannot be stored twice, and cannot be stored once each way. The two
procedures normalise with `least`/`greatest` before writing, so relating B to A
finds the same row as relating A to B, and removing it from either end removes
the one row there is.

Relating the same pair again replaces the reason rather than failing — the
second attempt is somebody saying it better, not a mistake.

**Reading a link needs both of its ends.** The policy delegates to
`esh_findings`, which carries the scope rules, and requires both:

```sql
using (
  finding_id in (select f.id from public.esh_findings f)
  and related_finding_id in (select f.id from public.esh_findings f)
)
```

One readable end is not enough, because a link is a statement about two
findings: a reader in one department would otherwise learn the reference of a
finding in a department they cannot see.

The scope checks in both procedures are `<> all` with an explicit null branch,
which is the Stage 2 lesson applied rather than rediscovered. They are also
checked **in the order the caller passed them**, not in stored order — keying
the refusal codes off which identifier happens to sort lower would make an
unchanged call return `not_found` or `related_not_found` unpredictably. That
was a defect in the first draft of this migration, found before it was tested.

On the page, the two existing references are now links, the reverse duplicate
view ("Reported again as") appears for the first time, a finding raised by a
failed check says which correction did not hold, and a coordinator can relate
and unrelate findings by reference. The related list is read through two
separate `.eq()` queries rather than one interpolated `or` filter, so the route
parameter never reaches a PostgREST filter string, and the references all
resolve in a single `.in('id', …)` rather than one request each.

## Proof

`supabase/tests/esh_related_findings_v279.test.sql` runs 19 assertions as a
coordinator scoped to **two** departments, with a viewer scoped to the same
two, both granted through `public.esh_set_staff_access`. Its third assertion is
that the fixture really covers two departments, because at one department a
wrong `<> any` reads exactly like a correct `<> all`.

Each guard was then removed on its own and the assertion it fails recorded:

| Break                                           | Assertion that fails                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| subject scope check → `<> any`                  | relates two findings in departments they cover (4), and 5–10       |
| related scope check → `<> any`                  | the same (4), and 5–9 — distinguished from the above at 10         |
| ordering constraint dropped                     | the constraint refuses a reversed pair (14)                        |
| normalisation dropped, with the constraint too  | relating it from the other end stores no second row (8)            |
| policy requires one readable end instead of two | a link is unreadable unless both ends are (13)                     |
| coordinate check dropped                        | a viewer who sees both findings still cannot relate them (12)      |
| `on conflict do update` → `do nothing`          | the second attempt replaces the reason (9)                         |
| `same_finding` guard dropped                    | aborts on the ordering constraint — the constraint is the backstop |
| audit insert dropped                            | both relating decisions are on the audit trail (19)                |
| unlink scope checks dropped                     | cannot remove a link whose far end is uncovered (15–16)            |

The browser case `esh-related-findings-v279.spec.ts` holds what a database test
cannot: that the link is on both findings, can be followed, and disappears from
both when removed from the far end. It was proven the same way — reverting the
duplicate reference to text fails the duplicate case, making the related query
one-directional fails the symmetry case, hiding the reverse duplicate view
fails its heading, and passing the list no rows fails the related case. Only
the symmetry break and the empty-list break fail the related case, and they
fail it for different reasons.

The authorization boundary stays in the pgTAP file rather than the browser
suite on purpose: granting a viewer's access in a browser test would persist
in a shared database and change what every later case sees, while a pgTAP
transaction rolls back.

## What is held, and why

Classification is not built. "Final hazard categories and department/location
names confirmed by ESH and plant representatives?" is an open decision on the
tracker, and Stage 0 is explicit that historical categories must not be
inferred. A category column with an empty or user-managed vocabulary would be
inventing the policy by another route, so nothing that names a category is
here. Backfilling existing findings is not available in any case.

That decision gates **S3b only**. Nothing above waits on it.
