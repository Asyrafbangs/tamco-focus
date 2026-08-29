# TAMCO Focus v38 — Task-detail clarity on the synchronized production baseline


## Current baseline — v44

The implementation baseline is **v44 handoff loops**. Everything from v40 to v44
is recorded in `MASTER_PRODUCT_SPEC.md` section 33, with the engineering
rationale in `PRODUCTION_LOGIC.md` section 40.

In one paragraph: Focus navigates by state (Active / Available / Shared) with
`My Work | My Team` as a separate scope; work classes remain classes, not tabs.
Collaboration happens through checklist items, and Shared is a projection of
those same rows rather than a second task. A barrier names who must act.
Assignment and barrier handoffs notify the person receiving them, in the same
transaction as the change, and those notifications open the exact record.

Run `node scripts/verify.mjs` for the full gate suite.

## v103 PDF attachment review path

Open an Operational Action, expand **Updates** or **Details**, and select a PDF attachment. The PDF
opens inside the Task Detail surface with page and zoom controls; it does not open the browser's PDF
plug-in or download a copy. **Download** remains available as an explicit action. The same reader is
responsive on mobile and opening the authorised file continues to record the evidence view.

## v70 Team member workload review path

Open **Work → My Team**, select a person, then expand **Other workload**. Available work, overdue
routine occurrences, and current Goals are listed by name with compact context. Select any row to
open the exact record; closing it returns to the same person and Team filter. The lists remain
read-only context—record actions still depend on the existing Task/Goal capabilities and RLS.

## Current execution and Goal experience — v53

The Task engine now closes completion, cancellation and reassignment without leaving stale Barrier,
notification, Meeting Queue, focus or Shared projections. Major Project proposals use one lean
discussion flow: Agree creates Available work, while the owner still chooses activation. Generic
source links are module-neutral; no future ESH domain has been introduced.

Goals retain one versioned agreement record, but cadence is employee-level: one monthly session and
one quarterly session cover every Active Goal in the performance period. Plans may be built
gradually and finalize only at exactly 100%. Active revisions require an audited reason; completion
records the actual result for every success measure; cancellation records a reason and leaves the
allocation deficit visible. Health, actual-versus-target results and milestone execution are shown
separately, without a fabricated overall Goal percentage. Older v34/v50/v51 text below is historical
context where it does not conflict with this v53 section.

## v37 canonical reference

This revision is synchronized to the Product Owner's uploaded `index(20260807-072841).html`. That file is the canonical example-data, UI/UX, wording, design, function and flow reference for this baseline.

- Desktop: `desktop/index.html`
- Mobile: `mobile/index.html`
- Selector: `index.html`
- Authoritative product requirements: `MASTER_PRODUCT_SPEC.md`
- Detailed workflow logic: `PRODUCTION_LOGIC.md`
- Definition of done: `BUILD_ACCEPTANCE_GATES.md`

The mobile build uses the same example data and JavaScript behaviour as desktop; only the composition is forced into the approved phone layout.

The Product Owner's later task-detail screenshots and change brief supersede the v37 prototype only for task Overview, Checklist, evidence completion, due editing, Recent activity, and no-barrier presentation. All unrelated v37 reference behaviour remains approved.

## Purpose

This package is designed to be handed to Codex, Claude Code, or a development team to build TAMCO Focus locally as a complete production-oriented application.

The application must run on the local computer first. GitHub, hosted Supabase, and Vercel connections are intentionally deferred.

## Start here

1. `ONE_SHOT_LOCAL_BUILD_PROMPT.md` — paste or execute this as the main build instruction.
2. `MASTER_PRODUCT_SPEC.md` — authoritative product source of truth.
3. `PRODUCTION_LOGIC.md` — detailed workflow and transaction logic.
4. `AGENTS.md` — Codex/repository instructions.
5. `CLAUDE.md` — Claude Code project instructions.
6. `CHANGE_INTAKE_PROTOCOL.md` — how later updated specs and prototypes must be applied.
7. `BUILD_ACCEPTANCE_GATES.md` — objective definition of done.
8. `LOCAL_FIRST_BUILD_GUIDE.md` — local setup and later connection sequence.

## Visual references

- Desktop: `desktop/index.html`
- Mobile: `mobile/index.html`
- Selector: `index.html`

## Flexible future updates

The prompt is deliberately not a frozen list of product behaviour. The Product Owner may later provide updated Markdown files and desktop/mobile prototypes. The latest approved `MASTER_PRODUCT_SPEC.md` remains authoritative, and all changes must follow `CHANGE_INTAKE_PROTOCOL.md`.

## Current implementation direction

- Next.js App Router and strict TypeScript
- local Supabase for Postgres, Auth, Storage, migrations, and RLS
- local Git repository
- GitHub remote connected later
- hosted Supabase connected later
- Vercel deployment later

## Explicit local-fixture exception

The engineering standard prohibits fake production behaviour. Reproducible local-only seed users and test fixtures are explicitly required for development and tests. They must never be treated as production data.


## v34 review path

1. Switch the role to **System Admin — Administrator**.
2. Open **More → Settings → Users & accounts**.
3. Create a user, edit email/role/reporting manager, preview a weekly email, deactivate access, or test controlled deletion with a newly created history-free user.
4. Open **More → Weekly email summary** as a team member and as Izzul to compare the personal and manager versions.
5. Open **My Day**, **Work**, **Team Focus**, and any task drawer to review `Open`, current-state, `Overdue`, and `No update` indicators.

The HTML prototypes simulate these interactions. Production must implement the database, authentication administration, email worker, RLS, audit, and duration calculations defined in `MASTER_PRODUCT_SPEC.md` and `PRODUCTION_LOGIC.md`.


## V34 — Lean Goals prototype

Goals are a dedicated workspace separate from Calendar. The Goals prototype demonstrates manager-led one-to-one goal setting, employee contribution, weighted annual goals, milestone-based progress, short updates with attachments, linked work, team-goal visibility, leadership discussion preparation and weekly-email integration. The five sample goals supplied by the product owner remain the example goal set.


## V34 review focus

The Goal module was redesigned after the v31 layout was judged too dashboard-heavy and too form-like. Review **Goals** directly as both Amer and Izzul. The approved interaction is now a compact goal list, a manager people-to-goals master-detail view, a right-side goal drawer, and a one-minute progress update.


## V34 review path

1. Open **Goals** directly from the main navigation.
2. As Izzul, select **Team Goals**, Amer, and **Safety Digitalisation with Demonstrated Benefit**.
3. Use **Update** for the quick overall-goal update with slider, note and attachment.
4. Open **Milestones** to adjust progress inline, mark complete, or add comment/evidence.
5. Select **Edit milestones** to review the save-for-discussion and agree-changes workflow.
6. Open **Plan** separately to confirm the Calendar no longer contains Goals.


## V34 review path

1. Choose **Izzul — Manager**.
2. Open **Goals → Team Goals → Amer**.
3. Review Active, For discussion, Completed, and All filters.
4. Confirm the formal Active goal weight is 100% while the discussion goal is excluded.
5. Open **BR2 Warehouse ESH Readiness and Stabilisation → Milestones**.
6. Expand completed milestones, then update the current milestone.
7. Review the right-side check-in drawer, percentage slider and input, evidence, support request, and Mark complete option.


## v36 review focus

This package includes every v34 Goal improvement and adds the approved task Next action refinement. Open an Active task such as **First-aid box QR rollout** and review:

1. The **Next action** card in Overview.
2. Inline Edit, Set next action, and Mark done behaviour.
3. The information control beside Open/Active/Overdue age indicators.
4. Separate **What changed?** and **What happens next?** fields under Updates.
5. The current Next action displayed as an actionable Checklist item.


## v36 review focus

Open the application as **Izzul — Manager** and choose **Team**. Review the new Team Focus list, switch between Needs attention and Everyone, change sorting, then open a team member. The detail drawer demonstrates the exception-first manager workflow while preserving the v34 Goals and v35 Next Action changes.


## v38 task-detail review path

Sign in as `izzah@tamco.local` and open **Work → Operational Actions → Close out corrective actions from the June audit**.

1. Overview shows one quiet status/urgency/due/overdue/progress/checklist line; select the information control for detailed ages.
2. Select **Edit due**, review the current commitment, and verify the optional-reason change flow and readable Recent activity entry.
3. Use the compact Next Action card and the whole-row checklist preview.
4. In Checklist, confirm Current Next Action is pinned above the three permanent items and is not counted in `0 of 3 complete`.
5. Compare No evidence required, Evidence optional, and Complete with evidence actions. The required flow asks once for a file/photo/screenshot and optional completion note.
6. In Updates, verify due, Next Action, checklist, reopen, evidence, update, and progress changes show actor and timestamp.
7. Open a task with a real barrier to compare its red/pink alert with the normal neutral **Need help?** row.
