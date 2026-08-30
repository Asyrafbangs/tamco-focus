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
