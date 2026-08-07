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

`GET /api/attachments/[id]` requires a signed-in authorised attachment row, records the view, creates a short-lived private URL, and redirects. It returns a neutral refusal instead of schema or storage detail.

## Worker contracts

`claim_email_delivery` atomically claims queued/failed work and recovers abandoned claims after fifteen minutes. The routine worker calls `generate_routine_occurrences` through the service role. Both commands are local-only in this stage.
