# CLAUDE.md — TAMCO Focus Project Instructions

Read and follow these files before implementing:

- `MASTER_PRODUCT_SPEC.md`
- `PRODUCTION_LOGIC.md`
- `ONE_SHOT_LOCAL_BUILD_PROMPT.md`
- `CHANGE_INTAKE_PROTOCOL.md`
- `BUILD_ACCEPTANCE_GATES.md`
- current desktop/mobile prototypes

The product specification is expected to evolve. When newer approved Markdown or prototype files are added, re-run the change-intake process and update the implementation. Do not preserve an older interpretation merely because it existed when the project was first generated.

Build a complete local-first application, not a mock demonstration. Use real local Supabase Auth, Postgres, Storage, migrations, RLS, audit, tests, and seeded local-only fixtures. Do not deploy, link hosted Supabase, add a GitHub remote, or connect Vercel during the current stage.

Do not leave TODO, FIXME, placeholders, disabled critical tests, or duplicated business logic. Keep desktop/mobile parity, security, permissions, audit, tests, and documentation complete.

Before finishing, execute every gate in `BUILD_ACCEPTANCE_GATES.md` and report failures honestly.
