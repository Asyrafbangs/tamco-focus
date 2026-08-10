-- ---------------------------------------------------------------------------
-- v53 §22 — retire the Goal procedures nothing calls any more.
--
-- Application code stopped calling all of these when the lean authoring flow
-- (v51) and the employee-level session engine (v53 §11, §14, §17) replaced
-- them. Leaving them in place would not have been merely untidy: each is
-- `security definer` and granted to `authenticated`, so each was a second,
-- reachable way to write into the Goal engine — one that creates per-Goal
-- monthly records the session model cannot see, agrees versions outside the
-- lean flow, or ends a Goal without saying which kind of ending it was.
--
-- Two candidates were withdrawn after checking, because both are called from
-- SQL rather than from the application and are therefore alive:
-- `post_task_update_v34_internal` (called by `post_task_update`) and
-- `post_goal_milestone_update` (called by `post_goal_milestone_checkin`).
--
-- The integration suites that were the only remaining callers move onto the
-- replacements in the same change; nothing is dropped while a test still
-- depends on it.
-- ---------------------------------------------------------------------------

-- v33 authoring. Replaced by create_lean_goal / save_goal_candidate_version /
-- revise_lean_goal_version / agree_lean_goal_version.
drop function if exists public.create_goal_with_measures(
  uuid, text, date, integer, jsonb, text, text, text, text, text, text, jsonb, boolean, text);
drop function if exists public.create_goal(
  uuid, text, text, date, text, text, text, text, text, integer, text, jsonb, boolean, text);
drop function if exists public.create_goal_v33_internal(
  uuid, text, text, date, text, text, text, text, text, integer, text, jsonb, boolean, text);
drop function if exists public.propose_goal_version(
  uuid, integer, text, text, date, text, text, text, text, text, integer, jsonb, text);
drop function if exists public.agree_goal_version(uuid, uuid, integer, text);
drop function if exists public.agree_goal_version_v33_internal(uuid, uuid, integer, text);

-- The old overall-update path. Replaced by the monthly session and, for work
-- against a milestone, post_goal_milestone_checkin.
drop function if exists public.post_goal_update(
  uuid, integer, integer, text, text, boolean, text, jsonb, text);

-- Per-Goal cadence. Replaced by submit_goal_monthly_session,
-- complete_goal_quarterly_session and complete_goal.
drop function if exists public.post_goal_monthly_checkin(
  uuid, integer, public.goal_health, text, boolean, boolean, text, jsonb, jsonb, text);
drop function if exists public.save_goal_quarterly_checkin(
  uuid, integer, text, text, text, public.goal_health, boolean, text);
drop function if exists public.save_goal_year_end_result(uuid, integer, text, boolean, text);

-- One verb for two different endings. Replaced by complete_goal and cancel_goal,
-- which ask what each ending actually needs (§17).
drop function if exists public.close_goal(uuid, integer, text, text);
