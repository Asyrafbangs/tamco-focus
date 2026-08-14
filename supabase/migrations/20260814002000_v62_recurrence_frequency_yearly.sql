-- ---------------------------------------------------------------------------
-- v62a — 'yearly' becomes a real frequency.
--
-- It was being stored as monthly with an interval of 12, which is arithmetic
-- rather than meaning. The consequence was visible in the Routines list: a
-- Safety Walk set to run yearly read "Yearly on the 5th" — the 5th of no
-- particular month — and its first occurrence landed in August 2027, because
-- the monthly rule advanced twelve months from the current month before
-- applying the day. Nobody asked for a routine that first happens in a year.
--
-- Alone in its own migration because Postgres will not let a new enum label be
-- used in the transaction that adds it. Everything that reads it is in v62b.
-- ---------------------------------------------------------------------------

alter type public.recurrence_frequency add value if not exists 'yearly';
