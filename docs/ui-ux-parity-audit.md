# TAMCO Focus UI/UX parity audit

## Unified v33 superseding pass — 7 August 2026

The latest approved executable reference is `D:/Download/index(20260806-111925).html` (SHA-256 `E906E4F56DA5656604E192A8528498113E9D9953BC6D68A33FC5BE3D1CDA2EFE`). It supersedes the older prototype only where the unified file defines newer presentation, interaction or wording.

| Area            | Prototype v33                                                               | Application before this pass                                 | Difference                            | Severity | Required correction                          | Final status |
| --------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------- | -------- | -------------------------------------------- | ------------ |
| Shell           | 72 px rail, 68 px top bar, compact product/search/identity                  | Older proportions and wording                                | Geometry and density drift            | Medium   | Apply v33 shell geometry and labels          | Fixed        |
| Today Goals     | One compact strip after workload summary                                    | Large Goal exception section before daily work               | Goal content competed with daily work | High     | Restore approved daily hierarchy             | Fixed        |
| Goals           | Standalone page intro, compact summaries/rows, focused drawer/update        | Older heading, sparse rows and inline update form            | Structural and interaction mismatch   | High     | Recompose page, rows, drawer and update flow | Fixed        |
| More            | Four whole-card utilities                                                   | Persistent subnavigation and metric dashboard                | Wrong information architecture        | High     | Rebuild landing utilities                    | Fixed        |
| Records         | Back link, contextual tabs and compact list                                 | Older heading and indirect navigation                        | Hierarchy/wording drift               | Medium   | Add contextual header and role-aware tabs    | Fixed        |
| Settings        | Team rules and my preferences; compact master-detail; horizontal mobile nav | Older wording; mobile cascade could retain desktop columns   | Structural/mobile mismatch            | High     | Align labels and enforce mobile reflow       | Fixed        |
| Capture         | Modal over the current workspace with progressive classification            | Dedicated route page                                         | Presentation and continuity mismatch  | High     | Render existing actions through shared modal | Fixed        |
| Responsive/dark | Intentional 390 px reflow and semantic dark surfaces                        | Needed revalidation after new Goal/Capture/Settings surfaces | Overflow/token risk                   | High     | Verify and correct mobile/dark states        | Fixed        |

The detailed implementation, evidence paths, intentional differences and verification limitation are recorded in `docs/ui-fidelity-v33-report.md`.

Date: 6 August 2026  
Approved desktop reference: `D:/AI Project/Task Management/Building Specification/index (1).html`  
Repository prototype: `desktop/index.html` (SHA-256 identical to the approved reference)  
Approved mobile reference: `mobile/index.html`

## Method

The local Next.js application, local Supabase services, and approved HTML prototype were run side by side. Equivalent states were inspected at identical viewport sizes. Baseline captures are stored in `docs/ui-parity/`; after captures use the same routes and viewport sizes.

The audit distinguishes visual parity from production data. Static names, counts, and demo-only role switching in the prototype are not copied into the production application. Real authenticated identity, permissions, API behaviour, and row-level security remain authoritative.

## Parity matrix

| Area                            | Prototype                                                                                                       | Current application                                                                                                | Difference                                                              | Severity | Required correction                                                                                                             | Initial status |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Application shell               | Compact navy rail; structured top bar with product context, search, and controls                                | Similar rail and top bar, but different spacing and missing product/search context                                 | Shell proportions and control hierarchy drift; mobile treatment differs | High     | Match rail, header density, typography, spacing, mobile navigation, focus and hover states while preserving real authentication | Open           |
| Navigation                      | Consistent compact rows with selected fill, icon/text alignment, and responsive bottom navigation               | Route navigation works but selected, hover, focus, and mobile dimensions vary                                      | Inconsistent hit areas and visual states                                | Medium   | Consolidate navigation row tokens and responsive behaviour                                                                      | Open           |
| Today page                      | Two-column start/today hierarchy, compact summary, dense coming-up rows, header actions                         | Broadly similar hierarchy but different header actions, spacing, density, metadata alignment, and row states       | Structure is close; details do not meet visual tolerance                | Medium   | Reconcile card dimensions, summary cells, row primitive, metadata and responsive stacking                                       | Open           |
| Work page                       | Connected Workspace tabs and Focus category tabs; dense task rows with status, due date, progress and actions   | Tabs exist but feel separate; task title is the only primary opening target; rows are sparse                       | Primary interaction and visual hierarchy differ                         | High     | Create shared tabs and TaskRow; add full-row hit target with independent nested actions; match density and overflow             | Open           |
| Available Work                  | Dense row grid with type, availability/review date, checklist progress, metadata chips and independent Activate | Current rows use the same loose task layout and title-only opening                                                 | Sparse layout; click and action hierarchy incorrect                     | High     | Use shared TaskRow variant, stretched primary link and protected Activate action                                                | Open           |
| Routine Work                    | Compact Workspace tabs and grouped routine rows connected to the content surface                                | Correct data grouping but large cards, title-only opening and inconsistent row density                             | Layout and hit target mismatch                                          | High     | Adopt shared tabs, TaskRow/RoutineRow and compact grouped sections                                                              | Open           |
| Plan page                       | Calendar controls and legend above a dense grid; coloured interactive chips per event type                      | Grid is functionally close; legend placement, cell size, chip states, padding and typography differ                | Calendar entries need prototype styling and state distinctions          | Medium   | Introduce CalendarItem, match cell metrics and move legend/controls into prototype hierarchy                                    | Open           |
| Team page                       | Compact member cards with focus load groups and task rows                                                       | Current cards emphasise counters and omit prototype task-row density                                               | Information hierarchy and content structure differ                      | High     | Recompose member cards around real visible workload data, shared rows and compact load summaries                                | Open           |
| Records                         | Unified record workspace tabs and compact table-like RecordRows                                                 | Large filter grid and large record cards; title-only opening                                                       | Excessive density/structure divergence                                  | High     | Add Records workspace tabs, collapsible/compact filters and shared whole-row RecordRow                                          | Open           |
| Settings                        | Desktop master-detail with grouped navigation and compact policy rows; horizontal master navigation on mobile   | Stacked large fieldsets and individual oversized panels/forms                                                      | Fundamentally different structure and excessive vertical space          | High     | Rebuild as SettingsNavigation + detail panel + grouped SettingsPolicyRows; retain semantic grouping and server actions          | Open           |
| Task drawer                     | Animated overlay and right drawer with Overview, Checklist and Updates tabs; compact metadata/actions           | Abrupt route-mounted drawer shows all sections in one long page                                                    | Motion, focus lifecycle, information architecture and density differ    | High     | Add mounted exit animation, Escape/overlay close, focus restore, scroll lock, mobile full width and internal tabs               | Open           |
| Checklist                       | Compact circular state, supporting text, integrated evidence and Complete actions                               | Visible native file input; evidence block is tall; completion detached from evidence                               | Structure and validation affordance differ                              | High     | Build ChecklistItem with hidden native input, file chip, required evidence state, integrated completion and smooth state change | Open           |
| Attachments                     | Designed Add evidence control, compact file chips, validation/progress/failure states                           | Browser file inputs are visible in checklist and update forms; attachment rows vary                                | Default controls and inconsistent layout                                | High     | Create AttachmentPicker, AttachmentChip and AttachmentRow; preserve accessible native input                                     | Open           |
| Recent activity                 | Compact separated rows with title left and actor/time right                                                     | Drawer activity is compact-ish but other activity/update blocks use nested cards                                   | Density and alignment inconsistent                                      | Medium   | Standardise ActivityRow and responsive right metadata stacking                                                                  | Open           |
| Modals                          | Fade/scale lifecycle, trapped focus, Escape, focus restoration                                                  | Modal-like surfaces mount/unmount abruptly or use native details                                                   | Interaction lifecycle missing                                           | High     | Create shared Modal primitive and migrate applicable overlays                                                                   | Open           |
| Responsive layout               | Intentional tablet/mobile reflow, scrollable compact tabs, full-width drawer, bottom navigation                 | Functional but several wide grids and fields stack inconsistently; Settings is especially tall                     | Breakpoint behaviour does not match reference                           | High     | Validate five required viewports, remove uncontrolled overflow and align mobile density                                         | Open           |
| Dark mode                       | Coherent navy surfaces and semantic tint tokens                                                                 | Dark mode exists but some surfaces, borders and native controls retain mismatched tokens                           | Token coverage is incomplete                                            | Medium   | Consolidate semantic tokens and verify every shared component in dark mode                                                      | Open           |
| Loading, empty and error states | Compact, page-consistent messaging and skeleton shapes                                                          | Empty and notice states exist but vary in sizing and card treatment; skeleton coverage is limited                  | Inconsistent shared states                                              | Medium   | Add EmptyState, LoadingSkeleton and consistent Toast/notice styles                                                              | Open           |
| Accessibility                   | Designed focus states and whole-hit-area interactions                                                           | Semantic links/forms exist, but title-only rows, abrupt overlays and visible native upload layout reduce usability | Keyboard and focus lifecycle gaps                                       | High     | Add semantic stretched links, visible focus, protected nested actions, dialog focus management and reduced-motion support       | Open           |

## Detailed findings

### Shared structure and interaction

- Row heights, paddings, borders, radii, typography, and transitions vary between Today, Work, Routine, Team, Records, calendar entries, attachments, and activity.
- Work, Routine, Records, and several utility rows only open from the title. The visual row is not the hit target.
- Nested actions need a consistent protected layer above a semantic stretched primary link; container-only `onClick` handlers would not provide acceptable keyboard semantics.
- Tab sets use different sizes and active treatments. Some content surfaces do not visually connect to the active tab.
- Buttons and inputs inherit inconsistent browser/platform styling in upload and settings contexts.
- Motion has not been applied as a shared system. Drawer and modal exit states are especially abrupt.

### Page findings

- **Today:** retain the working real-data selection and start-my-day rules, but reconcile page actions, summary geometry, card spacing and row metadata.
- **Work:** preserve focus limits, activation reasons, move-out rules and server actions. Replace only the presentation and primary-hit-area structure.
- **Plan:** keep current real occurrence/task data and filters. Prototype colours must map to real task, routine, review and overdue states.
- **Team:** the prototype's `View as` control is a demonstration role simulator. It must not be reproduced because impersonation would conflict with real authentication/authorisation. Real authorised team visibility remains the source of truth.
- **Records:** search and historical filters remain required business capabilities. They should be presented compactly rather than removed.
- **Settings:** individual server actions and permission-filtered settings remain authoritative. The forms need to be composed into the prototype master-detail shell without weakening semantics or access control.
- **Drawer:** all supported business sections remain available, but they must be distributed across prototype-style tabs and compact rows.

## Baseline evidence

| View             | Prototype                                        | Before                                      |
| ---------------- | ------------------------------------------------ | ------------------------------------------- |
| Today desktop    | `docs/ui-parity/today/prototype.png`             | `docs/ui-parity/today/before.png`           |
| Today dark       | `docs/ui-parity/today/prototype-dark.png`        | `docs/ui-parity/today/before-dark.png`      |
| Work desktop     | `docs/ui-parity/work/prototype.png`              | `docs/ui-parity/work/before.png`            |
| Routine desktop  | `docs/ui-parity/work/prototype-routine.png`      | `docs/ui-parity/work/before-routine.png`    |
| Plan desktop     | `docs/ui-parity/plan/prototype.png`              | `docs/ui-parity/plan/before.png`            |
| Team desktop     | `docs/ui-parity/team/prototype.png`              | `docs/ui-parity/team/before.png`            |
| Records desktop  | `docs/ui-parity/records/prototype.png`           | `docs/ui-parity/records/before.png`         |
| Settings desktop | `docs/ui-parity/settings/prototype.png`          | `docs/ui-parity/settings/before.png`        |
| Task drawer      | `docs/ui-parity/drawers/prototype.png`           | `docs/ui-parity/drawers/before.png`         |
| Checklist        | `docs/ui-parity/drawers/prototype-checklist.png` | `docs/ui-parity/drawers/before.png`         |
| Today mobile     | `docs/ui-parity/mobile/prototype-today.png`      | `docs/ui-parity/mobile/before-today.png`    |
| Work mobile      | `docs/ui-parity/mobile/prototype-work.png`       | `docs/ui-parity/mobile/before-work.png`     |
| Settings mobile  | `docs/ui-parity/mobile/prototype-settings.png`   | `docs/ui-parity/mobile/before-settings.png` |

## Accepted constraints and potential intentional differences

These are constraints to validate again after implementation, not blanket exceptions:

1. Prototype role switching and `View as` controls are static simulation affordances. Production authentication, RLS, and authorised team visibility take precedence, so no impersonation control will be added.
2. Static prototype names, task counts, timestamps, and example files will not replace production/local database content.
3. Production-only capabilities such as full record filtering, audit retention information, and permission-filtered settings remain available, but will be visually integrated into the prototype structure.
4. A prototype element with no safe business capability may be rendered informationally or marked not applicable; every such case will be documented in the final status update.

## Completion update protocol

After implementation, every matrix row will be updated to **Fixed**, **Partially fixed**, **Intentionally different**, or **Not applicable**, with a reason for any status other than Fixed. No major or medium issue may remain unresolved at completion.

## Final disposition

| Area                            | Final status | Implemented correction                                                                                                                                                                        |
| ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application shell               | Fixed        | Matched the compact rail, structured top bar, product context, real records search, user controls, mobile navigation, and shared interaction states.                                          |
| Navigation                      | Fixed        | Standardised selected, hover, focus, pressed, and responsive states with full visual-area targets.                                                                                            |
| Today page                      | Fixed        | Reconciled the Start Here hierarchy, summary geometry, task density, metadata alignment, utility-card hit targets, and mobile stacking.                                                       |
| Work page                       | Fixed        | Added connected Workspace and Focus tabs, dense shared TaskRows, semantic stretched links, and protected nested actions.                                                                      |
| Available Work                  | Fixed        | Added the compact metadata grid, progress, due/overdue treatment, whole-row opening, and independent Activate action.                                                                         |
| Routine Work                    | Fixed        | Rebuilt grouped occurrences with connected tabs and shared compact RoutineRows.                                                                                                               |
| Plan page                       | Fixed        | Rebuilt events as tinted interactive CalendarItems with contained truncation, event-state distinctions, matching cell metrics, and keyboard access.                                           |
| Team page                       | Fixed        | Replaced counter-heavy cards with RLS-authorised workload groups and compact whole-row task targets.                                                                                          |
| Records                         | Fixed        | Added a unified records workspace, compact filters, table-like RecordRows, and whole-row navigation.                                                                                          |
| Settings                        | Fixed        | Rebuilt desktop Settings as master-detail navigation and grouped policy rows, with mobile horizontal navigation, global save/discard, and cross-panel unsaved-state indication.               |
| Task drawer                     | Fixed        | Added a persistent animated SideDrawer with Overview, Checklist, and Updates tabs, overlay/Escape close, focus trapping/restoration, scroll lock, and mobile full width.                      |
| Checklist                       | Fixed        | Added compact completion indicators, supporting text, styled evidence controls, required-evidence validation, integrated Complete actions, file chips, and live progress updates.             |
| Attachments                     | Fixed        | Added accessible hidden native inputs, designed pickers and chips, remove controls, progress/failure states, and client file-size validation.                                                 |
| Recent activity                 | Fixed        | Standardised compact ActivityRows with left content, right actor/time metadata, separators, hover, and responsive stacking.                                                                   |
| Modals                          | Fixed        | Added shared fade/scale lifecycle, exit-before-unmount, Escape handling, focus trap/restoration, and background scroll locking.                                                               |
| Responsive layout               | Fixed        | Verified the five required viewports, contained calendar content, removed uncontrolled page overflow, retained scrollable tabs, and made the drawer full width on mobile.                     |
| Dark mode                       | Fixed        | Consolidated semantic surface, border, text, badge, focus, hover, upload, modal, and drawer tokens and captured a dark comparison.                                                            |
| Loading, empty and error states | Fixed        | Added shared EmptyState, LoadingSkeleton, Toast, loading, disabled, validation, upload-failure, and notice treatments.                                                                        |
| Accessibility                   | Fixed        | Added semantic row links/buttons, independent nested controls, visible focus, keyboard activation, dialog focus management, accessible file inputs, Axe coverage, and reduced-motion support. |

No major or medium parity issue remains open.

## Shared implementation record

The parity pass created or consolidated `TaskRow`, `RoutineRow`, `ActivityRow`, `RecordRow`, `CalendarItem`, `ChecklistItem`, `AttachmentPicker`, `AttachmentChip`, `WorkspaceTabs`, `FocusTabs`, `SettingsNavigation`, `SettingsPolicyRow`, `SideDrawer`, `Modal`, `Toast`, `StatusBadge`, `PriorityFlag`, `ProgressIndicator`, `EmptyState`, and `LoadingSkeleton`. These components share sizing, spacing, colour, border, typography, focus, pressed, transition, disabled, and loading tokens rather than reproducing page-local variants.

Whole-row behaviour uses semantic links or buttons. Rows with nested actions use a stretched primary link beneath an independently focusable action layer; Activate, Complete, menus, attachment actions, and Undo do not trigger the row target.

Shared motion tokens use 140 ms fast interactions, 200 ms standard overlays/content changes, 240 ms drawers, and `cubic-bezier(0.2, 0, 0, 1)`. Drawer/modal exit transitions finish before unmount. Reduced-motion preference collapses animation and transition duration.

## Final visual evidence

| View                    | Prototype                                        | Before                                      | After                                              |
| ----------------------- | ------------------------------------------------ | ------------------------------------------- | -------------------------------------------------- |
| Today desktop           | `docs/ui-parity/today/prototype.png`             | `docs/ui-parity/today/before.png`           | `docs/ui-parity/today/after.png`                   |
| Today dark              | `docs/ui-parity/today/prototype-dark.png`        | `docs/ui-parity/today/before-dark.png`      | `docs/ui-parity/today/after-dark.png`              |
| Work / Focus            | `docs/ui-parity/work/prototype.png`              | `docs/ui-parity/work/before.png`            | `docs/ui-parity/work/after.png`                    |
| Available Work          | `docs/ui-parity/work/prototype.png`              | `docs/ui-parity/work/before.png`            | `docs/ui-parity/work/after-available.png`          |
| Routine Work            | `docs/ui-parity/work/prototype-routine.png`      | `docs/ui-parity/work/before-routine.png`    | `docs/ui-parity/work/after-routine.png`            |
| Plan                    | `docs/ui-parity/plan/prototype.png`              | `docs/ui-parity/plan/before.png`            | `docs/ui-parity/plan/after.png`                    |
| Team                    | `docs/ui-parity/team/prototype.png`              | `docs/ui-parity/team/before.png`            | `docs/ui-parity/team/after.png`                    |
| Records                 | `docs/ui-parity/records/prototype.png`           | `docs/ui-parity/records/before.png`         | `docs/ui-parity/records/after.png`                 |
| Settings                | `docs/ui-parity/settings/prototype.png`          | `docs/ui-parity/settings/before.png`        | `docs/ui-parity/settings/after.png`                |
| Task drawer             | `docs/ui-parity/drawers/prototype.png`           | `docs/ui-parity/drawers/before.png`         | `docs/ui-parity/drawers/after.png`                 |
| Checklist               | `docs/ui-parity/drawers/prototype-checklist.png` | `docs/ui-parity/drawers/before.png`         | `docs/ui-parity/drawers/after-checklist.png`       |
| Today mobile            | `docs/ui-parity/mobile/prototype-today.png`      | `docs/ui-parity/mobile/before-today.png`    | `docs/ui-parity/mobile/after-today.png`            |
| Work mobile             | `docs/ui-parity/mobile/prototype-work.png`       | `docs/ui-parity/mobile/before-work.png`     | `docs/ui-parity/mobile/after-work.png`             |
| Settings mobile         | `docs/ui-parity/mobile/prototype-settings.png`   | `docs/ui-parity/mobile/before-settings.png` | `docs/ui-parity/mobile/after-settings.png`         |
| Manager Settings mobile | Not applicable to employee prototype             | Not applicable                              | `docs/ui-parity/mobile/after-settings-manager.png` |
| Plan mobile             | Mobile prototype shell                           | Not separately captured                     | `docs/ui-parity/mobile/after-plan.png`             |
| Team mobile             | Mobile prototype shell                           | Not separately captured                     | `docs/ui-parity/mobile/after-team.png`             |
| Records mobile          | Mobile prototype shell                           | Not separately captured                     | `docs/ui-parity/mobile/after-records.png`          |
| Routine mobile          | Mobile prototype shell                           | Not separately captured                     | `docs/ui-parity/mobile/after-routine.png`          |
| Drawer mobile           | Mobile prototype shell                           | Not separately captured                     | `docs/ui-parity/mobile/after-drawer.png`           |

## Automated parity verification

`tests/e2e/00-ui-parity.spec.ts` covers every main employee surface, every Focus category, Available Work, Routine Work, Plan, manager Team, Records, Settings, the task drawer, checklist evidence, completion/reopen actions, independent activation, calendar-item opening, mobile navigation, full-width mobile drawer, dark tokens, keyboard opening, Escape/focus restoration, reduced motion, horizontal-overflow prevention, console errors, and Axe accessibility scans.

The suite runs at 1440 × 900, 1280 × 800, 1024 × 768, 768 × 1024, and 390 × 844. The focused parity run completed with 12 applicable tests passed and 8 project-specific tests deliberately skipped where a test belongs only to desktop interaction or mobile navigation; no required journey was skipped.

The final clean-state `npm run verify` completed with **14 gates passed, 0 failed, and 0 skipped**. Evidence includes 477 parsed SQL/seed/test statements, all 24 migrations applied from zero, 109 unit tests, 24 pgTAP RLS assertions, 19 live-stack integration tests, 31 applicable Playwright journeys across the five projects, production build, production smoke, generated-type parity, secret scanning, formatting, lint, and strict type checking. The 11 Playwright skips are explicit viewport/project guards for desktop-only interaction and mobile-only navigation cases; the verifier's gate-level result contains no skipped gate. Final preflight passed and the production dependency audit reported zero vulnerabilities.

## Intentional differences

1. The prototype's role switcher and Team `View as` affordance are demo impersonation controls. They are intentionally omitted because real authentication, RLS, and authorised team visibility are security boundaries.
2. Prototype-only names, task counts, timestamps, and files are not copied. The application renders real local-database content.
3. Production record filters, audit-retention information, and permission-filtered settings remain available inside the reconciled layouts because they are approved business capabilities.
4. The shell search performs a real Records search instead of reproducing a non-functional prototype search field.
