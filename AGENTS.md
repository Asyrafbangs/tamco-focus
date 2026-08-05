# AGENTS.md — TAMCO Focus Repository Instructions

## Mandatory reading order

Before making changes, read:

1. `MASTER_PRODUCT_SPEC.md`
2. `PRODUCTION_LOGIC.md`
3. `ONE_SHOT_LOCAL_BUILD_PROMPT.md`
4. `CHANGE_INTAKE_PROTOCOL.md`
5. `BUILD_ACCEPTANCE_GATES.md`
6. latest desktop and mobile prototypes

## Source of truth

Product requirements may be updated after the initial build. Always inventory the repository for newer approved `.md` and prototype files. Do not treat the original prompt as frozen product requirements.

## Engineering standard

- Complete implementation; no demo-only substitutes.
- No TODO/FIXME/placeholders.
- Strict TypeScript and maintainable domain modules.
- SQL migrations and RLS are authoritative.
- Do not duplicate permission or state-transition logic in clients.
- Update tests and docs with every change.
- Run the full verification gates before completion.

## Local-only stage

- Use local Supabase.
- Do not link hosted Supabase.
- Do not deploy to Vercel.
- Do not add or push a GitHub remote.
- Never commit secrets.

## Change intake

For newer product files, follow `CHANGE_INTAKE_PROTOCOL.md`: diff, impact-map, implement, migrate, test, document, and preserve unrelated approved behaviour.

## Required final checks

Run all commands defined by the repository for lint, formatting, typecheck, unit, integration, RLS, E2E, accessibility, database reset, generated types, production build, and smoke tests. Do not claim completion when a gate fails.
