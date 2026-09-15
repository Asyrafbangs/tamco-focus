-- ============================================================================
-- TAMCO Focus v185 — Overdue, told: vocabulary
--
-- Isolated from the procedures that use these values, because PostgreSQL
-- requires a newly added enum value to be committed before anything uses it.
-- ============================================================================

-- The owner is told their work has passed its due date.
alter type public.notification_kind add value if not exists 'work_overdue';
-- A due date moved: the manager and the assigner when it was pushed back, the
-- owner when somebody else moved it.
alter type public.notification_kind add value if not exists 'due_date_changed';
