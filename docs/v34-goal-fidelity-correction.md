# V34 Goal fidelity correction

## Approved references

- `D:\Download\UPDATE_EXISTING_APP_TO_V35_PROMPT(2).md` (preserve the approved v34 Goal module)
- `D:\Download\MASTER_PRODUCT_SPEC(9).md` (Goal workspace and progressive-disclosure rules)
- `D:\Download\PRODUCTION_LOGIC(10).md` (derived progress and milestone update rules)
- `D:\Download\index(20260807-003621).html` (executable visual and wording reference)
- Six supplied Goal workspace, drawer, milestone, update, and evidence screenshots

## Implementation impact map

| Area                    | Previous application                              | Approved v34 presentation                                                                          | Correction                                                                                                                   |
| ----------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| My Goals workspace      | Generic panel heading and summary card            | Owner summary, formal-weight strip, lifecycle tabs, compact check-in exception and rows            | Rebuilt the page hierarchy without changing queries or data                                                                  |
| Goal rows               | Health information grouped under the title        | Separate health, milestone progress, target/update/weight, and action columns                      | Refactored the shared `GoalRow`; retained whole-row link and independent Update action                                       |
| Goal drawer header/tabs | Extra health block and count badges               | Lean header and four text tabs                                                                     | Removed duplicate status block and tab counts; retained accessible tab semantics                                             |
| Overview                | Dense definition grid                             | Progress-source strip, progress hero, agreed outcome, current milestone and native disclosure rows | Reordered existing Goal fields and actions into the approved hierarchy                                                       |
| Milestones              | Clickable rows with no visible row action         | Current milestone emphasis, collapsed completed group and visible Update actions                   | Added independent Update actions and retained the same milestone update operation                                            |
| Updates                 | Generic chronological activity cards              | Compact Meaningful updates timeline                                                                | Rebuilt the timeline while retaining stored updates, actors, next steps and attachments                                      |
| Evidence & work         | Large empty states and persistent linking form    | Lean file/work rows and progressive-disclosure linking control                                     | Compact presentation; existing preview/open/link operations retained                                                         |
| Milestone check-in      | Functional but visually underspecified side panel | Goal check-in header, context card, progress card, evidence row, disclosure and sticky save footer | Reconciled structure and styling; server action, validation, evidence upload, support request and completion logic unchanged |

## Preserved behaviour

- Authentication, RLS, permissions, Goal queries and server actions are unchanged.
- Goal progress remains derived from agreed milestone weights.
- The progress slider and numeric entry remain synchronized in five-percent increments.
- Evidence upload, next step, support request, milestone completion, Goal version alignment, update request and linked-work operations remain connected to their existing production actions.
- No prototype records were added and no local data was reset.

## Verification scope

- Strict TypeScript and targeted ESLint
- Goal domain unit tests
- Goal desktop/mobile Playwright coverage, including whole-row opening, independent Update controls, tabs, check-in controls, focus restoration and overflow
- Local production build and browser review at desktop/mobile sizes and both themes

## Visual review captures

The post-correction captures are stored in `docs/ui-parity/goals/`:

- `after-workspace.png`
- `after-overview.png`
- `after-milestones.png`
- `after-updates.png`
- `after-evidence-work.png`
- `after-check-in.png`
- `after-mobile-workspace.png`
- `after-mobile-overview.png`
- `after-mobile-check-in.png`
- `after-mobile-dark.png`
