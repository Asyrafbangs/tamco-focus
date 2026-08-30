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


## V38 task-detail clarity acceptance gates

- [ ] Overview renders one quiet information line; Open and current-state ages are not permanent pills and remain available through the accessible information control.
- [ ] The information line and age modal do not overflow at desktop, tablet, 600 px narrow regression, or 390 × 844 mobile viewports.
- [ ] **Edit due** shows current commitment, new date/date-time, optional reason, Cancel, and Save.
- [ ] Due changes require edit authority and optimistic version agreement, preserve previous/new values plus actor/time/reason, and appear under Recent activity.
- [ ] Next Action shows only the action, compact due/overdue context, Mark done, and Edit in the normal view.
- [ ] Overview checklist preview is a whole-row keyboard-operable control and reports completed/total plus outstanding required evidence.
- [ ] Current Next Action is pinned separately from **Task checklist** and is excluded from checklist count and progress.
- [ ] No-evidence, optional-evidence, and required-evidence rows expose only their approved actions; no row displays Add required evidence + Upload + Complete together.
- [ ] **Complete with evidence** uses a styled hidden-native-input flow and atomically timestamps evidence metadata and checklist completion.
- [ ] Checklist completion/reopening derives task progress, and existing checklist tasks cannot retain a conflicting manual percentage.
- [ ] Recent activity renders readable due, Next Action, checklist, reopen, evidence, update, and progress history with actor and timestamp.
- [ ] No-barrier state is neutral; red/pink treatment is reserved for an actual open barrier.
- [ ] Targeted unit, integration, RLS, E2E, accessibility, generated-type, production-build, and smoke checks pass without altering hosted services.

## v40 to v44 acceptance gates

Run with `node scripts/verify.mjs`. Every gate below is covered by an automated
check unless marked otherwise.

- [ ] Focus navigates by Active / Available / Shared; work classes appear on rows
      and in the capacity strip, never as tabs.
- [ ] `My Work | My Team` is a scope control, separate from the state tabs.
- [ ] Routine uses Due now / this week, Upcoming, Completed inside the same Work
      shell, and `.focus-panel` never renders "Available Work".
- [ ] Activating work changes `status` only; `work_class` is unchanged.
- [ ] Manager-assigned work lands in `backlog`, never `active`.
- [ ] Available rows carry no system-authored next action.
- [ ] Shared lists the original checklist items; no duplicate task is created.
- [ ] A contribution assigned while the parent is Available reads
      "Waiting for owner to start" and does not appear Ready.
- [ ] Assigning a contribution notifies the assignee exactly once, with parent
      context and a link that opens the exact item.
- [ ] The waiting-to-ready transition notifies once, and only on transition.
- [ ] Raising a barrier records who must act, and notifies that person.
- [ ] Posting a barrier response does not resolve the barrier.
- [ ] Resolving a barrier requires a recorded outcome.
- [ ] Every Needs Attention row supplies a reason, a required action and a deep
      link; rows that cannot are not shown as actionable.
- [ ] The Update composer contains only What changed and attachments.
- [ ] Posting an update never modifies `next_action`.
- [ ] The Capture title input is never remounted while typing.
- [ ] Safety wording alone never produces mandatory classification.
- [ ] Every task created through Capture stores its classification rule.
- [ ] The end-to-end suite runs from a freshly seeded database.

## v49 attention UI repair acceptance gates

- [ ] My Day renders no more than two compact attention rows and the panel does
      not push Start Here / Today out of the initial desktop composition.
- [ ] Needs Attention has a distinct severity dot, request-type icon, requester
      identity and independent CTA, followed by a 12px gap before equal-height
      Start Here / Today columns at the 864px desktop reference viewport.
- [ ] My Day View all opens Work → My Team → Needs Attention.
- [ ] My Day and My Team do not share a presentation-row component.
- [ ] My Team renders the stable Person / Working on / Needs you / Latest /
      Action hierarchy without horizontal page overflow.
- [ ] Clicking a person name, row whitespace, Enter, or Space opens Team Member
      Detail.
- [ ] Clicking a nested manager action does not activate the parent person row.
- [ ] Barrier actions open the exact barrier and response field without mounting
      Team Member Detail first.
- [ ] Open routine opens the exact overdue occurrence; a routine is never
      labelled as generic overdue work.
- [ ] A visible action has validated `sourceType`, `sourceId`, and `ctaType`, plus
      task/barrier identity where required; invalid identity renders no dead CTA.
- [ ] Long task/request/person/reference text remains contained at 1440, 1280,
      1024, 768, 430, and 390 px and at 125% / 150% zoom pressure.

## v50 Goal lifecycle acceptance gates

- [ ] Goal setup records structured qualitative/numeric/percentage success measures, required
      target date and 1–100 weight, optional context, and two to five milestones in two steps.
- [ ] Active Goal detail uses Progress / Check-in / Milestones / History, presents measures before
      overall percentage and never treats linked work as Goal progress.
- [ ] One owner monthly check-in per Goal/month is idempotent; No material change is valid; normal
      On track creates no manager action.
- [ ] At risk, Off track and explicit support create an exact manager Goal action with no duplicate
      task, approval or generic person destination.
- [ ] One quarterly record per Goal/quarter supports employee summary followed by manager
      Agree & continue with discussion and agreed actions.
- [ ] Month/quarter dates are derived deterministically; My Day shows owner cadence and Coming up;
      My Team shows only genuine Goal exceptions.
- [ ] Year-end Result retains a traceable source snapshot and only authorised Goal agreement roles
      can finalize it.
- [ ] Success-measure, monthly, quarterly, evidence and Result activity is timestamped and visible
      in chronological History.
- [ ] Direct authenticated writes to Goal lifecycle tables fail; viewer/owner/manager boundaries
      and idempotency pass integration and database policy tests.

## v51 lean Goal acceptance gates

- [ ] Goals exposes one record model through **My Goals** and manager-only **My Team**; it does not
      create a second employee/manager Goal type or duplicate a Goal when its pending version changes.
- [ ] Employees can create and edit only their own Draft / For Discussion Goals; managers can create
      for the selected subordinate and only an authorised manager can Agree & activate.
- [ ] A self-entry or selected-person entry does not ask for Employee again. A generic manager entry,
      if offered, uses the same Goal operation and explicit owner selector.
- [ ] Expectation asks for expected result, natural-language success statements, one target date and
      formal weight. Measure Type, Target State and Period are absent; optional per-measure date and
      category/baseline/purpose are disclosed only on request.
- [ ] Alignment asks for agreed approach and optional support, hides dependencies/risks under More
      details, starts with no milestone rows, and accepts zero to five explicitly added milestones.
- [ ] Weight guidance displays current Active weight, weight after activation and remaining or over
      allocation; the authoritative transaction rejects any Active formal total above 100%.
- [ ] The visible lifecycle is Draft → For Discussion → Active → Completed. An Active structural
      change is labelled Revise goal, remains pending and is audited until manager agreement.
- [ ] Active Goal detail leads with Success and shows cadence, milestones/latest check-in and
      agreement/history without presenting the setup form as the normal reading experience.
- [ ] Monthly check-in remains short and supports On track / At risk / Off track, a concise update or
      No material change, optional support and evidence; normal On track creates no manager action.
- [ ] Quarterly review captures what is working, blockers, support/adjustment and overall status;
      manager attention remains exception-only.
- [ ] Additive migration, generated types, unit, integration, RLS, E2E, accessibility, responsive,
      dark-theme, production build and smoke checks all pass locally.
## v53 execution and Goal lifecycle acceptance gates

- [ ] Ordinary Task cancellation works for owner/authorised manager; Mandatory cancellation is
      manager-only; reason, actor and time are retained.
- [ ] Task completion/cancellation release focus and make source requests, notifications and Meeting
      Queue topics non-actionable without deleting history or falsely resolving a request.
- [ ] Reassignment retains Available/Active state, recalculates both owners, derives Shared from
      checklist ownership and reports workload review when the new owner is over target.
- [ ] Response remains distinct from resolution, and terminal sources never remain in Needs Attention.
- [ ] Major Project proposal Agree / Request changes / Decline and owner resubmission are versioned;
      Agree creates Available work and never activates it.
- [ ] Generic Task source fields are all-null or all-present; no ESH-specific schema or parallel Task
      lifecycle exists.
- [ ] A monthly employee session validates and records every Active Goal exactly once; normal health
      is informational, risk is explained, and explicit support uses the shared request engine.
- [ ] A quarterly employee session reviews every Active Goal exactly once, supports department-only
      manager self-review, and never invents a superior.
- [ ] Performance-period plans build gradually and finalize only at exactly 100%; cancellation leaves
      an explicit reallocation deficit and never redistributes weight.
- [ ] Active Goal revision records before, after, reason, actor and time while the active agreement
      remains effective until agreement.
- [ ] Goal completion records every actual success-measure result plus final summary; cancellation is
      separate and records why the Goal no longer applies.
- [ ] Goal list, detail and weekly summary show formal weight, health, actual/target and milestones as
      separate facts; no fabricated overall Goal percentage remains visible.
- [ ] RLS, integration, end-to-end, responsive, accessibility, generated-type, production build and
      smoke gates pass against a fresh local database reset.

## v69 Team visibility and performance acceptance gates

- [ ] An administrator sees every other active user in My Team, including Izzul.
- [ ] A manager sees the configured reporting tree plus explicit additions and no unrelated users.
- [ ] `specific_only` and `none` rules are reflected consistently in roster, counts and drawers.
- [ ] Reporting-manager name attribution does not expose that manager's workload or focus summary.
- [ ] Task-level collaboration does not promote an unauthorised owner into Team Available work.
- [ ] Whole person rows, exact nested actions, filters, drawer close, Escape and focus restoration
      work on desktop and mobile without horizontal overflow.
- [ ] Team workload/focus aggregation is set-based, duplicate server reads are request-memoized and
      Team task queries do not load unrendered checklist/evidence/attachment aggregates.
- [ ] pgTAP, integration, E2E, lint, typecheck, production build and smoke gates pass after a fresh
      local reset.

## v70 Team member workload detail acceptance gates

- [ ] Expanding Other workload renders named Available, overdue routine-occurrence, and current
      Goal rows; the former generic paragraph is absent.
- [ ] Each category count equals the number of rendered records and each zero category has a
      truthful, specific empty state.
- [ ] Available and routine rows open the exact Task Detail by whole-row pointer or keyboard action;
      Close restores the same Team person and filter one layer below.
- [ ] Goal rows open the exact Goal Detail and Close follows only a validated internal return path
      to the same Team person/filter.
- [ ] Goal context keeps lifecycle, health, target, formal weight, success measures and milestone
      execution separate; it renders no fabricated overall Goal achievement percentage.
- [ ] Direct `person` parameters and record-level collaboration/participation cannot expose a
      person or workload outside the authorised Team roster.

- [ ] The disclosure target, focus state, text wrapping and scrolling pass at desktop and 390 px
      mobile widths with no horizontal page overflow.
- [ ] No migration, generated-type, RLS, authentication, action-authority, workflow, notification,
      audit, Storage, or production-data behaviour changes.
- [ ] The on-demand E2E workflow completes against its isolated production build without a
      long-lived development compiler or application-server heap exhaustion.

## v117 Lean weekly email acceptance gates

- [ ] The personal email contains only Needs attention, the merged current-week list, up to three
      or five recent completions, and Open My Day; report-like change counts, separate Routine
      sections, and recommended-start sections are absent.
- [ ] Available Work is excluded unless High/Critical, due or review-bound in the current week, or
      supported by another explicit action signal.
- [ ] Current-week Focus, Routine, and Shared commitments are merged and labelled; generated Routine
      occurrences beyond the current planning week are absent.
- [ ] A pending Routine not-required request is not overdue; a returned request says “Returned by
      manager · Still due”.
- [ ] Manager content is grouped by visible person and contains only intervention counts/reasons;
      team task dumps, completion feeds, rankings, and performance scores are absent.
- [ ] Exception-aware and healthy subject lines, HTML escaping, plain-text parity, safe application
      links, email-compatible layout, idempotency, retry, audit, and delivery behavior are tested.

## v103 PDF attachment preview acceptance gates

- [ ] Selecting an authorised PDF renders page 1 inside Task Detail without an iframe, browser
      plug-in Open placeholder, new tab, or automatic download.
- [ ] Previous/Next, page count, zoom and Fit width work at desktop and 390 px mobile widths without
      document-level horizontal overflow.
- [ ] Opening a PDF still records the authorised attachment view; an unauthorised request remains a
      neutral not-found response.
- [ ] Download remains an explicit separate action in the attachment header, preserves the original
      filename, and unsupported document types remain downloads.
- [ ] Images still preview in the same surface, object URLs are revoked on close, and loading or
      corrupt PDFs show an actionable error state.
- [ ] Unit, E2E, accessibility, lint, formatting, typecheck, production build and smoke checks pass.

## v120 Transactional notification-email acceptance gates

- [ ] Every newly inserted notification for an active recipient creates exactly one durable email
      delivery row in the same transaction; the migration does not enqueue historical rows.
- [ ] New task assignment and checklist collaboration handoff emails preserve the canonical title,
      explanation, recipient, and exact record link.
- [ ] HTML escapes user content, subjects reject newline injection, links remain same-origin HTTP(S),
      and the plain-text body carries equivalent information.
- [ ] The minimalist template matches the application navy/blue/neutral theme and remains readable
      in desktop and narrow mobile email views.
- [ ] Prompt post-response delivery, scheduled retry, abandoned-claim recovery, bounded attempts,
      one-record idempotency, and persisted sent/failed audit state are verified.
- [ ] Authenticated users can read only their own delivery history and cannot claim, update, insert,
      or delete delivery records; service-role worker access remains server-only.
- [ ] A local Inbucket test notification is visibly received, and the full database, unit,
      integration, RLS, E2E, accessibility, formatting, typecheck, build, and smoke gates pass.
