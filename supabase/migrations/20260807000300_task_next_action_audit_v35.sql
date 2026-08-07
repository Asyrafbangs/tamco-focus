-- v35: immutable event vocabulary for the task Next action lifecycle.
-- Kept separate because PostgreSQL enum values must commit before later
-- migrations can use them in functions.

alter type public.audit_event_type add value if not exists 'next_action_changed';
alter type public.audit_event_type add value if not exists 'next_action_completed';
