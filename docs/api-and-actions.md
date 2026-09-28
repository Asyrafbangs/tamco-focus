# Server actions and database contracts

## Contract pattern

High-impact procedures return JSON with `ok`, a stable `code`, an actionable `message` on refusal, and operation-specific detail. Server Actions validate input with Zod, call the procedure as the signed-in user, avoid reproducing its permission or state rules, and revalidate affected routes.

## Work actions

- `activate_task`, `move_task_to_available`, `pause_task`, `resume_task`, `complete_task`, `cancel_task`, and `reassign_task` enforce lifecycle, version, focus, and audit rules.
- `undo_event` creates a valid inverse transition and preserves both history entries.
- `complete_checklist_item` and `reopen_checklist_item` own progress and dependency changes.
- `post_task_update` commits text, mentions, and uploaded metadata together.
- `raise_barrier` and `resolve_barrier` own barrier impact and notifications.
- `decide_completion_review` separates evidence viewing from explicit acceptance or change request.
- `record_attachment_view` is called by the attachment route before issuing a signed URL.
- `record_routine_finding` creates follow-up Available Work for significant findings without activating it.

## Capture actions

Capture staging records the title, timing, optional files, one approved follow-up answer, deterministic recommendation, and any correction. `confirm_work_capture` creates the final task or governed proposal transactionally and moves attachment metadata without exposing the private bucket.

## Settings and administration

- `update_my_preferences` changes workspace, alert, accessibility, and weekly-summary choices in one audited transaction.
- Organisation-setting writes are constrained by RLS and audited by a database trigger.
- `provision_user_profile` is service-role only. The server first creates the local Auth identity and removes it if profile creation fails.
- `update_user_profile`, `deactivate_user`, `reactivate_user`, and `delete_user_permanently` preserve history and use compensating Auth changes.
- `set_user_visibility` replaces one viewer's policy and grants atomically; `preview_effective_visibility` reports who and why without changing access.

## Route handlers

`GET /api/attachments/[id]` requires a signed-in authorised attachment row and records the view. The
ordinary request creates a short-lived private download URL and redirects. `?inline=1` streams only
allowlisted image/PDF bytes with private no-store headers for the in-app reader; PDF.js renders those
bytes to canvas rather than delegating to the browser PDF plug-in. The route returns a neutral refusal
instead of schema or storage detail.

## Worker contracts

`claim_email_delivery` atomically claims weekly queued/failed work.
`claim_notification_email_delivery` atomically claims one transactional notification delivery and
recovers an abandoned claim after fifteen minutes. Successful Server Actions schedule prompt
notification delivery with `after()`; the scheduled cron route and `worker:notifications` command
drain remaining or retryable rows. The routine worker calls `generate_routine_occurrences` through
the service role. These operations remain local-only in this stage.

## v53 lifecycle contracts

- `cancel_task` deactivates terminal projections and enforces manager-only Mandatory cancellation.
- `reassign_task` retains state and returns `active_count`, `recommended_target`, and
  `workload_review_needed` rather than rejecting an over-target reassignment.
- `decide_major_project_proposal` accepts Agree, Request changes, or Decline;
  `resubmit_major_project_proposal` returns an owner revision to Pending.
- `submit_goal_monthly_session` and `complete_goal_quarterly_session` require one item per Active Goal
  in the employee/period and own their exactly-once aggregate header.
- `finalize_goal_plan` requires exactly 100% formal allocation.
- `revise_lean_goal_version` requires an Active-revision reason;
  `save_goal_candidate_version` remains for Draft/Discussion edits.
- `complete_goal` requires every success-measure actual result and a final summary. `cancel_goal`
  requires a reason. `close_goal` still exists in the database and maps to cancellation, but no
  action calls it: v53 §17 keeps the two endings apart, so there is no generic "close" in the
  product.
- `raise_goal_support_request`, `post_barrier_response`, and `resolve_barrier` reuse the shared
  request lifecycle for Goal support and preserve Response versus Resolution.
- Personal attention reads `action_requests_overview`, not `barriers`. The view resolves a request's
  subject — Task or Goal — in one query; reading the table and looking the subject up by `task_id`
  is what made a single Goal request blank every heading on the screen.
- The superseded v33 Goal authoring and per-Goal cadence procedures have no application caller. They
  are listed, with what replaced each one, in `docs/execution-goal-lifecycle-v52-impact-map.md`.

## ESH Finding Management through v203

- Staff mutations validate transport input, then call `esh_*` procedures as the signed-in user.
  Database procedures re-check the ESH preset, department scope, live version and workflow state.
- Guest Server Actions send a random session secret to `esh_guest_*` procedures through a
  server-only service client. The procedure resolves the secret hash and re-derives current owner
  or escalation scope on every read and write; a guest never receives an Auth session.
- `POST /respond/actions/[actionId]/reply` is the same-origin, no-JavaScript fallback for escalation
  reply and acknowledgement. It uses the guest cookie and the same procedures as the hydrated
  form. It cannot upload evidence or invoke owner/verification operations.
- `esh_run_followups(now)` is the daily scheduler contract. It records idempotent follow-up facts,
  coalesces missed escalation levels and queues mail. `esh_dispatch_claim` locks and revalidates the
  live assignment, deadline, workflow and entitlement before minting any link.
- `esh_set_followup_policy` and `esh_set_working_calendar` require Verifier authority. Policy edits
  apply only to future assignments; the working calendar is shared for review-reminder arithmetic.
- `POST /api/esh/delivery` accepts an authenticated provider-neutral delivery event and calls
  `esh_record_delivery_event`. Provider event IDs are idempotent; later bounces do not erase the
  earlier provider-accepted fact.
- `esh_overview(department, closed_since, closed_until, as_of)` returns the four signal units and
  department rows from one RLS-scoped statement. The application totals those rows; it does not
  repeat the definitions in TypeScript.
- `GET /findings/register/export` pages through `esh_register_export_rows` as the signed-in reader
  and returns a private, no-store CSV. It exports no evidence URL or access token and neutralizes
  spreadsheet-active user text.
- `set_person_module_access` changes the Focus preset and platform-administrator flag together with
  a required reason. Finding access remains in `esh_staff_access` and is changed independently.
- `esh_admin_contacts` returns identity and current participation counts without Finding content.
  Scoped titles use the security-invoker `esh_admin_contact_relationships` view.
- `esh_admin_resend_contact_access`, `esh_admin_revoke_contact_access`,
  `esh_admin_disable_contact` and `esh_admin_correct_contact_email` re-check live relationships,
  revoke stale capability, preserve history and write immutable audit detail.

## v227 One screen, one job

- **Corrections.** `editFinding(...)` → `esh_edit_finding` and `changeRisk(...)` →
  `esh_set_risk` apply to new and open findings in scope, audit before and after, and move
  nothing about the owner, the deadline or the follow-up.
- **Outcomes.** `esh_resolve_finding` accepts `cancelled`, `duplicate` and `raised_in_error`
  (recorded with status Cancelled). `withdrawn` is refused for new findings.
- **Who acts next.** `nextActor` returns Owner action, Changes requested, ESH verification or a
  settled state; `rowOverlays` adds Email failed, Overdue N days and Escalated Ln. Held email is
  no longer a per-row signal (the register shows v224's `esh_rollout_status` once); both register
  views carry `changes_requested`.
- Removed with their screens: the per-finding `releaseHeldNotification` and
  `enableContactForFinding` actions (v198/v212) and the owner bulk actions (v206). Held email is
  released with v224's `releaseHeldNotifications`. The database procedures behind v206 remain and
  keep their pgTAP coverage.

## v208 Priority changes

- `esh_set_priority(action, priority, reason)` is the authenticated coordinate command. It refuses
  a priority outside Urgent/High/Normal, a change without a reason, a change to what it already is,
  a finding outside the caller's scope and an action that is no longer open work.
- Its answer repeats the due date and says the follow-up is unchanged, so the screen can say so
  too; nothing in it restarts a reminder or an escalation clock.

## v215 Evidence at registration

- `saveFinding` returns `{ findingId, redirectTo }` instead of redirecting from the server. The
  browser needs the id: an evidence record belongs to a finding, so photographs chosen while
  describing the condition can only be attached once it exists.
- The form then runs the ordinary staff upload for each staged file — `esh_start_upload`, the
  signed PUT, `esh_finish_upload`, purpose `original` — and navigates when they are done. No new
  procedure, no new grant, and a file that fails to attach does not lose the finding.

## v214 Who acts next

- `nextActor(row, now, timeZone)` in `src/domain/esh-next-actor.ts` is the single rule. It takes
  the signals the register view already carries — status, action state, owner, due date, overdue,
  held and failed notifications — and returns a headline, a sentence and a tone. The register list
  and the finding header both read it, so a list and the record it links to cannot disagree.
- Ordering is deliberate: delivery failure, then a held assignment, then verification, then the
  owner's deadline. An undelivered assignment is not lateness.

## v213 Clearing several contacts

- `enableContacts(principalIds, reason)` is administrator-only and calls `esh_set_contact_access`
  once per contact, so each clearance is its own audited act with its own reason. A refusal is
  reported against that contact and the rest still proceed. Capped at fifty per press.
- It grants access and nothing else: notices raised while a contact was switched off stay
  `held_rollout` until their finding releases them (§43.4).

## v212 A different owner, and unblocking a held email

- `esh_guest_send_message` takes `p_proposed_owner_email`, canonicalised and kept only when it is
  a valid address. It creates no principal, issues no grant and does not touch the assignment: the
  work stays exactly where it was. Both reads return it, as they do the requested date.
- Granting it is `reassignAction` → `esh_reassign_action`, unchanged, with its reason, its new
  assignment interval, its audit entry and the old links revoked.
- `enableContactForFinding(principalId, findingId, reason)` is `esh_set_contact_access` called
  from the finding that is waiting on it. Administrator only, reason required, and it grants
  access alone — the held email still needs its separate release.

## v211 The owner's conversation

- `esh_guest_send_message` already accepted `p_proposed_due_date`; `sendOwnerUpdate` now passes it,
  so a single action's owner can ask for more time the same way a bulk operation could. It writes
  the date onto the message and changes nothing else — not the deadline, not the reminders.
- `esh_guest_action` returns `proposed_due_date` with each message, and ESH's own read selects the
  same column, so the ask is visible on both sides instead of being written and forgotten.
- Granting it is `changeDueDate` → `esh_change_due`, unchanged: coordinate authority, a reason, a
  recorded change and a notice to the owner. The button simply fills in the date that was asked
  for and a reason that says so.

## v210 Preview, the letter and the scheduler's own record

- `esh_preview_report(definition)` is authenticated report-management. It reads the configured
  scope against now and returns the recipients with their contact access, the departments, the four
  counts, the week it would report on, and `sends_nothing: true`. It writes nothing: no run, no
  outbox row, no grant. The Server Action is `previewReport`, and the Preview control sits beside
  Save report, so activation is still a deliberate second act.
- `focus.esh_report_letter(run, departments)` is service-role only and reads one captured run's
  snapshot rows: the department summary worst first, how many departments there were in total, and
  up to five overdue actions with their owners. `esh_report_dispatch_claim` appends it to the claim
  so the email carries exactly what the leadership page would show.
- `esh_record_worker_run(worker, ok, detail)` is service-role only and is called by the daily cron
  route after its workers have run, whatever the outcome. `esh_operational_health()` is the
  authenticated read behind the Overview's “Worth knowing” line; `scan_backlog` is null rather than
  zero, because this deployment has no scanner to be behind on.

## v209 Outcomes and policy rules

- `esh_resolve_finding(finding, outcome, reason, duplicate_of)` requires ESH verify authority and a
  reason, refuses a closed or already-resolved finding, insists a duplicate names what it repeats,
  cancels the finding's outstanding actions, revokes their guest grants and action sessions, and
  cancels anything still queued to send.
- `esh_set_followup_rule(...)` writes or removes a schedule for one risk level or priority;
  `esh_set_followup_quiet_hours(from, to, catch_up)` sets the quiet window and the catch-up rule.
  Both are ESH verify authority and both are audited.
- `focus.esh_followup_rule(action)` resolves the schedule for one action and is used when an
  ownership interval is stamped. `focus.esh_after_quiet_hours(org, at)` decides when a routine
  notice may go.

## v207 Consolidated notices

- `esh_build_digests(p_now)` is service-role only. It gathers queued `owner_reminder` and
  `escalation` events per recipient, purpose and local day into one delivery, moving each event to
  `digested`. A second run of the same day adds nothing, and it also attaches a released backlog's
  actions to its summary.
- `esh_digest_prepare(outbox_id)` lists the actions a delivery still intends to carry so the worker
  can mint one link per escalation member before claiming. It changes nothing.
- `esh_dispatch_claim` re-checks every member at the moment of sending — closed, reassigned,
  already answered, no longer escalated or rescheduled — drops what no longer applies, closes each
  dropped event in its own right, and refuses to send a delivery with nothing left in it.
- `esh_dispatch_complete` maps the delivery's outcome onto every member, so a failed summary is a
  recorded failure for each action it carried.

## v206 Bulk operations

- `esh_guest_bulk_update`, `esh_guest_bulk_extension` and `esh_guest_bulk_submit` each require an
  owner-inbox session: an action-only link cannot widen itself into batch scope. Every item goes
  through the same single-action routine the chat uses, with its own idempotency key.
- The answer is per item — Succeeded, Failed or Skipped with a reason — and the operation key makes
  a second press the same operation rather than a second one.
- `esh_guest_share_prepare` reserves a copy of one of the owner's own files against each chosen
  action and returns the object keys; the server copies them and `esh_guest_share_finish` makes the
  copies that arrived readable and records the rest as failures.
- `esh_guest_send_message` now also carries the proposed date and the operation a message belongs
  to, written at insert time.
- Server Actions `sendBulkUpdate`, `requestBulkExtension`, `submitBulkActions` and `shareEvidence`
  carry these to the guest inbox screen.

## v205 Backlog import

- `esh_import_start(...)` records an uploaded workbook and refuses a hash that a live batch already
  holds, naming that batch instead of creating a second one.
- `esh_import_stage(batch, rows)` replaces everything not yet released and returns the
  reconciliation: source rows, ignored, ready, blocked, duplicates and released. Outcomes are
  decided in the database, so the preview and the release are the same judgment.
- `esh_import_set_owner_email`, `esh_import_amend_row` and `esh_import_resolve_row` are the audited
  decisions; each revalidates the rows it affects. `esh_import_acknowledge_evidence` answers for a
  photograph or link that could not be imported.
- `esh_import_release(batch, rows, followup_from, key)` creates each finding through
  `esh_save_finding`, keeps the original due dates, sets when follow-up begins and queues one owner
  summary per recipient. It is idempotent by operation key and refuses a batch with an unready row
  or unresolved evidence.
- `esh_import_discard` is available only before anything is released; afterwards corrections are
  the ordinary audited operations.
- Server Actions read the workbook: `startImportUpload`, `readImportWorkbook`, `previewImportSheet`
  and `createImport` parse sheets, headers and dates server-side and never run a formula or fetch a
  URL found in the file.

## v204 Finding weekly reports

- `esh_save_report_definition(...)` is the authenticated report-management command. It validates
  schedule, timezone, scope and recipients, versions material changes, and revokes stale grants.
- `esh_generate_weekly_reports(p_now)` is service-role only and idempotent by definition, cycle and
  version. The daily cron calls it before the Finding mail drain.
- `esh_report_dispatch_claim` and `esh_report_dispatch_complete` mint a seven-day, single-use,
  individual report link only after rechecking the live definition, recipient and contact access.
- `esh_report_guest_exchange` creates a report-only guest session;
  `esh_guest_report(session, run, live)` revalidates all versions and returns either the saved
  snapshot or a current read under the same scope.
- `esh_report_request_link` supports neutral token/email recovery without revealing whether the
  address is subscribed. The corresponding Server Actions keep the purpose separate from owner
  recovery.
