-- ============================================================================
-- TAMCO Focus v184 — Ask for an update: vocabulary
--
-- Isolated from the procedures that use these values, because PostgreSQL
-- requires a newly added enum value to be committed before anything uses it.
-- ============================================================================

-- The owner is asked for an update, and the person who asked is told it came.
alter type public.notification_kind add value if not exists 'update_requested';
alter type public.notification_kind add value if not exists 'update_request_answered';

-- Asking is recorded on the work, like every other act on it.
alter type public.audit_event_type add value if not exists 'update_requested';
