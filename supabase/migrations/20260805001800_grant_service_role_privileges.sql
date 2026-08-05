-- ============================================================================
-- Fix: "permission denied for table tasks" for the service role
--
-- Cause
--   `service_role` carries BYPASSRLS, which exempts it from row-level policies
--   but grants no SQL privileges at all. Those are separate mechanisms. The
--   platform's blanket grants were issued before these tables existed, and
--   20260805001700 granted only to `authenticated`, so the server-side paths
--   that legitimately need to bypass RLS — user provisioning, the weekly email
--   worker, and test fixture arrangement — were refused.
--
-- Scope
--   Full DML, because that is the point of the role. It is never exposed to a
--   browser: `SUPABASE_SERVICE_ROLE_KEY` is read only from `server-only`
--   modules and is never prefixed NEXT_PUBLIC_.
--
--   The audit tables are the one exception. Their append-only triggers reject
--   UPDATE and DELETE for every caller including this one, so the privileges
--   are withheld here as well and the refusal happens at the permission gate
--   rather than inside a trigger.
-- ============================================================================

grant usage on schema public to service_role;

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;

-- History stays append-only for everyone.
revoke update, delete on public.audit_events from service_role;
revoke update, delete on public.admin_security_log from service_role;
