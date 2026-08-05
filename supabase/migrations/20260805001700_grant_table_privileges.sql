-- ============================================================================
-- Fix: "permission denied for table user_profiles"
--
-- Cause
--   Row-Level Security and SQL privileges are two independent gates, and a
--   request has to clear both. The policies decide WHICH ROWS a caller may
--   touch; the GRANT decides whether the caller may touch the table at all.
--   This schema defined the policies and never issued the grants, so every
--   authenticated request was refused before any policy was consulted.
--
-- Fix
--   Grant table privileges to `authenticated` and let RLS do the filtering,
--   which is the model Supabase is built around.
--
-- Why granting DELETE broadly is still safe
--   A privilege without a matching policy grants nothing. Most tables here have
--   no DELETE policy on purpose — archive is not deletion
--   (MASTER_PRODUCT_SPEC.md section 21.4) and records are retained (21.3) — so
--   a DELETE on those is refused by RLS even though the privilege exists. The
--   handful that do allow it (checklist items, collaborators, relations,
--   capture drafts, visibility grants) are the ones with an explicit policy.
--
-- `anon` remains with nothing, re-asserted at the end: there is no
-- unauthenticated surface anywhere in this application.
-- ============================================================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Applies to anything a later migration adds, so this class of failure cannot
-- silently return.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- The audit trail is readable but never writable through the API. Its
-- append-only trigger already rejects UPDATE and DELETE; removing the privilege
-- as well means the attempt fails at the permission gate rather than deep
-- inside a trigger.
revoke insert, update, delete on public.audit_events from authenticated;
revoke insert, update, delete on public.admin_security_log from authenticated;

-- The operation log is written by the SECURITY DEFINER procedures alone; a
-- caller forging an entry could suppress a genuine action by pre-claiming its
-- idempotency key.
revoke insert, update, delete on public.operation_log from authenticated;

-- Email delivery records are produced by the worker.
revoke insert, update, delete on public.email_deliveries from authenticated;

-- Notifications are raised by the procedures. A recipient may mark their own
-- read, which is what the UPDATE privilege plus `notifications_update_own`
-- allows; nobody may create or remove one.
revoke insert, delete on public.notifications from authenticated;

-- Re-assert the default-deny position for unauthenticated callers.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;
