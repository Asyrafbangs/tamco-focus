# TAMCO Focus — Change Log

## v30 — 5 August 2026

- Added administrator-only user creation and account management.
- Added required name, unique employee ID, unique email, department, role, reporting manager, status, and weekly-summary preferences.
- Added deactivation/reactivation while preserving retained work and audit history.
- Added guarded permanent deletion for accounts without retained history, confirmed by employee ID.
- Added weekly personal email-summary preview generated from recorded task activity.
- Added manager team-change summary covering completions, progress/state changes, new barriers, newly overdue work, stale updates, and decisions required.
- Added compact Open, current-state, overdue, and stale duration indicators across My Day, Work, Team Load, routine lists, and task detail.
- Updated Master Product Specification, Production Logic, build acceptance gates, build prompt, README, desktop prototype, mobile prototype, and selector index.

## v28 — 5 August 2026

- Added a one-shot local production implementation prompt incorporating the Product Owner's complete-engineering quality standard.
- Selected a local-first Next.js and Supabase implementation baseline.
- Deferred GitHub remote, hosted Supabase, and Vercel connections to later approved stages.
- Added `AGENTS.md` and `CLAUDE.md` for repository-level coding-agent instructions.
- Added a flexible `CHANGE_INTAKE_PROTOCOL.md` so future updated Markdown and prototype files can supersede the initial build inputs.
- Added objective `BUILD_ACCEPTANCE_GATES.md`.
- Added local setup and future GitHub/Supabase/Vercel connection guidance.
- Updated Master Product Specification and Production Logic without changing current prototype behaviour.

## v27 — 5 August 2026

- Added `MASTER_PRODUCT_SPEC.md` as the authoritative product source of truth.
- Consolidated all latest approved workflow and UI/UX requirements from the prototype-design conversation.
- Updated document hierarchy and maintenance rules.
- Updated `PRODUCTION_LOGIC.md` to require synchronized Master Product Specification updates.
- Retained v26 user-facing prototype behaviour.
