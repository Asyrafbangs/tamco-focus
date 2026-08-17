# RLS and permissions

## Default model

The model is default deny → own work → inherited reporting scope where configured → explicit administrator grant. Visibility grants convey view access only. They never convey edit, activation, reassignment, completion, approval, or review authority.

Every user-data table has RLS enabled. `anon` has no table access. Views use the caller's permissions. Storage policies mirror the attachment table rules.

## Roles

| Capability                              | Team member                        | Manager                       | Administrator                |
| --------------------------------------- | ---------------------------------- | ----------------------------- | ---------------------------- |
| Own task lifecycle                      | Yes                                | Yes                           | Yes                          |
| Contribute where assigned/collaborating | Yes                                | Yes                           | Yes                          |
| View authorised team scope              | Only explicit scope                | Reporting/explicit scope      | Organisation scope           |
| Edit another owner's task               | Only transactional delegated cases | Governed manager cases        | Governed administrator cases |
| Completion review                       | Assigned independent reviewer      | Assigned independent reviewer | Assigned/authorised reviewer |
| Routine governance                      | No                                 | Yes where configured          | Yes                          |
| Organisation settings                   | No                                 | Manager-editable keys         | All supported keys           |
| User directory and visibility           | No                                 | No                            | Yes                          |
| View own Goal                           | Yes                                | Yes                           | Yes                          |
| Update own Goal progress/milestones     | Yes                                | Yes                           | Yes                          |
| Coach authorised report Goals           | No                                 | Yes                           | Yes                          |
| Edit/agree Goal structure               | No self-agreement                  | Authorised manager cases      | Controlled organisation case |

## Active-account rule

An active Auth token is insufficient. The profile must also be active. Deactivation blocks application reads through RLS and the application shell, and the administration action bans the local Auth identity. Historical references remain intact.

## Audit

Clients cannot insert, update, or delete audit events. Security-definer procedures write events after rechecking authority. Audit updates are rejected except the narrow identity-reference severance required for a valid history-free account deletion. Administrative security records are append-only.

## Goal capability separation

`focus.can_view_goal`, `focus.can_update_goal`, `focus.can_edit_goal_structure`, and `focus.can_agree_goal` are independent authorities. Ownership or authorised coaching can allow progress updates; a visibility grant allows view only; structural agreement remains manager/administrator authority. Goal tables expose read grants only to clients, while locked, expected-version, idempotent security-definer procedures perform mutations. Private files remain in the existing bucket under `goals/<goal-id>/...`, and signed downloads require Goal view authority and write an attachment-view record.

## Verification

`supabase/tests/rls_visibility.test.sql` proves 58 properties including anonymous Goal denial, own Goal access, view-without-update/edit/agreement, direct-table mutation denial, authorised manager agreement, aggregate plan/session visibility, audit creation, deactivated-token denial, append-only history, private attachment behaviour, and the administrator/manager/explicit/none Team projection matrix. `npm run db:test` and the integration suite run against real local Postgres and Auth.

## Team projection boundary (v69)

`user_profiles_select` may expose the viewer's reporting manager so the application can name that
relationship. `team_load_summary` and `focus_summary` additionally require
`focus.can_view_user(profile.id)` for authenticated callers; name attribution is not workload
visibility. Administrators receive all active profiles, reporting/explicit scopes receive their
configured people, and `none` receives only the caller's own projection (which application Team
lists exclude). The local server-only service role retains its established read-model access and
never reaches browser code.

## v53 authority additions

Task capabilities now expose terminal cancellation separately from generic edit authority, so a
Mandatory owner never sees a control that SQL must refuse. Request visibility follows either its
Task or Goal source plus the named actor/recipient; terminal source markers remove actionability but
do not widen access. Proposal decision authority belongs to the proposer’s authorised manager, while
only the proposer may resubmit requested changes.

Employees may read their own Goal plan/sessions and submit their own monthly aggregate only through
the procedure. Authorised managers may read direct-report plans and complete quarterly sessions;
under `department_only`, manager/administrator self-review is permitted without a fake reporting
line. Lifecycle tables remain direct-write denied to authenticated clients. Goal completion uses
agreement authority; cancellation allows the owner or authorised manager.
