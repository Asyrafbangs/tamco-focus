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

`supabase/tests/rls_visibility.test.sql` proves 61 properties including anonymous Goal denial, own
Goal access, view-without-update/edit/agreement, direct-table mutation denial, authorised manager
agreement, aggregate plan/session visibility, audit creation, deactivated-token denial, append-only
history, private attachment behaviour, private notification-email delivery history, and the
administrator/manager/explicit/none Team projection matrix. `npm run db:test` and the integration
suite run against real local Postgres and Auth.

## Notification-email delivery

An authenticated recipient may select only their own `notification_email_deliveries` rows and has
no insert, update, delete, or claim privilege. The trigger is a narrowly scoped security-definer
function attached to the already-authorised notification insert. Only the server-side service role
may claim deliveries, persist rendered content, or change retry/sent state.

## Team projection boundary (v69)

`user_profiles_select` may expose the viewer's reporting manager so the application can name that
relationship. `team_load_summary` and `focus_summary` additionally require
`focus.can_view_user(profile.id)` for authenticated callers; name attribution is not workload
visibility. Administrators receive all active profiles, reporting/explicit scopes receive their
configured people, and `none` receives only the caller's own projection (which application Team
lists exclude). The local server-only service role retains its established read-model access and
never reaches browser code.

Team Member Detail may project named Available Tasks, overdue routine occurrence Tasks, and current
Goals only after the requested person is found in that same roster. The underlying security-invoker
Task and Goal policies still filter every record. Collaboration with one Task or participation in
one Goal is record access, not permission to obtain the owner's Team profile or other workload.
The v70 rows are view links only and do not grant lifecycle or management authority.

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

## Calendar rescheduling (v153)

`plan_events.can_reschedule` evaluates `focus.can_edit_task` as the viewer: the view is
`security_invoker`, so `auth.uid()` inside the function is the caller. It is an interface
courtesy and grants nothing. A drop on the Monthly Plan calls `change_task_due_date`, which
re-checks authority, closed-work state and the expected version on every call. A collaborator
therefore sees a shared due date on their calendar but is offered no move, and the procedure
refuses one with `not_authorised`; the owner's manager may move it, as they may in the task drawer.

## Platform, Focus and Finding separation (v203)

`focus.is_admin()` now reads the explicit active `platform_administrator` flag. TAMCO Focus uses
its explicit preset (with `role` retained as a compatibility projection), while Finding Management
continues to use `esh_staff_access` and its own department scope. None grants either of the others.
The final active platform administrator cannot be removed or deactivated through normal writes.

Contact directory counts are administrative metadata. Relationship titles come through a
security-invoker view and therefore remain constrained by the caller's separate Finding RLS scope.
Guest grants and sessions remain unreadable to clients; audited security-definer procedures expose
only the active-item metadata needed for targeted revocation.

## v212 handover-request boundary

- Naming a successor confers nothing on them: no contact record, no grant, no session, no
  visibility. The address is readable only where the message is. Reassignment remains coordinate
  authority within scope.
- Enabling a contact from a finding is the same administrator-only act as enabling it from the
  directory, with the same reason and the same audit. It is reachable only by somebody who is both
  an administrator and Finding staff, because the finding page itself requires Finding access.

## v211 request-for-time boundary

- A requested date is part of a message, so it is readable exactly where that message is: the owner
  who wrote it, ESH within the finding's department scope, and nobody else. It confers nothing.
- Only `esh_change_due` moves a deadline, and it still demands coordinate authority within scope, a
  reason, and an open finding. An owner pressing Ask for more time has made a request, not a
  change, and the record distinguishes the two.

## v210 preview and operational boundary

- Previewing a report is the same authority as configuring one: report management within the
  caller's own organisation. It reads under the definition's scope and writes nothing, so it cannot
  become a way to capture or to send.
- `esh_operational_health()` answers only for the caller's own organisation and only while their
  Finding access is enabled. It reports counts of stuck work, never its contents, so nothing about
  a restricted finding reaches somebody through the health line.
- `esh_worker_runs` is written by `service_role` alone and read by Finding staff in their own
  organisation. A browser cannot claim the scheduler ran, and no role can rewrite or delete a run
  that was recorded.
- The register's escalation level is derived inside a security-invoker view, so it is visible
  exactly where the row it belongs to is.

## v208 priority boundary

- Only Finding staff who can coordinate, and only within their department scope, may change a
  priority; the record is readable wherever the action is.
- The change is not a deadline change and carries none of its authority: it cannot move `due_at`,
  the baseline or the escalation route.

## v209 outcome and policy boundary

- Recording an outcome is ESH verify authority within the finding's own department scope, and is
  refused outright for a closed finding — reopening is the deliberate path back.
- An outcome revokes exactly the access that belonged to the work it stopped: action grants and
  action-scoped sessions. A principal's inbox session keeps working for their other actions.
- Policy rules are readable by Finding staff and writable only by a Verifier. The rule that governs
  an action is fixed at assignment, so nobody can quietly change what an owner was promised.

## v207 digest boundary

- Digest membership is readable wherever the notification it belongs to is readable, and by no
  guest at all.
- Consolidation never widens a scope: an owner digest carries one owner-inbox link, an escalation
  digest carries one action-scoped link per activated entitlement, and neither carries the other's.
- Every member is revalidated against live state at send time, so a digest cannot deliver a link to
  work that has moved on since it was gathered.

## v206 bulk boundary

- Bulk routines are service-role only and resolve the guest session themselves; a signed-in browser
  cannot call them, and an action-scoped session is refused outright.
- Each item is rechecked at execution — principal, live assignment, state and file rights — so a
  reassignment or a closure between selecting and pressing skips that item rather than writing it.
- Bulk records are readable by Finding staff who can coordinate, and by nobody else; guests reach
  them only through the procedure's own answer.
- Sharing a file copies it per action. No association crosses into another action's conversation,
  and removing one leaves every other copy and every submission untouched.

## v205 import boundary

- Staging tables are readable only by signed-in Finding staff whose access includes `coordinate`,
  within their own organisation; `anon` has nothing, and no Action Owner or escalation session can
  reach staging at all.
- Every import procedure is `security definer` with its own `coordinate` check, so a browser cannot
  write a staged row, a decision or a release directly.
- A staged row is not a finding: it is in no register, overview, export, report or timer until it
  is released.
- The notification-outbox policy recognises a batch summary as well as a finding, so a held import
  email is visible to the staff who can see its import rather than waiting invisibly.
- `source = 'import'` can only be set by a release that names its batch; a hand-written finding
  cannot claim to have come from a register.

## v204 report boundary

- Signed-in people can select report configuration and runs only when their separate Finding access
  has `can_manage_reports`; report management grants no finding mutation authority.
- Report grants, guest sessions and report-session entitlements have no `anon` or `authenticated`
  table access. The server reaches only narrow service-role procedures.
- A `report_viewer` grant must name one run and one recipient and cannot name an action. Owner,
  inbox and escalation grants cannot name a report.
- Every report read rechecks contact access, recipient enablement and entitlement version, plus the
  current definition and scope versions. Restricted findings are excluded at both snapshot and live
  query boundaries.
