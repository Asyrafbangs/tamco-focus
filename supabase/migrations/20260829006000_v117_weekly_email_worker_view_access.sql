-- TAMCO Focus v117 — let the trusted local summary worker read contribution views.
--
-- `shared_contributions` and `completed_contributions` join `team_directory` for
-- owner attribution. That security-invoker view calls this read-only predicate.
-- The worker uses the service-role client, which already has schema usage and
-- bypasses table RLS, but PostgreSQL still requires EXECUTE on a function used
-- by a view. Without this exact grant the weekly job fails before it can build
-- the merged Shared/Completed sections.
--
-- The function returns false when there is no authenticated user, so this does
-- not make team-directory rows visible to the worker or widen browser access.
-- It only lets the left join finish; contribution rows remain canonical and
-- owner attribution safely falls back to “Team member”.

grant execute on function focus.is_active_account() to service_role;
