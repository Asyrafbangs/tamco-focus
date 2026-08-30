-- v123 — a delivery that will never succeed stops asking.
--
-- `failed` means "try again later", and the retry ladder backs off to a day
-- and gives up after ten attempts. That is right for a relay that was busy,
-- and wrong for an address that cannot receive mail at all: `izzul@tamco.local`
-- is not going to start resolving, so nine further attempts only add noise and
-- delay the moment somebody looks at the real problem.
--
-- `undeliverable` is terminal. Neither `claim_email_delivery` nor
-- `claim_notification_email_delivery` will pick it up again — both claim only
-- `queued`, retryable `failed`, or abandoned `processing` rows — so adding the
-- value is all that is required to stop the retries.
--
-- Kept in its own migration because PostgreSQL will not let a newly added enum
-- value be used in the transaction that adds it. The same split was needed for
-- `processing` in 20260805002200.

alter type public.email_delivery_status add value 'undeliverable' after 'failed';
