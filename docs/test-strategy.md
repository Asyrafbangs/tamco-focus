# Test strategy

## Layers

- Unit tests exercise pure classification, focus, prioritisation, duration, and weekly-window logic without services.
- SQL execution checks apply every migration and seed to an isolated PostgreSQL-compatible engine and exercise schema behaviour.
- pgTAP tests prove RLS and denial properties against local Postgres.
- Integration tests use real local Auth sessions, PostgREST, Storage, procedures, and service-role worker paths. They do not mock the database.
- Playwright runs the same application at desktop and mobile viewports. Critical journeys include Axe WCAG A/AA scans.
- The production build and generated-type comparison catch server/client boundary and schema drift.
- The production smoke test starts the compiled server and verifies sign-in, security headers, and protected-route redirects against the built output.

## Critical properties

The suite prioritises denial and invariants: anonymous access, view without edit, deactivated sessions, append-only audit, private attachments, stale-version conflict, idempotency, evidence-required completion, guarded deletion, audited settings, effective visibility, worker duplicate prevention, and routine-generation idempotency. Goals add reported-versus-derived progress separation, five-percent steps, manager-only setup/agreement, pending-version isolation, milestone-completion semantics, support notifications, Goal evidence privacy, and linked-work independence.

## Commands

```text
npm run check:sql
npm run check:schema
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run db:reset
npm run db:types:check
npm run db:test
npm run test:integration
npm run test:e2e
npm run build
npm run test:smoke
npm run verify
```

`verify` is the release gate. A database-dependent skip is not a pass; the command exits non-zero when Docker is unavailable. Tests are serial where they share retained seed history, and browser retries are disabled locally so flakiness is visible.

## Fixture policy

Seed users and records are explicit local fixtures. Integration setup resets the database once because audit retention correctly prevents ad-hoc cleanup of historical records. Test identities, passwords, and content must never be copied to a hosted environment.

The canonical v33 fixture is Safety Digitalisation with five milestones and deliberately divergent progress (20% reported, 19% derived). A second coaching Goal exercises manager summaries. `npm run db:seed:goals` is an idempotent, non-destructive local backfill for databases seeded before v33; it does not replace the canonical reset-and-seed gate.
