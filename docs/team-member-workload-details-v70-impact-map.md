# v70 Team member workload details — implementation impact map

## Approved change

The Team Member drawer's **Other workload** disclosure must show the named records behind its
summary. Available tasks, overdue routine occurrences, and current Goals are compact read-only
context rows; selecting a row opens that exact Task, routine occurrence, or Goal detail.

## Impact map

| Area                     | Previous behaviour                                                     | Required correction                                                                                                                   | Authority preserved                                              | Verification                              |
| ------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| Team detail query        | Returned three counts; the UI had no record identity or text to render | Return minimal item projections in one set-based Task read and one minimal Goal read                                                  | Authorised Team roster plus security-invoker Task/Goal RLS       | Typecheck and v70 E2E                     |
| Available work           | Count only                                                             | List every visible non-routine backlog item with class and due context                                                                | Task RLS; no Activate or reassignment action added               | Exact Task link and count/list parity     |
| Routine context          | A `routines_overdue` count was labelled only “Routine”                 | Label and list the exact overdue occurrence Tasks, with due time and checklist progress                                               | Occurrence Task RLS; no template-policy widening                 | Exact occurrence link                     |
| Goal context             | Raw count included terminal lifecycle states                           | List Draft, For Discussion, and Active Goals with lifecycle, Active health, target, formal weight, and success-measure count          | Authorised-person intersection plus Goal RLS/capabilities        | Exact Goal link and safe return path      |
| Navigation               | Task rows could layer over the person; Goal context had no row         | Preserve Task layering and carry a validated internal `from` path through Goal Detail so Close returns to the same Team person/filter | `safeReturnPath` rejects external/protocol-relative destinations | Keyboard/pointer open and one-layer close |
| Responsive/accessibility | Generic paragraph was not actionable                                   | Native whole-row links, visible focus ring, 44 px disclosure target, wrapping metadata, and explicit category empty states            | No client-side permission or action duplication                  | Desktop/mobile E2E and overflow check     |

## Data and permission consequences

- No table, migration, RLS policy, RPC, API, authentication, notification, audit, or stored data
  changes are required.
- A requested `person` is first intersected with the same `getTeamLoad(viewerId)` roster used by My
  Team. A task collaborator or Goal participant cannot promote an otherwise unauthorised person
  into Team Member Detail.
- Item links convey view navigation only. Task and Goal detail capabilities remain the sole source
  of mutation controls.
- Counts are derived from the arrays rendered in the disclosure, so the label cannot disagree with
  the visible rows.

## Preserved behaviour

Needs your attention, Working on now, Recent meaningful updates, workload review, Team filters,
task actions, routines, Goals, and all non-Team modules retain their approved behaviour. The
disclosure remains collapsible to keep the drawer exception-first; it now contains useful details
when opened.
