-- ---------------------------------------------------------------------------
-- v147 — a skip request can be taken back.
--
-- Its own migration because Postgres will not let a new enum value be added
-- and then used inside the same transaction; the procedures in the next
-- migration are what write them.
--
-- §15's implementation default: while a skip request is pending the employee
-- can withdraw it and complete the work through the normal flow. Three states
-- could not express that. `returned` is a manager's decision and carries their
-- explanation; using it for a retraction would put words in their mouth and
-- show a decision on their history they never made.
-- ---------------------------------------------------------------------------

alter type public.routine_exception_state add value if not exists 'withdrawn';

alter type public.audit_event_type add value if not exists 'routine_not_required_withdrawn';
