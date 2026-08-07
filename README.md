# TAMCO Focus v35 — Local-First Application

## Purpose

This repository contains the complete local-first TAMCO Focus application and its approved product/build specifications. The current stage runs entirely on the local computer. GitHub, hosted Supabase, and Vercel connections are intentionally deferred.

## Authoritative reading order

1. `MASTER_PRODUCT_SPEC.md`
2. `PRODUCTION_LOGIC.md`
3. `ONE_SHOT_LOCAL_BUILD_PROMPT.md`
4. `CHANGE_INTAKE_PROTOCOL.md`
5. `BUILD_ACCEPTANCE_GATES.md`
6. Latest desktop and mobile prototypes

Desktop and mobile visual references live at `desktop/index.html` and `mobile/index.html`; `index.html` selects between them.

## Implementation

- Next.js App Router with strict TypeScript
- local Supabase Postgres, Auth, Storage, migrations, and RLS
- complete work, routine, collaboration, Goal, review, record, settings, identity, and visibility workflows
- dedicated My Goals and Team Goals workspaces with versioned agreement, actionable milestones, private evidence, support, and meaningful weekly-summary integration
- task Next actions with inline editing, checklist completion, atomic progress-update refresh, immutable audit history, and accessible task-age guidance
- local routine and weekly-summary workers
- unit, SQL, pgTAP/RLS, real-stack integration, desktop/mobile E2E, and accessibility gates

## v35 review focus

Open an Active task and review the Next action card, inline Set/Edit and Mark done controls, the task-age information control, separate **What changed?** and **What happens next?** update fields, and the current Next action in Checklist.

## Run locally

1. Install dependencies with `npm.cmd install`.
2. Start Docker Desktop and run `npm.cmd run supabase:start`.
3. Run `powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1`.
4. Run `npm.cmd run db:reset` and `npm.cmd run dev`.
5. Open `http://localhost:3000/sign-in`.

Use `npm.cmd run worker:tick` for the local routine and weekly-summary jobs. See `docs/local-operations.md` for operations and `docs/test-strategy.md` for the complete verification gate.

## Local fixtures

Reproducible seed users and test records are explicitly local-only. They are required for development and automated verification and must never be treated as production data or copied to a hosted environment.

## Future changes

Product requirements may supersede the initial prompt. Inventory newer approved Markdown and prototypes, then follow `CHANGE_INTAKE_PROTOCOL.md`. Do not connect external services or deploy until separately authorised.
