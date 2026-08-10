-- ---------------------------------------------------------------------------
-- v44 — audit event types for checklist collaboration.
--
-- A separate migration because Postgres will not let a new enum value be added
-- and then used inside the same transaction. The triggers that write these
-- events live in the next migration.
--
-- Assignment has to be its own event rather than being folded into
-- `task_reassigned`: reassigning a checklist contribution does not change who
-- is accountable for the result, and an audit trail that conflates the two
-- would suggest ownership moved when it did not (v44 section 41).
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'checklist_item_assigned';
alter type public.audit_event_type add value if not exists 'checklist_item_ready';
alter type public.audit_event_type add value if not exists 'barrier_response_posted';
