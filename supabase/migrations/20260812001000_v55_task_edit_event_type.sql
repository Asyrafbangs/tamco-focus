-- ---------------------------------------------------------------------------
-- v55 — audit event type for editing task content.
--
-- Its own migration because Postgres will not let a new enum value be added
-- and then used inside the same transaction; `update_task_details` in the next
-- migration is what writes it.
--
-- Separate from `task_reassigned` and from `task_due_date_changed` on purpose.
-- Correcting a title is not a change of accountability and not a change of
-- commitment, and an audit trail that folded all three together would make it
-- impossible to answer "who moved this deadline?" later.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'task_details_edited';
