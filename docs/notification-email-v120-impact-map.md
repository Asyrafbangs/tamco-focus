# v120 notification email impact map

## Requirement change

Every application notification now also produces a notification email. This
includes ordinary work assignment, reassignment, checklist contribution
assignment/readiness, barriers, completion review, Goal handoffs, Routine
decisions, and every other event already represented by a `notifications` row.

## Previous behaviour

- The notification bell showed targeted notification rows.
- Weekly email used a separate period-based delivery queue.
- Immediate notification email had no durable outbox or worker.

## New behaviour

- An `AFTER INSERT` trigger creates exactly one notification-email outbox row in
  the same transaction as each notification.
- The worker renders escaped HTML and matching plain text, claims atomically,
  retries transient failures, and retains delivery status.
- Successful server mutations schedule prompt delivery after the response.
- The authorised scheduled endpoint drains anything left queued or retryable.
- Personal Delivery history combines weekly and notification email outcomes.

## Impact

- **UI:** My Alerts explains that each recorded alert is also emailed. Delivery
  history labels both notification and weekly messages.
- **Desktop/mobile prototypes:** add the minimalist notification email preview.
- **Domain/state:** notification meaning and actionability do not change.
- **Data model:** adds `notification_email_deliveries`; no existing row is
  transformed or backfilled, avoiding an unexpected historic-email flood.
- **Permissions/RLS:** recipients may read only their own delivery outcomes;
  only `service_role` may claim or mutate the outbox.
- **Audit:** the immutable notification remains the business record; delivery
  outcome and failure reason are retained in the outbox.
- **Tests:** renderer escaping/link safety, queue idempotency, claim/retry,
  assignment/checklist coverage, RLS, settings history, local SMTP capture,
  production build, and responsive visual checks.

## Compatibility and rollback

The migration is forward-only and additive. Disabling the trigger stops new
queue creation without changing notifications. Delivery history follows its
authoritative notification if an authorised cascade removes that parent;
removing the outbox table itself would require an explicit future migration.
