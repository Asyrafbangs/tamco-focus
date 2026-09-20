# TAMCO Focus architecture

## Shape

TAMCO Focus is a local-first Next.js 16 App Router application backed by the local Supabase stack. Server Components perform reads with the signed-in request client. Client Components own interaction state only. Server Actions perform UI mutations, and route handlers are reserved for HTTP-shaped behaviour such as authorised attachment downloads.

Postgres is the authority for permissions and workflow transitions. The browser never decides whether a user may see, edit, activate, reassign, review, or delete a record. Those decisions are expressed once through RLS helpers and transactional SQL procedures.

## Boundaries

- `src/app/` — routes and responsive presentation.
- `src/components/` — shared interface components.
- `src/domain/` — deterministic classification, focus, prioritisation, duration, and scheduling rules.
- `src/server/queries.ts` — signed-in, RLS-filtered read models.
- `src/server/actions/` — validated mutation adapters over database procedures.
- `src/server/workers/` — service-role operational jobs that cannot run as one user.
- `supabase/migrations/` — authoritative schema, constraints, RLS, views, and transactions.
- `tests/` — pure unit, real-stack integration, pgTAP/RLS, and browser journeys.

## Trust model

The anon key is safe to expose because it has no useful access without a valid session and RLS. The service-role key exists only in `.env.local`, is imported only by server paths, and is limited to local user administration and workers. Private files remain in the `task-attachments` bucket and are exchanged for short-lived signed URLs only after the attachment row passes RLS.

## Request flow

1. Middleware refreshes the local Supabase session.
2. The authenticated layout loads the active application profile.
3. Server reads run as that user; RLS filters the result.
4. A mutation validates its transport shape and calls one SQL procedure.
5. The procedure locks relevant rows, rechecks authority, applies the change, writes audit/notifications, and returns a stable result code.
6. The action revalidates affected routes.

Team read models add one deliberate distinction: `user_profiles_select` may expose a reporting
manager for attribution, while Team projections require `focus.can_view_user` for workload access.
`team_load_summary` and `focus_summary` aggregate canonical rows set-wise. Repeated roster/focus/
attention calls made by one Server Component render share request-scoped `React.cache` results;
nothing is cached across users or requests. Team task queries select only the columns their list or
drawer renders.

## Operational jobs

`worker:routines` calls the idempotent occurrence-generation procedure through the local service
role. `worker:weekly` calculates the reporting window, renders summaries from canonical records,
inserts the unique period delivery, claims it atomically, and records delivery or bounded retry
state. `worker:notifications` drains the transactional notification-email outbox. Successful Server
Actions also schedule that drain after their response; the authenticated cron endpoint is the
durable retry path. `worker:tick` runs all three and is suitable for a local scheduler.

Every new notification creates its unique delivery row in PostgreSQL before commit. The worker—not
the client—renders and transports it. This keeps alert rules, recipient selection, and the business
mutation in one authority while isolating a mail outage from the already-committed user action.

## Execution and Goal boundaries

Tasks are the single shared execution engine. Native work has no source link; a future specialist
module may populate the generic source triple while continuing to use the same Task lifecycle. A
terminal Task deactivates its actionable projections but never deletes its Barrier, notification,
meeting or audit history. Shared work is a view over checklist assignment, not a second Task.

Goals are performance agreements, not Tasks. A performance period contains one employee plan; one
monthly or quarterly session header owns the per-Goal snapshots for that employee and period. Goal
support deliberately enters the existing Barrier/request engine. Completion and cancellation remain
separate terminal transactions.

## ESH Finding Management boundary

Finding Management is a separate application module in this repository. Signed-in staff keep their
Supabase Auth identity, but ESH presets and department scope—not Focus role or reporting line—grant
its authority. External Action Owners and escalation recipients are email principals, never shadow
Auth users. They reach only server-side guest procedures through random, hashed, expiring grants and
sessions; no ESH guest table is exposed to `anon` or `authenticated`.

The database owns every finding/action transition, policy snapshot, entitlement and notification
recipient. The daily cron records idempotent follow-up events before queueing mail. The outbox worker
then locks the row and re-checks the live assignment, deadline, submission and entitlement before it
mints any one-time link. Provider callbacks append delivery evidence; they do not overwrite the
business event that originally queued the mail.

Overview and Register preserve the unit being counted. `esh_overview` reads the caller's RLS-scoped
findings, actions and current submissions in one statement and returns one row per accountable
department; signal totals are sums of those rows. Finding filters use `esh_register_rows`, while
action filters use `esh_action_register_rows`. The CSV route reads a separate security-invoker
projection as the signed-in caller and serializes it server-side, so export never requires widening
RLS or making evidence links portable.
