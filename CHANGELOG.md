# TAMCO Focus — Change Log


## v37 — 7 August 2026

- Synchronized the prototype and documentation to the uploaded `index(20260807-072841).html` reference.
- Preserved the same example users, tasks, goals, routines, focus counts, barriers, ageing values, wording, UI/UX, click behaviour, drawers, themes and flows.
- Retained all latest v34 Goal behaviour and v36 Next action / Team Focus behaviour.
- Reconciled older documentation conflicts so Goals are a dedicated workspace, Plan remains Calendar, task detail uses Next action, and the manager workspace is Team Focus.
- Added a forced mobile composition using the same canonical data and functions; no new business logic was introduced.

## v34 — 5 August 2026

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


## v34

- Moved Goals out of the Calendar page into a dedicated primary Goals workspace.
- Added direct Goals navigation on desktop and mobile.
- Kept a compact goal exception strip in My Day for visibility without daily clutter.
- Replaced the staged milestone-only update form with a quick progress slider, short note and optional attachment flow.
- Made milestone rows directly actionable: adjust progress, mark complete, add comment and upload evidence.
- Added milestone editing, proposal, discussion and manager–employee agreement flow with version history.
- Updated the Safety Digitalisation example to five practical delivery milestones.


## v34 — Lean goal focus and milestone check-ins

- Separated goals into **Active**, **For discussion**, **Completed**, and **All** views.
- Only Active agreed goals contribute to formal weighting and weighted progress.
- Added visible 100% formal-weight control with remaining or over-allocated guidance.
- Simplified goal rows to one milestone-calculated progress value, health, target date, last-update age, and secondary weight.
- Made the full row clickable; the Update action appears only on hover/focus or when attention is required.
- Collapsed completed milestones and kept the current milestone visually prominent.
- Replaced the large milestone update modal with a desktop right-side drawer and mobile bottom sheet.
- Added slider ticks, direct percentage entry, saved-versus-new progress, one **Save update** action, optional evidence, support request, and **Mark milestone complete** control.
- Added validation that prevents an Active goal from taking the formal set above 100%; goals may still be saved for discussion.


## v36 — 7 August 2026

- Renamed **Do next** to **Next action** and replaced generic placeholder wording with a meaningful-action pattern.
- Added direct inline Set/Edit and Mark done controls for the current Next action.
- Split progress posting into **What changed?** and **What happens next?** so the latest update can refresh the task’s immediate action.
- Reused the current Next action as the actionable Checklist item.
- Moved task-age calculation guidance out of the action card and behind an accessible information control beside the age indicators.
- Preserved all v34 Goal workspace, formal weighting and milestone-update improvements.


## v36

- Renamed the manager workspace from **Team Load** to **Team Focus**.
- Replaced large repeated employee workload cards with a compact exception-first people list.
- Added Needs attention / Everyone filters and Priority / Name sorting.
- Added compact focus counts without misleading capacity progress bars.
- Added a right-side team-member detail drawer with actionable attention items, current focus, Next Actions, selective ageing, and collapsed secondary workload.
- Removed default emphasis on low-value counts and large empty category panels.
- Kept all v34 Goal and v35 Next Action behaviour unchanged.
