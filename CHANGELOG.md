# TAMCO Focus — Change Log

## v35 Next-action clarity — 7 August 2026

- Renamed **Do Next** to **Next action** and replaced generic fallback wording with **No next action recorded**.
- Added inline Set/Edit and Mark done controls, plus a virtual actionable Checklist row for the current action.
- Split task progress posting into **What changed?** and **What happens next?**, with atomic Next-action persistence through the existing update transaction.
- Added immutable Next-action change/completion events, edit-authority enforcement, stale-timer refresh, accessible task-age guidance, and focused desktop/mobile tests.
- Preserved Goal v34 and all unrelated task states, permissions, attachment rules, notifications, capacity rules, and workflows.

## v34 Goal workspace focus — 7 August 2026

- Added Active, For discussion, Completed, and All lifecycle views consistently across My Goals and Team Goals, including closed-history visibility and filter-preserving drawer links.
- Made milestone-derived progress the single current Goal value and limited formal allocation/weighted progress to Active Goals.
- Added the 100% formal-weight activation/agreement guard with unchanged public Goal operation signatures; discussion saves remain available.
- Rebuilt milestone check-ins as a desktop right drawer/mobile bottom sheet with synchronised 5% controls, saved-versus-unsaved state, required change text, milestone evidence, next step, support, completion, and one Save update action.
- Added compact explicit Goal health labels, action-on-attention/hover/focus behaviour, completed-milestone collapse, current-milestone emphasis, targeted tests, and v34 Goal documentation.

## v33 unified prototype UI fidelity — 7 August 2026

- Reconciled the production shell, wording and density against the approved unified v33 prototype while retaining authenticated identity, real navigation and Records search.
- Rebuilt My Day Goal visibility as one compact post-summary strip; tightened the dedicated Goals workspace, compact rows, summaries, health treatment and mobile layout.
- Moved Goal updates into a focused modal, added Goal category/context/actions to the shared drawer header, and aligned the two-step Goal setup wording and controls.
- Rebuilt More as the approved four-card launcher, restored contextual Records tabs and back navigation, and aligned Settings copy, grouping, desktop master-detail and mobile horizontal navigation.
- Presented Capture Work over My Day through the shared accessible modal and added the explicit urgent safety/compliance entry without changing classification, action or persistence contracts.
- Added updated desktop/mobile/dark visual evidence and refreshed Playwright expectations for the approved v33 wording and structure.

## v33 dedicated Goals workspace — 6 August 2026

- Added Goals as a primary workspace between Work and Plan while keeping Calendar exclusively under Plan.
- Added compact My Goals and authorised Team Goals master-detail views, whole-row targets, My Day exceptions, responsive mobile layouts, and the accessible right-side Goal drawer.
- Added manager-led two-step setup, explicit activation/agreement, independently actionable milestones, overall five-percent updates, support requests, structural version proposals, and manager agreement.
- Added additive Goal migrations, transactional RPCs, RLS capabilities, immutable audit/notification links, private evidence, linked work, read models, strict generated types, and realistic Safety Digitalisation fixtures.
- Integrated curated Goal progress and exceptions into weekly employee and manager email summaries.
- Added pure Goal rules, real-stack transaction coverage, pgTAP permission checks, and browser coverage for desktop/mobile Goal workflows.

## v30 UI/UX parity enforcement — 6 August 2026

- Reconciled the production shell, Today, Work, Available Work, Routine Work, Plan, Team, Records, Settings, task drawer, checklist, attachments, activity, modal, responsive, and dark-theme experiences against the approved executable prototypes.
- Consolidated the shared row, tab, badge, progress, attachment, settings, drawer, modal, toast, empty, and loading primitives around common sizing and motion tokens.
- Made applicable rows and calendar items semantic whole-area targets while preserving independent nested Activate, Complete, attachment, menu, and Undo actions.
- Added animated drawer/modal lifecycles with scroll locking, Escape close, focus trapping/restoration, mobile full-width behaviour, reduced-motion support, and visible keyboard focus.
- Added a complete parity audit, prototype/before/after evidence, and Playwright coverage at all five required viewport sizes, including interaction, overflow, dark-theme, console-error, and Axe checks.

## v30 local application completion — 6 August 2026

- Added More with RLS-filtered completion records, authorised attachments, immutable audit history, searchable archive, and meaningful personal/operational settings.
- Added the administrator user directory with compensated local Auth provisioning, profile maintenance, deactivation/reactivation, controlled-exception handling, and guarded history-free deletion.
- Added Visibility Rules with searchable people, live effective-access preview, transactional save, RLS enforcement, and immutable administration history.
- Added auditable personal preferences and organisation-setting changes.
- Added real weekly personal/manager summaries, unique delivery-period protection, atomic processing claims, bounded retries, delivery history, and local scheduling commands.
- Added the local routine-occurrence scheduler over the idempotent database generator.
- Added desktop/mobile browser journeys and WCAG scans for More, user administration, and visibility, plus worker/settings integration and weekly-window unit coverage.
- Completed architecture, data model, permissions, action contracts, local operations, future deployment, and test-strategy handoff documents.
- Upgraded to Next.js 16.3 and React 19.2, migrated middleware to the proxy convention and ESLint to native flat configuration, and cleared all npm production dependency advisories.
- Added lint and production smoke as explicit release gates; the final suite passes all 14 gates with no failures or skips.

## v30 task detail implementation — 5 August 2026

- Added the responsive task master-detail drawer with Do Next, authoritative lifecycle controls, checklist completion and reopening, evidence upload, updates, mentions, barriers, collaborators, related work, recent activity, and full immutable history.
- Added transactional update posting with private attachment metadata, task-age refresh, mention records, idempotency, audit events, and safe cleanup of uncommitted uploads.
- Added authorised short-lived attachment downloads that record evidence views automatically without treating a view as completion acceptance.
- Added real-stack permission tests and desktop/mobile browser coverage for task detail, uploads, downloads, and accessibility.

## v30 implementation progress — 5 August 2026

- Added the production Capture Work route with persisted drafts, the approved one-question urgency/follow-up flow, recommendation correction, responsive desktop/mobile presentation, drag/drop and pasted-file capture, and clear failure states.
- Added transactional capture confirmation for Quick Actions, Operational Available Work, Self-Development Plans, collaborative contributions, mandatory actions, Major Project proposals, and Routine Template proposals.
- Added audit, manager notification, private attachment metadata transfer, mandatory-classification enforcement, idempotency, and integration coverage for Capture Work.
- Restored the approved repository `README.md` from the v30 build pack.

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
