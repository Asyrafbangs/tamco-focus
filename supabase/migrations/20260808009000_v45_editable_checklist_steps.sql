-- ---------------------------------------------------------------------------
-- v45 Part B — audit vocabulary for editing and removing a checklist step.
--
-- Separate file, and nothing but enum values, for the same reason as the v44
-- one next to it: a new enum label cannot be *used* in the transaction that
-- adds it, and every migration file runs in one transaction. The functions
-- that emit these events live in the migration that follows.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'checklist_item_updated';
alter type public.audit_event_type add value if not exists 'checklist_item_removed';
