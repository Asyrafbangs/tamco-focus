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
