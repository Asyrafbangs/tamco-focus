# ESH Finding Management — change intake

Source: `docs/specs/TAMCO_ESH_Finding_Management_Agent_Specification_v1.3.md` (v1.3, 19 September 2026) and `docs/specs/finding-management-visual-pack/` (16 design references). The zip also
carried v1.0 of the specification; v1.3 supersedes it where they differ (section 43 restricted
rollout, sections 31–42). Intake run under `CHANGE_INTAKE_PROTOCOL.md` on 19 September 2026.

## 1. Baseline — what the repository already has

| Area           | Existing                                                                                                                                                                                                  | Use for Finding Management                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Stack          | Next.js 16 App Router, React 19, Supabase Postgres/Auth/Storage, Vercel (Hobby, `sin1`), Supabase `ap-southeast-1`                                                                                        | Same stack; no second auth system or database                                                             |
| Tenancy        | Single organisation; no organisations table                                                                                                                                                               | Add `organizations` with one TAMCO row; every Finding table carries `organization_id`                     |
| Staff identity | `auth.users` + `user_profiles` (`role` = team_member / manager / administrator), `departments` (code, name, parent, head, status), reporting lines, visibility grants                                     | Staff Finding access keyed to `user_profiles.id`; departments reused for accountable department and scope |
| Email          | Office 365 SMTP transport (`EMAIL_TRANSPORT=smtp` on Production, `log` locally), `notification_email_deliveries` outbox, `scheduleNotificationEmailDispatch` after commit, daily cron worker with retries | Reused. Finding emails get their own outbox rows and templates; link intents minted at dispatch           |
| Jobs           | One Vercel cron, daily 01:00 UTC (09:00 MYT), running several workers; Hobby allows daily schedules only                                                                                                  | Finding follow-up worker joins it. Day-based timings fit; sub-day precision is not available (see §4)     |
| Storage        | Private `task-attachments` bucket, signed URLs, type/size validation; no malware scanning                                                                                                                 | New private `finding-evidence` bucket with the same controls; scanning is a missing dependency (see §4)   |
| Excel          | `src/lib/read-xlsx.ts`: dependency-free first-sheet reader, formulas read as saved values, never evaluated                                                                                                | Extended for sheet/header selection in the backlog import                                                 |
| Auth gate      | `src/proxy.ts` redirects every non-public path to `/sign-in`                                                                                                                                              | Guest routes (`/respond/*`) added to the public list; they carry their own guest-session check            |
| Naming         | Focus already has `routine_findings` (routine inspection findings)                                                                                                                                        | New tables use an `esh_` prefix so the two meanings never share a name                                    |

Production facts checked read-only on 19 September 2026: `izzul.asyraf@tamco.com.my` resolves to
exactly one verified, active account (currently a Focus manager). One active administrator
account exists, and it is not Izzul's. Three active departments.

## 2. Impact

| Aspect            | Previous                                 | New                                                                                                                                                                             |
| ----------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modules           | TAMCO Focus only                         | ESH Home (`/esh`) with TAMCO Focus and Finding Management; module switcher in shared chrome; Focus menu and routes unchanged                                                    |
| Who sees it       | —                                        | Nobody, until enabled: rollout mode Restricted, only the resolved Izzul identity seeded with organisation-wide visibility. Everyone else, staff and email contacts, starts Off  |
| UI (desktop)      | —                                        | Finding module: Overview, Register (open / needs attention / overdue / closed), Verification, New finding, finding detail; Settings (follow-up, weekly reports, import)         |
| UI (mobile)       | —                                        | Same screens responsive; guest pages mobile-first (owner chat, My Actions, escalation, recovery, report)                                                                        |
| Guest surfaces    | —                                        | `/respond/access`, `/respond/actions/[id]`, `/respond/my-actions`, `/respond/request-link`, `/respond/reports/[id]`; no platform chrome                                         |
| Domain / state    | —                                        | Finding (New → Open → Closed, plus Cancelled/Duplicate/Withdrawn with reason); Action (Assigned → In progress → Awaiting verification → Accepted); overlays: overdue, escalated |
| Data model        | —                                        | ~25 new tables (§21, §35, §42 of the specification), all additive, `esh_` prefixed, organisation-scoped                                                                         |
| Migration         | —                                        | Forward-only, additive. No existing table's behaviour changes until the Identity & Access refinement stage, which maps existing roles without removing access                   |
| Permissions / RLS | Focus roles and visibility               | Separate Finding permissions (Viewer / Coordinator / Verifier + department scope + report management); guest access only through server-validated sessions and grants           |
| Notifications     | Focus notices and emails                 | Assignment, reminders, escalation, submission, changes requested, replies, due/owner changes, verification, closure/reopen, weekly reports; rollout-held state                  |
| Audit             | `audit_events`                           | Every Finding mutation, access change, grant issue/redeem/revoke, dispatch                                                                                                      |
| Tests             | Unit, integration, pgTAP RLS, Playwright | FM01–FM108 mapped to tests stage by stage; fixtures are local only                                                                                                              |

## 3. Decisions taken under the protocol (no genuine conflict found)

1. **Izzul's initial entitlement is visibility only.** §43.1 grants organisation-wide read
   access and says it "does not automatically grant closure authority". There are no existing
   Finding capabilities to preserve, so creating, assigning and verifying need a Coordinator or
   Verifier preset. The administrator account grants these in Identity & Access. If Izzul should
   hold Verifier from day one, that is a one-line change to the seed and needs the Product
   Owner's say-so.
2. **Organisation model:** one `organizations` row, with the column on every new table and
   composite constraints, so FM10 (cross-tenant) is enforceable and tested with a second
   fixture organisation, without building multi-tenant administration nobody asked for.
3. **Focus roles stay where they are until the Identity & Access stage.** Finding permissions
   live in their own table from the start. The Role dropdown is replaced by Module access (§31)
   only in that later stage, with an explicit mapping and no loss of access.
4. **Guest data path:** browser → Next server action / route → guest-session check → `SECURITY
DEFINER` procedures that take the principal explicitly and re-check the live assignment or
   entitlement. Guest tables have no client grants at all. The service-role key stays server-side.
5. **Scanner-safe links:** GET never redeems. The bootstrap page shows one button (Open action /
   Open my actions) that POSTs the exchange. This is the specification's documented fallback
   (§19); it costs one tap in a fresh browser and needs no account, password or OTP.
6. **Due-time convention:** date-only due dates mean 17:00 Asia/Kuala_Lumpur (the
   specification's proposed default), stored as UTC instants, labelled as date-only.

## 4. Dependencies that are missing or limited — reported, not faked

| Dependency        | State                                                                 | What the build does                                                                                                                                                                                           |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malware scanning  | No scanning service exists (Focus attachments are not scanned either) | Evidence records carry scan state `not_scanned`, shown as such; allowed types are restricted and Office files are download-only. Never shown as "clean". Needs an approved scanner before claiming FM47 fully |
| Scheduler         | Vercel Hobby: daily cron only                                         | Follow-up evaluated once a day at 09:00 MYT; immediate events (assignment, submission, replies) dispatch after commit. Hour-level reminder precision needs a paid plan or an external scheduler               |
| Delivery webhooks | No production provider adapter or signing scheme has been selected    | v201 exposes an authenticated, idempotent provider-neutral callback and records acceptance, delivery, bounce and failure separately. Production still needs an approved provider adapter and secret           |
| Email prefetchers | Outlook Safe Links will prefetch                                      | Covered by decision 5; verified with a HEAD/GET that consumes nothing                                                                                                                                         |
| Backlog workbook  | Not yet supplied                                                      | Import is built against a representative 100-row fixture; real mapping happens when the workbook arrives                                                                                                      |

## 5. Stages

v197 is built and verified (19 September 2026). v198 is built and verified (20 September 2026). v199 is built and verified (20 September 2026): evidence is limited to 10 MB a file
(the Focus attachment limit and this deployment's storage ceiling), not the 25 MB default §23
suggests, and is never scanned. v200 is built and verified (20 September 2026).
v201 is built and verified (20 September 2026): owner updates and escalation responses now notify
the responsible ESH staff, while daily reminders and escalation use immutable assignment policy
snapshots and a maintained working-day calendar.
v202 is built and verified (21 September 2026): the Overview and department table share one scoped
definition, action-count drill-downs use action rows, closure periods affect only closed work, and
the authorized CSV neutralizes spreadsheet formulas without exporting private evidence links.
v203 is built and verified (21 September 2026): People & access is one directory with explicit
Focus, Finding and platform-administration facts; contact participation is derived from live work,
and resend, revoke, disable and selective email correction are audited and revoke stale access.
v204 is built and verified (22 September 2026): configured reports start as Draft, schedule in the
definition timezone, capture an immutable scoped snapshot, exclude restricted findings and deliver
one purpose-separated read-only link per enabled recipient. Pause stops future capture without
revoking an already issued report; version, scope and recipient changes invalidate stale access.

Each stage ships behind the rollout gate, so nothing new is visible to the team until an
administrator enables them. Each ends with the full verify and, where it adds a migration, a
`supabase db push`.

| Stage | Scope                                                                                                                                                                                                                | Acceptance scenarios              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| v197  | Organisation, rollout settings and entitlements (Izzul seeded), staff Finding access and scope, central guard; ESH Home and module switcher; Finding module shell with New finding, Register and detail on real data | FM01, FM02, FM101–FM104, FM108    |
| v198  | Email principals, secure grants and guest sessions, scanner-safe exchange, recovery, My Actions (two filters), owner conversation, owner email with two links, contact enablement                                    | FM03–FM15, FM40–FM45, FM105–FM107 |
| v199  | Private evidence, composer uploads and drop target, immutable submissions, withdraw/resubmit, evidence rules                                                                                                         | FM16–FM22, FM46–FM50              |
| v200  | Verification queue, side-by-side review, accept / request improvement / accept & close, reopen, due-date change and reassignment, closed register                                                                    | FM23–FM29, FM51, FM52             |
| v201  | Follow-up policies and settings, daily scheduler, owner reminders, escalation levels and entitlements, escalation email and response page, ESH review follow-up, delivery states, Needs attention                    | FM30–FM39                         |
| v202  | ESH Overview (four signals, department table), register filters and closure periods, export                                                                                                                          | FM54, FM67–FM69                   |
| v203  | Identity & Access refinement: Module access, contacts list and detail, resend / revoke / disable / correct email                                                                                                     | FM56–FM63                         |
| v204  | Weekly reports: definitions, snapshots, report-viewer links, leadership dashboard                                                                                                                                    | FM64–FM66, FM70–FM82              |
| v205  | Excel backlog import (map, stage, reconcile, release), risk and priority, bulk My Actions operations, consolidated emails and digests                                                                                | FM83–FM100                        |

## 6. Compatibility

- All migrations are additive until v203; v203 maps existing Focus roles to Focus presets with a
  recorded map and keeps the last administrator.
- TAMCO Focus routes, menus and deep links are untouched. Its users see no difference while
  their Finding access is Off, which is everyone but Izzul at first.
- No test finding or email reaches a real person: fixtures are local, contacts start disabled,
  and notification release is a separate deliberate act.
