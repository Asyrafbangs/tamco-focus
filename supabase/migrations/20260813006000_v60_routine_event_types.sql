-- ---------------------------------------------------------------------------
-- v60 — audit event types for managing a routine.
--
-- Its own migration because Postgres will not let a new enum value be added
-- and then used in the same transaction.
--
-- Only `routine_occurrence_generated` and `routine_finding_recorded` existed,
-- which is a trail of what a routine DID and nothing about how it came to
-- exist or who changed its schedule. A routine commits somebody's future
-- Mondays; changing it from weekly to quarterly is exactly the kind of
-- decision that should be answerable months later.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'routine_template_created';
alter type public.audit_event_type add value if not exists 'routine_template_updated';
alter type public.audit_event_type add value if not exists 'routine_template_activated';
alter type public.audit_event_type add value if not exists 'routine_template_paused';
