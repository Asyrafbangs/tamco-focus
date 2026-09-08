-- ---------------------------------------------------------------------------
-- v145 — the audit event for recording why a piece of work exists.
--
-- Its own migration because Postgres will not let a new enum value be added
-- and then used inside the same transaction; `set_work_purpose` in the next
-- migration is what writes it.
--
-- Separate from `task_updated` deliberately. Purpose is a classification
-- somebody chose, and §11 asks for unresolved classification to be flagged for
-- review — which means being able to answer "who decided this was Reactive
-- work, and when" without reading a generic edit event and guessing which
-- field it touched.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'work_purpose_set';
