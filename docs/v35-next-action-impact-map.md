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

## Data and migration impact

No task column, RLS policy, storage rule, or existing data is replaced. Forward migrations add two audit enum values and additive/compatible procedure behaviour; `next_action` remains nullable short text.
