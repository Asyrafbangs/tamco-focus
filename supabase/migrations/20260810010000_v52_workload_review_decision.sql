-- ---------------------------------------------------------------------------
-- v52 — the workload review decision is recorded, not merely displayed.
--
-- "Keep current focus" told the manager their decision had been noted and then
-- did nothing at all: it set a message in the browser and returned. Refreshing
-- the page lost it. Nothing in the audit trail showed that anybody had looked
-- at the over-target condition, so the next person to open the panel could not
-- tell an accepted overload from one nobody had considered.
--
-- Accepting is a decision. It is the manager saying "this person carries more
-- than the target for now, and I know". That belongs in the record beside every
-- other decision the product asks somebody to make.
-- ---------------------------------------------------------------------------

alter type public.audit_event_type add value if not exists 'workload_review_accepted';
