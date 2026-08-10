# CLAUDE.md — TAMCO Focus Project Instructions

Read and follow these files before implementing:

- `MASTER_PRODUCT_SPEC.md`
- `PRODUCTION_LOGIC.md`
- `ONE_SHOT_LOCAL_BUILD_PROMPT.md`
- `CHANGE_INTAKE_PROTOCOL.md`
- `BUILD_ACCEPTANCE_GATES.md`
- current desktop/mobile prototypes

The product specification is expected to evolve. When newer approved Markdown or prototype files are added, re-run the change-intake process and update the implementation. Do not preserve an older interpretation merely because it existed when the project was first generated.

Build a complete local-first application, not a mock demonstration. Use real local Supabase Auth, Postgres, Storage, migrations, RLS, audit, tests, and seeded local-only fixtures.

The local-build stage has ended. The cloud migration approved on 11 August 2026 supersedes the previous prohibition on deploying, linking hosted Supabase, adding a GitHub remote and connecting Vercel; those are now the work, subject to the approval gates in `MIGRATION_STATUS.md` and `DEPLOYMENT.md`. Local development continues unchanged and remains where fixtures, stress testing and experimentation belong — Production holds real operational data only.

Do not leave TODO, FIXME, placeholders, disabled critical tests, or duplicated business logic. Keep desktop/mobile parity, security, permissions, audit, tests, and documentation complete.

Before finishing, execute every gate in `BUILD_ACCEPTANCE_GATES.md` and report failures honestly.
