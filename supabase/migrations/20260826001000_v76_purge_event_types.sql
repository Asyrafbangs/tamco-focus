-- ---------------------------------------------------------------------------
-- v76a — audit events for emptying something out of the Bin for good.
--
-- Its own file because a new enum label cannot be used in the transaction that
-- adds it, and v76b writes both.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'task_purged';
alter type public.audit_event_type add value if not exists 'routine_template_purged';
