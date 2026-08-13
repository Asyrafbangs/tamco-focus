-- ---------------------------------------------------------------------------
-- v57 — audit event types for the Bin.
--
-- Its own migration because Postgres will not let a new enum value be added
-- and then used inside the same transaction; `delete_task` and `restore_task`
-- in the next migration are what write them.
--
-- Kept separate from `task_cancelled` on purpose. Cancelling says the work was
-- real and will not be done, and carries a reason. Deleting says the task
-- should not have existed. Reading a trail later, "why did this stop?" and
-- "why was this never work?" are different questions, and one event type
-- cannot answer both.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'task_deleted';
alter type public.audit_event_type add value if not exists 'task_restored';
