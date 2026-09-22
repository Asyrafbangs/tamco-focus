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
