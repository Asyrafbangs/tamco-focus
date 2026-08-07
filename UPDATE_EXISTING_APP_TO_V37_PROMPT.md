# TAMCO Focus — Incremental Update to v37

Use this only to update an existing implementation to the synchronized v37 reference.

## Mission

Inspect the current repository and update only the affected frontend surfaces needed to match the supplied v37 reference files. Do **not** rebuild the application or replace existing production data and business logic.

## Authoritative inputs

1. `MASTER_PRODUCT_SPEC.md`
2. `PRODUCTION_LOGIC.md`
3. `desktop/index.html`
4. `mobile/index.html`
5. `BUILD_ACCEPTANCE_GATES.md`

The prototype files are the visual/interaction contract. Preserve their example relationships as reference behaviour, but continue using the application's real data sources.

## Required update

- Keep Goals as a dedicated primary workspace separate from Calendar.
- Preserve the v34 Active / For discussion / Completed / All goal model and formal weighting rules.
- Preserve the v36 Next action pattern and task-age information control.
- Preserve the v36 Team Focus exception-first manager list and member-detail drawer.
- Match wording, hierarchy, click targets, drawers, filters, sorting, responsive behaviour, day/night theme and progressive disclosure shown in the supplied prototype.

## Strict boundaries

Do not change unless required by an explicit requirement in the authoritative Markdown files:

- database schema or migrations
- RLS or permissions
- authentication
- APIs/server actions
- task state machine
- focus-target logic
- goal calculation logic
- notification logic
- audit behaviour
- storage behaviour
- real production data

## Efficient execution

1. Inspect only affected routes/components/tests first.
2. Reuse existing services and data contracts.
3. Make the smallest cohesive change set.
4. Run targeted tests, type check, lint and production build.
5. Update documentation only where implementation differs.
6. Create one focused local Git commit. Do not push.

## Final response

Keep it short: changes completed, files changed, validation, commit hash, unresolved blockers only.
