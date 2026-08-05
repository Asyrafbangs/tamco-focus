-- ============================================================================
-- Fix: infinite recursion in the user_profiles SELECT policy
--
-- Symptom
--   Every authenticated read of `user_profiles` failed with
--   "infinite recursion detected in policy for relation user_profiles",
--   which made sign-in appear to succeed and then render a blank page.
--
-- Cause
--   `user_profiles_select` (20260805000900_rls_policies.sql) contained a raw
--   subquery reading `user_profiles` to find the caller's own manager:
--
--       or id = (select p.reporting_manager_id
--                  from public.user_profiles p
--                 where p.id = focus.current_user_id())
--
--   A subquery inside a policy is itself subject to that table's policies, so
--   evaluating the policy required evaluating the policy. The other branches
--   were safe only because they go through SECURITY DEFINER helpers in the
--   `focus` schema, which read the table without re-entering RLS.
--
-- Fix
--   Move the lookup into a SECURITY DEFINER helper, matching how every other
--   branch of this policy already works.
--
-- Why a new migration rather than an edit
--   The original migration has been applied. CHANGE_INTAKE_PROTOCOL.md requires
--   forward-only migrations and forbids editing applied history to hide a
--   change, so the correction is recorded here where it can be read.
--
-- Note for the RLS test suite
--   This defect was invisible to `scripts/check-schema.mjs`, which executes the
--   schema as a superuser and therefore never evaluates a policy. Only a real
--   authenticated session catches it. That is precisely the gap the pending
--   `supabase test db` suite has to close.
-- ============================================================================

create or replace function focus.current_manager_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.reporting_manager_id
    from public.user_profiles p
   where p.id = auth.uid();
$$;

revoke all on function focus.current_manager_id() from public, anon, authenticated;

drop policy if exists user_profiles_select on public.user_profiles;

create policy user_profiles_select on public.user_profiles
  for select to authenticated
  using (
    focus.is_active_account()
    and (
         id = focus.current_user_id()
      or focus.can_view_user(id)
      -- Your own manager stays visible so the interface can name who to ask
      -- for support. Resolved through a SECURITY DEFINER helper, so evaluating
      -- this policy never re-enters it.
      or id = focus.current_manager_id()
    )
  );
