# V35 Next-action impact map

## Approved delta

- Rename task-detail **Do Next** to **Next action** and remove generic fallback wording.
- Add inline Set/Edit/Mark done, Checklist action reuse, split update fields, and task-age information disclosure.
- Reuse `tasks.next_action`; preserve every unrelated state, permission, Goal, attachment, notification, capacity, and storage rule.

## Implementation surface

| Surface           | Change                                                                                   | Preserved authority                                            |
| ----------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Task drawer       | Next-action card, Checklist row, split update fields, age modal                          | Existing task read model and capability flags                  |
| Server actions    | Validate direct and update-form input                                                    | Signed-in session plus database procedure                      |
| Database commands | Shared Next-action helper, direct command, optional task-update argument                 | `focus.can_edit_task`, row locks, idempotency, immutable audit |
| Audit             | Changed/completed events with prior/current action and source                            | Existing append-only audit table and RLS                       |
| Tests             | Owner, view-only denial, atomic update, state preservation, desktop/mobile accessibility | Local Supabase and existing Playwright harness                 |

## Prototype-fidelity correction

The approved v35 HTML and supplied drawer captures require the compact task-detail hierarchy below. This is a frontend-only correction: no schema, RLS, command, storage, notification, or audit behaviour changes.

| Previous presentation                                        | Approved presentation                                                                                            | Affected surface                         | Preserved behaviour                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| Metadata and age chips appeared above the task tabs          | Support strip first, tabs second, tab-specific metadata below                                                    | `TaskDetailDrawer`, task-only drawer CSS | Existing read model and age calculations                            |
| Support used a large Overview-only card and inline form      | Compact persistent support strip with accessible barrier modal                                                   | Task drawer and shared modal             | Existing `raiseBarrier` command and capability gate                 |
| Next action shared an oversized card with lifecycle controls | Compact standalone Next action card; extended task actions available through Expand                              | Task Overview                            | Existing task state-transition actions                              |
| Update composer required an extra reveal action              | **Post an update** composer is immediately available with separate fields and compact attachment/support actions | Updates tab                              | Existing atomic update and attachment submission                    |
| Checklist and activity used loose, unconnected rows          | Bordered compact checklist rows and separated compact activity records                                           | Checklist and Updates tabs               | Existing completion, evidence, reopen, and audit history operations |

## Data and migration impact

No task column, RLS policy, storage rule, or existing data is replaced. Forward migrations add two audit enum values and additive/compatible procedure behaviour; `next_action` remains nullable short text.
