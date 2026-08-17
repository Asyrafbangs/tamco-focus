# Team visibility and performance repair impact map (v69)

## Change source

The approved change is the 17 August 2026 request to audit and repair Team end to end after
regressions in interaction, navigation, data visibility and responsiveness. This is an incremental
repair. It does not redesign Team or change task authority.

## Reproduced defects

| Area                       | Current behaviour                                                                                                                             | Root cause                                                                                                                                                                                              | Required repair                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Team roster visibility     | A profile readable only because it is the viewer's reporting manager can enter `team_load_summary`.                                           | The view relies on the broader `user_profiles_select` policy. That policy intentionally exposes the viewer's manager's profile for attribution, which is not permission to see that manager's workload. | Require `focus.can_view_user(profile.id)` in Team and team-focus projections.                                       |
| Administrator completeness | Existing tests prove the directory, but do not prove that Team returns every active user, including Izzul.                                    | The role matrix is not covered at the rendered Team boundary.                                                                                                                                           | Add database, integration and E2E assertions that an administrator sees every other active user and can open Izzul. |
| Explicit visibility        | Task-level collaboration can enter Team Available work even when the owner is not an authorised Team person.                                  | Available work is bounded only by task RLS. Task RLS correctly grants access to individual shared tasks, but that is not person-level Team visibility.                                                  | Intersect Available owners with the authoritative Team roster.                                                      |
| Restricted visibility      | A `none` or `specific_only` user can receive name-only access to their reporting manager and the workload projection does not distinguish it. | The workload view conflates attribution visibility with Team visibility.                                                                                                                                | Keep manager attribution readable while excluding it from Team rows, counts and drawers.                            |
| Query performance          | Team load performs repeated correlated task, routine, barrier and proposal counts for every person.                                           | `team_load_summary` contains many scalar subqueries per profile.                                                                                                                                        | Replace them with grouped aggregates joined once to visible active profiles.                                        |
| Server CPU                 | Attention derivation repeatedly filters all tasks, goals, focus rows and barriers once per person.                                            | O(people × records) array scans in `getTeamAttention`.                                                                                                                                                  | Build owner-indexed maps once and derive each person from its bucket.                                               |
| Repeated requests          | Opening a person starts Team load, focus and attention reads in both the page and drawer query.                                               | Shared server data access is not memoized per render request.                                                                                                                                           | Use request-scoped `React.cache` for Team load, focus and attention reads.                                          |
| Available work requests    | Owner names are fetched after `task_overview`, even though each row already carries the owner name.                                           | Redundant directory round trip.                                                                                                                                                                         | Reuse the authorised projection and roster name.                                                                    |
| Silent partial data        | Team detail and attention ignore several query errors and can render a false empty state.                                                     | Error results are mapped as empty arrays.                                                                                                                                                               | Fail into the existing route error boundary when an authoritative Team read fails.                                  |

## Affected implementation

- `supabase/migrations/20260817002000_v69_team_visibility_performance.sql`
  - authoritative Team/focus projection visibility;
  - set-based workload and focus aggregation.
- `src/server/queries.ts`
  - request-level memoization;
  - Available-owner intersection;
  - linear attention derivation;
  - explicit query failure handling.
- `src/app/(app)/work/page.tsx`
  - avoid the unused Available count request outside Team scope.

## Verification coverage

- `supabase/tests/rls_visibility.test.sql`: administrator, manager, explicit-grant and denied
  projection boundaries.
- `tests/integration/team-visibility-v69.test.ts`: real authenticated clients against local
  Postgres/RLS, including rule changes and restoration.
- `tests/e2e/team-visibility-v69.spec.ts`: administrator roster completeness, whole-row and named
  actions, exact nested actions, drawers, filters, focus return, desktop and mobile containment.
- Existing Team, user-directory, attention, RLS and full acceptance suites remain regression gates.

## Preserved behaviour

- Task, Goal, routine, barrier and checklist state transitions are unchanged.
- View permission still does not grant edit, activation, reassignment, approval or completion
  authority.
- Administrators retain organisation-wide visibility while business actions remain subject to the
  existing role/reporting-line capability rules.
- Task-level collaboration continues to expose the shared task in Shared and other authorised
  task surfaces; it no longer promotes the owner into My Team.
- Inactive accounts remain available to administrator history/audit surfaces but not the active
  Team roster.

## Local verification outcome

- The full acceptance pipeline passed SQL/schema execution, secret scan, formatting, lint,
  typecheck, 154 unit tests, production build/smoke, generated-type parity, 58 pgTAP assertions and
  142 integration tests after fresh database resets.
- The production Playwright suite passed 121 applicable tests across desktop, 1280 px, tablet and
  mobile projects; 28 project-inapplicable cases were intentionally skipped.
- On a retained 500-task fixture, the Team attention projection fell from roughly 2.4 seconds to
  0.3 seconds and the Team Available projection completed in roughly 0.3 seconds.
- Hosted Supabase and Vercel were not changed or inspected. Applying and validating this migration
  against hosted identities, including `izzul.asyraf@tamco.com.my`, remains a controlled deployment
  step outside this local-only repair.
