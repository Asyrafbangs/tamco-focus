-- ---------------------------------------------------------------------------
-- v47 — vocabulary for queueing and scheduling a discussion.
--
-- Enum values only, in their own migration: a new label cannot be used in the
-- transaction that adds it, and every migration file runs in one.
-- ---------------------------------------------------------------------------

-- §18 — "queued" and "scheduled" are different facts. A manager often knows a
-- topic needs discussing well before knowing when, and collapsing the two would
-- force them to invent a date to record the need.
alter type public.meeting_item_status add value if not exists 'queued';
alter type public.meeting_item_status add value if not exists 'scheduled';
alter type public.meeting_item_status add value if not exists 'removed';

alter type public.audit_event_type add value if not exists 'meeting_queue_item_removed';
alter type public.audit_event_type add value if not exists 'discussion_scheduled';
alter type public.audit_event_type add value if not exists 'discussion_rescheduled';
alter type public.audit_event_type add value if not exists 'discussion_cancelled';
