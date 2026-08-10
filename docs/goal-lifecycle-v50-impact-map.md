# Goal lifecycle v50 — implementation impact map

Date: 10 August 2026

Authority: the supplied “Goal Lifecycle, Monthly Check-In, Quarterly Review,
Exception Management, Progress Measures and Year-End Result” instruction. This
is an incremental extension of the approved v33–v35 Goal module.

## Existing authorities preserved

- `goals` remains the lifecycle/weight/health record.
- `goal_versions` remains the immutable agreement structure.
- `goal_milestones` remains a limited set of meaningful checkpoints, not tasks
  or success metrics.
- `goal_updates`, `goal_attachments`, `goal_support_requests`, notifications and
  audit events remain the evidence, support and history infrastructure.
- Existing private Storage, Goal RLS helpers, optimistic versions,
  idempotency, formal active-weight guard and linked Work behavior remain
  authoritative.

## Impact map

| Area              | Existing behavior                                                                 | Required lifecycle correction                                                                                                                                                 | Implementation boundary                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Success measures  | One narrative `success_measure` on each version                                   | Structured qualitative/numeric/percentage measures with targets, current values and history                                                                                   | Add version-owned measure and measure-update tables; backfill one qualitative measure for existing versions                             |
| Goal setup        | Two steps, one narrative measure, required milestones                             | Keep two steps; move weight into required expectation fields; add structured measure builder and clearer live allocation                                                      | Extend existing setup dialog and creation transaction; do not replace versioning                                                        |
| Active Goal       | Overview/Milestones/Updates/Evidence tabs, milestone-first percentage             | Progress/Check-in/Milestones/History, measures first and percentage secondary                                                                                                 | Recompose the existing drawer; keep setup fields under progressive disclosure                                                           |
| Monthly cadence   | Generic 30-day `checkin_due_at`, no submitted-period record                       | One employee monthly check-in per Goal/month, including “No material change” and optional explicit manager support                                                            | Add typed check-in rows and an idempotent employee-only RPC; reuse Goal update/evidence/support rows atomically                         |
| Quarterly cadence | None                                                                              | One employee/manager discussion record per Goal/quarter with employee summary, manager discussion, agreed actions and status                                                  | Reuse the typed check-in table and add a role-aware idempotent quarterly RPC                                                            |
| Year end          | Completion/close only                                                             | Traceable Result draft and refinable/final result using accumulated records                                                                                                   | Reuse typed year-end check-in row; build deterministic source summary in the read/service layer                                         |
| Performance state | `on_track`, `need_attention`, `support_requested`, `completed`                    | Employee wording `On track`, `At risk`, `Off track`; lifecycle status remains separate                                                                                        | Add forward enum values and map legacy states without rewriting historical rows                                                         |
| Exceptions        | Due check-ins, approaching targets and recent milestones can be manager attention | Normal monthly progress and manager-requested owner updates are not manager action; only at-risk/off-track/explicit support and submitted quarterly discussion are actionable | Add separate owner-action and manager-action flags; preserve reported health when requesting an update; update My Day/My Team consumers |
| Schedules         | One mutable timestamp                                                             | Deterministic monthly month-end and quarter-end dates from active agreement/target                                                                                            | Stable SQL schedule functions and read-model fields; no employee-specific hardcoding                                                    |
| History           | Updates, milestones, files and audit appear in separate areas                     | One chronological meaningful history                                                                                                                                          | Merge check-ins, measures, milestones, evidence, support and audit in the existing Goal detail read model                               |
| Permissions       | Goal viewer/updater/agreer capabilities                                           | Owner submits monthly; owner prepares quarterly; manager agrees quarterly/year-end; all enforced server-side                                                                  | New tables are select-only under Goal RLS; all writes remain security-definer RPCs with role checks                                     |

## Migration strategy

1. Add enum vocabulary in a dedicated committed migration.
2. Add tables, constraints, indexes and RLS without changing existing rows.
3. Backfill existing version narratives as qualitative success measures.
4. Add idempotent transactional RPCs for create-with-measures, monthly,
   quarterly and year-end operations.
5. Replace the security-invoker Goal overview with additive lifecycle fields;
   retain all existing columns for compatible clients.
6. Apply forward-only to local Supabase. Do not reset or link a hosted project.

## Verification

- Unit: schedule dates, measure status/progress, weight wording, exception rules,
  year-end source construction.
- Integration: activation with measures, monthly uniqueness/idempotency, no-change,
  quiet normal check-in, at-risk/support attention, quarterly uniqueness, year-end
  persistence and audit history.
- RLS: owner/manager/view-only boundaries for measures and check-ins.
- E2E: setup, active lifecycle tabs, monthly/no-change/support, quarterly,
  measure presentation, history, year-end, exact attention links and responsive
  desktop/mobile operation.
