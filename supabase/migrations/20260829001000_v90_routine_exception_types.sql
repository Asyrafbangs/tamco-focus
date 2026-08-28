-- ---------------------------------------------------------------------------
-- v90 - the vocabulary for "not required this time".
--
-- Separate file because a new enum value cannot be used in the transaction
-- that adds it, and v91 writes procedures that use all of these.
-- ---------------------------------------------------------------------------

create type public.routine_exception_reason as enum (
  'no_applicable_work',
  'activity_cancelled',
  'other'
);

create type public.routine_exception_state as enum (
  'pending',
  'accepted',
  'returned'
);

alter type public.audit_event_type add value if not exists 'routine_not_required_raised';
alter type public.audit_event_type add value if not exists 'routine_not_required_accepted';
alter type public.audit_event_type add value if not exists 'routine_not_required_returned';
