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

## Operational jobs

`worker:routines` calls the idempotent occurrence-generation procedure through the local service role. `worker:weekly` calculates the reporting window, renders summaries from canonical records, inserts the unique period delivery, claims it atomically, and records delivery or bounded retry state. `worker:tick` runs both and is suitable for a local scheduler.
