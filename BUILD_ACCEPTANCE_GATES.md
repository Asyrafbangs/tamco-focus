# TAMCO Focus — Local Production Build Acceptance Gates

The build is not complete until every applicable gate passes.

## 1. Requirements and traceability

- [ ] Latest authoritative files were inventoried and read.
- [ ] Traceability matrix maps all approved requirements to implementation and tests.
- [ ] No approved module was silently omitted.
- [ ] Assumptions and unresolved decisions are documented.

## 2. Repository quality

- [ ] Strict TypeScript is enabled.
- [ ] Dependency versions are pinned by the lockfile.
- [ ] No `TODO`, `FIXME`, placeholders, dead code, or disabled critical tests remain.
- [ ] Formatting, linting, and type checking pass.
- [ ] No secrets or local volumes are committed.
- [ ] Local Git repository uses `main` and has no remote.

## 3. Local environment reproducibility

- [ ] Windows PowerShell setup script works from a clean checkout.
- [ ] Unix setup script works from a clean checkout.
- [ ] Supabase local stack starts successfully.
- [ ] Database reset applies every migration and seed from zero.
- [ ] Local Auth users can sign in.
- [ ] Generated database types match the local schema.
- [ ] Development server starts with documented commands.

## 4. Database and security

- [ ] Every user-data table has appropriate RLS.
- [ ] Private Storage policies are implemented and tested.
- [ ] Amer/Izzah/Ajmal visibility example works as specified.
- [ ] View access does not grant edit/approval access.
- [ ] Service-role secrets never reach the browser.
- [ ] High-impact actions are server-authorised and transactional.
- [ ] Audit events are immutable through normal application permissions.
- [ ] Concurrency conflicts produce safe, useful responses.

## 5. Core workflows

- [ ] Capture Work works for Quick, Operational, Routine request, Self-Development, Collaboration, Major Project request, and urgent mandatory work.
- [ ] Available Work activates within target in one action.
- [ ] Over-target activation asks one reason and remains allowed.
- [ ] Red over-target state and manager visibility work.
- [ ] Move to Available and Undo work.
- [ ] Pause/Resume/Complete/Cancel rules work.
- [ ] Routine occurrences remain separate from templates and focus targets.
- [ ] Collaboration and handoffs work.
- [ ] Updates, screenshots, files, and evidence work.
- [ ] Barriers and decision flow work.
- [ ] Completion review distinguishes viewed evidence from accepted completion.
- [ ] Records, archive, attachments, audit, settings, and visibility rules work.

## 6. UI/UX and accessibility

- [ ] Desktop implementation matches approved intent.
- [ ] Mobile implementation provides equivalent essential capability.
- [ ] Day and Night themes work and persist.
- [ ] Keyboard navigation and visible focus work.
- [ ] Colour is not the only status signal.
- [ ] Touch targets meet the approved minimum.
- [ ] Loading, empty, success, validation, error, permission, and conflict states are implemented.
- [ ] Main screens pass automated accessibility checks.

## 7. Tests

- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] RLS/database tests pass.
- [ ] End-to-end tests pass at desktop and mobile viewports.
- [ ] Critical negative/denial tests pass.
- [ ] No flaky or skipped critical tests remain.

## 8. Production-like local verification

- [ ] Production build succeeds.
- [ ] Production-mode server starts locally.
- [ ] Smoke tests pass against production-mode build.
- [ ] Bundle/performance review identifies no obvious blocking issue.
- [ ] Logs contain no secrets or repeated uncontrolled errors.

## 9. Documentation and handoff

- [ ] Local setup and operations guide is complete.
- [ ] Data model and architecture are documented.
- [ ] RLS and permissions are documented.
- [ ] API/server-action contracts are documented.
- [ ] Test strategy and results are documented.
- [ ] Future GitHub, Supabase, and Vercel steps are documented.
- [ ] `MASTER_PRODUCT_SPEC.md`, `PRODUCTION_LOGIC.md`, and `CHANGELOG.md` are current.
- [ ] No external deployment, remote link, or GitHub push occurred.


## User lifecycle, weekly summaries, and task-age gates (v34)

- [ ] Administrator can create a user with required name, employee ID, email, department, role, reporting manager, and notification preferences.
- [ ] Duplicate employee ID and normalized email are rejected by both application validation and database constraints.
- [ ] Deactivation prevents sign-in and new assignment while preserving all historical records.
- [ ] Open owned work is reassigned or explicitly controlled before deactivation completes.
- [ ] Permanent deletion is blocked when retained task, file, review, approval, notification, or audit history exists.
- [ ] A history-free user can be permanently deleted only after employee-ID confirmation.
- [ ] Personal weekly summaries are generated from canonical task/audit activity, not manually duplicated status reports.
- [ ] Manager weekly summaries contain direct-report changes and exceptions and respect effective visibility.
- [ ] Weekly-email delivery is idempotent, retryable, auditable, and protected against duplicate sends.
- [ ] Open, current-state, overdue, and stale durations are calculated from timestamps in the shared domain layer.
- [ ] Date-only due commitments do not become overdue before the organisation-local end of the due date.
- [ ] Duration indicators and accessible labels are consistent across desktop, mobile, email, and exports.


## V34 Goals acceptance gates

- Goals are accessible as a dedicated primary workspace; Plan remains the Calendar/planning workspace.
- Employees can view their agreed goals and post a lean progress update with an optional attachment.
- Managers can view Team Goals, prepare a one-to-one discussion and set up a goal with manager expectation plus employee contribution.
- Formal goal sets warn when weights do not total 100.
- Milestone progress calculates goal progress deterministically.
- Linked-task completion does not automatically modify goal progress.
- Support requests appear in manager attention surfaces.
- Goal updates, target changes, attachments and closure create audit events.
- Employee and manager weekly summaries include only meaningful goal information.
- Desktop and mobile goal flows pass end-to-end tests and accessibility checks.


## V34 Goal UX gates

- My Goals is a compact list rather than a card grid.
- Team Goals uses a people-to-goals master-detail layout.
- Opening a goal uses a right-side drawer.
- The normal update flow has only three required decisions: milestone, stage, and what changed.
- Goal weight and formal agreement details are secondary.
- Mobile Goal views remain readable without horizontal scrolling.


## V34 goal acceptance gates

- [ ] Goals are accessible as a dedicated workspace and are not nested inside Calendar.
- [ ] My Day displays goal information only for meaningful check-ins or exceptions.
- [ ] Overall goal progress can be adjusted by slider and saved with a required note.
- [ ] Milestone progress can be adjusted directly and marked complete.
- [ ] Milestone comments and evidence can be posted through the same update model.
- [ ] Milestone edits support pending discussion and explicit agreement without overwriting the current version prematurely.
- [ ] Goal and milestone attachments remain linked to the originating update and visible in the combined evidence view.


## V34 goal acceptance gates

- Active, For discussion, Completed, and All views are distinct and correctly filtered.
- Discussion goals do not appear as agreed Active outcomes or contribute to weighted progress.
- Active formal weight above 100% is blocked at activation, while Save for discussion remains available.
- Milestone-based goals display one overall percentage calculated from milestones.
- Completed milestones are collapsed by default and can be expanded.
- Milestone update opens as a drawer on desktop and a bottom sheet on mobile.
- Slider, direct numeric input, saved value, and unsaved new value remain synchronised.
- Save update is the only primary commit action; Mark complete is an option within that update.
- Comment, evidence and support request persist in the milestone history.


## V36 — Next action acceptance gates

- Task Overview labels the section **Next action**, not **Do next**.
- A real action sentence is displayed when recorded; otherwise **No next action recorded** is shown.
- Users can set or edit the Next action inline from Overview.
- Progress updates use separate **What changed?** and **What happens next?** fields.
- Saving a progress update refreshes the current Next action when a new value is supplied.
- Marking the Next action done does not complete or change the task state.
- The current Next action can be completed from the Checklist view.
- No generic “Continue next action” placeholder is shown.
- Task-age explanatory copy is accessed through an accessible information control beside the age indicators.
- The age explanation is absent from the Next action card.
- Desktop and mobile behaviour are both verified.


## V36 Team Focus acceptance gates

- Manager Team workspace is labelled Team Focus.
- Default view is an exception-first compact people list.
- Needs-attention filtering and priority sorting work without changing task data.
- Empty focus categories do not render large empty panels.
- Capacity is shown numerically and over-target remains visibly exceptional.
- Selecting a person opens a detail view with actionable attention, current focus and Next Action.
- Normal ageing remains quiet; overdue/stale/long-running conditions remain visible.
- Desktop and mobile interaction remains usable and existing permissions are preserved.


## V37 synchronized-reference acceptance gates

- [ ] Desktop prototype preserves the uploaded reference example data, wording, navigation, click behaviour, drawers, themes, Goals flow, Next action flow, and Team Focus flow.
- [ ] Mobile prototype uses the same example data and business interactions with a phone-appropriate composition.
- [ ] Goals are a dedicated primary workspace and are not nested inside Calendar.
- [ ] Task detail uses **Next action**, not Do next or generic placeholder text.
- [ ] Team manager workspace is **Team Focus** and defaults to exception-first scanning.
- [ ] No business logic, permission rule, RLS rule, notification rule, focus-target rule, or production data is silently changed merely to match prototype appearance.
- [ ] Updated Master Product Specification, Production Logic, Change Log, README, desktop index and mobile index all describe the same baseline.
