-- ---------------------------------------------------------------------------
-- v62c — audit events for removing and restoring a routine.
--
-- Separate file for the same reason as the frequency label: a new enum value
-- cannot be used in the transaction that adds it, and v62d writes both.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'routine_template_deleted';
alter type public.audit_event_type add value if not exists 'routine_template_restored';
