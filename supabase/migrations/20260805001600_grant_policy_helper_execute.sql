-- ============================================================================
-- Fix: "permission denied for function current_user_id"
--
-- Symptom
--   Every authenticated read failed once the recursion fix landed, because the
--   policies could no longer evaluate at all.
--
-- Cause
--   20260805000800_rls_helpers.sql ended with a blanket
--       revoke all on all functions in schema focus from public, anon, authenticated;
--   on the assumption that a policy expression runs with the privileges of the
--   policy rather than the caller. That is wrong. A USING clause is evaluated as
--   the CALLING role, so `authenticated` needs EXECUTE on every function the
--   policy mentions. The same applies to the `security_invoker` views.
--
-- Fix
--   Grant EXECUTE on exactly the read-only predicate helpers that policies and
--   views reference — and nothing else.
--
-- What is deliberately NOT granted
--   The transactional internals: write_audit, notify, refresh_over_target,
--   remember_operation, replay_operation, task_snapshot, and the trigger
--   functions. Those are SECURITY DEFINER and mutate state; a caller able to
--   invoke `focus.write_audit` directly could forge audit history. They are
--   reached only from inside the `public.*` procedures, which run as their owner
--   and so do not need the caller to hold EXECUTE.
--
--   Helpers called only from within other SECURITY DEFINER functions
--   (reporting_tree, setting, try_uuid) are likewise omitted: the calling
--   function already supplies owner privileges.
--
-- Exposure note
--   The `focus` schema is absent from `api.schemas` in config.toml, so none of
--   these are reachable over PostgREST regardless of this grant. They are
--   callable only during in-database policy evaluation.
-- ============================================================================

grant usage on schema focus to authenticated;

-- Identity and authority predicates.
grant execute on function focus.current_user_id() to authenticated;
grant execute on function focus.is_active_account() to authenticated;
grant execute on function focus.current_role_name() to authenticated;
grant execute on function focus.is_admin() to authenticated;
grant execute on function focus.is_manager_or_admin() to authenticated;
grant execute on function focus.is_manager_of(uuid) to authenticated;
grant execute on function focus.current_manager_id() to authenticated;

-- Effective visibility.
grant execute on function focus.visible_user_ids() to authenticated;
grant execute on function focus.can_view_user(uuid) to authenticated;

-- Task-level authorisation.
grant execute on function focus.can_view_task(uuid) to authenticated;
grant execute on function focus.can_edit_task(uuid) to authenticated;
grant execute on function focus.can_contribute_to_task(uuid) to authenticated;
grant execute on function focus.can_review_task(uuid) to authenticated;

-- Storage object authorisation.
grant execute on function focus.storage_object_task_id(text) to authenticated;
grant execute on function focus.owns_capture_object(text) to authenticated;

-- Referenced directly by the security_invoker views.
grant execute on function focus.active_focus_count(uuid, public.focus_bucket) to authenticated;
grant execute on function focus.effective_focus_target(uuid, public.focus_bucket) to authenticated;
grant execute on function focus.stale_threshold_days() to authenticated;
