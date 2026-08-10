# Attention UI repair — implementation impact map

Date: 10 August 2026

Reference: the approved repair brief and My Day screenshot supplied on 10 August 2026. This is a corrective delta over v49, not a redesign.

Latest amendment: My Day displays no more than two attention rows. The true
total remains visible and View all opens the complete manager attention list
when additional requests exist.

Visual parity follow-up: each row now separates severity, request icon, content,
requester identity and CTA. The card has a measured 12px gap before two
equal-height Start Here / Today columns at the 864 × 1024 reference viewport.

## Root cause and affected paths

| Area                | Current implementation                                                              | Failure                                                                                                                                                                               | Repair boundary                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| My Day summary      | Uses the generic `AttentionCard` list presentation                                  | Default heading and paragraph margins expand each row, creating large blank gaps; the hierarchy does not match the approved compact summary                                           | Add dedicated `MyDayNeedsAttentionSummary` and `MyDayAttentionRow` presentation components with scoped styles                                 |
| My Team people list | Reuses generic `TaskRow` and its absolute stretched-link overlay                    | The generic four-column task grid combines Person and Working on, conflicts with the five-column manager hierarchy, and places a full-row overlay around a row containing its own CTA | Add a dedicated non-interactive-wrapper `MyTeamPersonRow` using `role="button"`, keyboard activation, and an independent nested action button |
| My Team CTA         | CTA href includes `person`, `task`, and attention parameters                        | Clicking the CTA mounts Team Member Detail and Task Detail together; the manager action is not independent from the parent row                                                        | Stop propagation and route the CTA directly to the resolved record while retaining only the team/filter return context                        |
| View all            | Opens the viewer's personal attention backlog                                       | Does not follow the approved manager navigation path                                                                                                                                  | Route to Work → My Team → Needs Attention                                                                                                     |
| CTA mapping         | Barrier wording and destinations are assembled in multiple query/component branches | Stale or incomplete identity can produce a visible action whose destination cannot be trusted                                                                                         | Add one validated resolver requiring `sourceType`, `sourceId`, and `ctaType`; keep display components presentation-only                       |
| Routine exception   | Generic overdue-task selection wins before the routine branch                       | An overdue routine is labelled `Overdue work` and receives `Open task`                                                                                                                | Exclude routines from generic overdue-task selection and resolve the exact occurrence as `Open routine`                                       |

## Preserved behaviour

- No database schema, migration, RLS, authentication, permission, notification, audit, workflow, calculation, or storage change.
- Existing task, barrier, routine, focus, and manager visibility queries remain authoritative.
- Team Member Detail, Task Detail, barrier response operations, and unrelated page layouts remain unchanged except for consuming the corrected shared CTA mapping.

## Verification

- CTA tests: row pointer/Enter/Space, nested action isolation, exact barrier, exact routine, default Open, and View all.
- Layout tests: 1440, 1280, 1024, 768, 430, and 390 px plus 125% and 150% width pressure.
- Stress text: long title, long request, long person name, and unbroken reference.
- Regression gates: lint, format, strict TypeScript, unit, focused E2E/accessibility, production build, and smoke.
