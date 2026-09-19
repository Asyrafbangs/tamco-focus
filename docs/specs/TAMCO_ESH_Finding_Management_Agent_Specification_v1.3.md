# TAMCO ESH Platform — Finding Management Agent Specification

Version 1.3 · 19 September 2026

Revision 1.3 adds the mandatory restricted upgrade rollout: only the verified TAMCO identity izzul.asyraf@tamco.com.my is initially enabled to view all Finding Management data. Other users/contacts require explicit administrator enablement. Section 43 takes precedence over earlier availability and notification-release assumptions.

Revision 1.2 adds reviewed Excel backlog import, separate risk and action priority, two-filter My Actions, controlled bulk operations and consolidated owner/escalation notifications. Sections 38–42 govern these additions and supersede conflicting older descriptions/screenshots.

Revision 1.1 adds module-specific registered-user permissions, managed email-link contacts, an ESH overview, and scoped weekly leadership reports. Sections 31–37 define these additions and supersede conflicting earlier wording or version 1.0 screenshots. The core action/chat/verification workflow is retained.

Status: Consolidated implementation brief. This document specifies the requested build; it does not claim the application has already been implemented, inspected or deployed.

## 1. Agent instruction and decision precedence

Build Finding Management as a dedicated module in the existing ESH application, with a new ESH Home entrance and separate module navigation. Preserve the existing TAMCO Focus module and its workflows. Inspect the actual repository, project instructions, authentication, database, email service, storage and deployment boundaries before implementing.

This specification supersedes earlier Finding Management mockups where the Action Owner had a separate corrective-action form, upload section, completion checkbox, chat section and extension-request section. The accepted Action Owner interface is now one compact finding summary plus one conversation and one message composer.

The new email-access and My Actions requirements are mandatory. Do not replace them with standard application login, invitations to create accounts, passwords, an employee-registration prerequisite or Microsoft/Google sign-in. An internal record identifying an email recipient is necessary; a normal application user account is not.

Do not apply the older TAMCO Focus manager/employee redesign as part of this build. Preserve its actual existing navigation rather than implementing illustrative menu labels from concept screens. No duplicate Focus tasks are automatically created from findings.

Use the existing stack where appropriate. The conversation describes Next.js, React, TypeScript, Supabase/Postgres/Auth/Storage and an email service; verify actual versions and integrations rather than assuming them. This brief defines behavior and security boundaries, not a mandatory replacement technology.

Implement working frontend, server authorization, data persistence, private evidence, automatic follow-up, email delivery and verification together. Do not deliver mock backend behavior, hardcoded production findings or buttons that only change client state. Values labelled implementation defaults below are proposed starting settings, not previously approved company policy; keep them configurable and identify changes in the handoff.

## 2. Goal and non-negotiable principles

Replace Excel-based manual chasing with an accountable process in which the system follows up with the person who needs to act next.

- One ESH platform with focused modules on separate pages.
- ESH Home initially shows only TAMCO Focus and Finding Management.
- Switching modules replaces local navigation; it does not add another menu.
- Action Owners and escalation recipients use secure email links, without normal application accounts or login.
- One accountable owner per corrective action, identified by email.
- One conversation for updates, questions, evidence and ESH responses.
- Sending a message is different from submitting completed work for review.
- Only an authorized ESH verifier accepts corrective action and closes a finding.
- Reminders, escalation, audit records and the register update automatically.
- ESH review also has a follow-up target; the system must not keep chasing an owner whose submission is awaiting ESH.
- Preserve evidence and baseline deadlines; do not make performance look better by silently rewriting history.
- Deterministic workflow. No AI interpretation of chat is required to change status, due dates, ownership or approvals.

## 3. Scope

### Build now

1. ESH Home and shared module switcher, with entitlement-filtered cards/navigation and the restricted rollout gate in section 43.
2. Dedicated Finding Management module, including ESH finding creation, assignment and central register.
3. Chat-first Action Owner response page.
4. Email-only contact identities, secure-link grants and guest sessions.
5. My Actions: all currently open actions assigned to the verified recipient email within this organization.
6. Email-only escalation recipients at Levels 1, 2 and 3, supporting multiple recipients per level and extensible higher levels.
7. Private attachments, completion submissions, ESH verification, requested improvements and closure history.
8. Automated reminders, escalation and reliable notification delivery.
9. Controlled changes to owner/deadline, Excel import/export and operational verification.
10. Refined Identity & Access: registered staff module permissions and scoped email-link contacts; preserve TAMCO Focus behavior.
11. ESH overview by organization and department, with drill-down into the existing register.
12. Weekly leadership email summaries and secure read-only dashboards without accounts. Actual recipients and production schedules remain unconfigured until ESH sets them.
13. Excel backlog import with column matching, staged review and controlled notification release; action priorities, consolidated reminders and authorized bulk owner operations.

### Do not build now

- Public QR hazard-reporting forms or WhatsApp chatbot/ESH Hotline intake.
- Legal & Compliance, HIRARC, Chemical Management or other future modules.
- A separate standalone application, duplicate employee directory or replacement for TAMCO Focus.
- Timesheets, arbitrary efficiency scores, gamification or another dashboard full of KPI cards.
- Email reply ingestion. In this release email links lead to the conversation; replying to the email does not silently become an in-app update.

Keep an extensible report source and source reference so future QR/WhatsApp reports can enter ESH triage. Future intake must respect the separately agreed hazard/stop-work process. Finding closure does not authorize safe resumption of work; do not conflate those decisions or expand this release into that workflow.

## 4. Platform navigation and route boundaries

| Experience | Navigation |
| --- | --- |
| ESH Home | Two module cards, brief descriptions, profile; no module sidebar |
| TAMCO Focus | Its current local menu, unchanged; compact ESH Home/module switcher in shared chrome |
| Finding Management — ESH | Overview, Register, Verification; Closed is a Register filter with a stable deep link. Settings are secondary and permission-controlled. |
| Action Owner — single action | Finding summary, conversation, composer; no main platform sidebar or module switcher |
| Action Owner — My Actions | Simple list of the recipient's open actions; selecting one opens its response page |
| Escalation recipient | Only the escalated action context and permitted response controls; no team-wide access by implication |
| Leadership report recipient | Read-only report for explicitly shared departments; no platform sidebar or operational controls |

The two homepage cards are named TAMCO Focus and Finding Management. Do not rename TAMCO Focus to TAMCO Management. Do not display disabled cards for every future module.

Illustrative route contract; adapt to the existing router while preserving boundaries:

| Route | Boundary |
| --- | --- |
| `/esh` | Internal ESH Home using existing staff authentication/entitlements |
| Existing TAMCO Focus routes | Existing authentication, navigation and deep links |
| `/findings` | Authorized ESH Overview |
| `/findings/register` | Authorized ESH register, including open/closed filters |
| `/findings/new`, `/findings/{findingId}` | Authorized ESH creation/detail |
| `/findings/verification`, `/findings/closed`, `/findings/settings` | Authorized ESH functions |
| `/respond/access` | Publicly reachable secure-link bootstrap; no private data without a valid grant/session |
| `/respond/actions/{actionId}` | Guest owner or escalation access, checked per action |
| `/respond/my-actions` | Verified email owner-inbox scope |
| `/respond/request-link` | Rate-limited email access recovery; neutral response |
| `/respond/reports/{reportId}` | Purpose-specific report-viewer access; identifier alone gives no access |
| `/findings/settings/reports` | Authorized report configuration in secondary Settings navigation |

Preserve existing register deep links with explicit redirects/query translation. `/findings/closed` opens Register with Closed selected. Identity & Access remains shared platform administration, not another Finding sidebar.

Normal application authentication middleware must not redirect these guest routes to `/login`. Deployment-level SSO, preview protection, VPN requirements and hosting access gates must also be checked: a signed-out recipient must actually be able to reach the guest route. Do not solve a guest-access problem by making the entire internal application public.

## 5. Roles and authority

| Actor | Allowed behavior |
| --- | --- |
| ESH coordinator | Create/assign within scope, communicate, manage due dates/ownership, configure action escalation within permissions |
| ESH verifier | Review the current submission; accept action or request improvement; close findings when all requirements are met |
| Action Owner | See their authorized action and original evidence; send updates/files; submit completion; ask for changes in chat |
| Escalation recipient | See an activated escalation's relevant action context, reply/provide support and optionally acknowledge receipt |
| Administrator | Maintain access, policies, delivery configuration and contact corrections under audit; business viewing/verification requires explicit module permissions |
| Finding viewer — registered | Read findings within explicit Finding department scope; no mutations |
| Leadership report recipient — email link | Read approved report summary and permitted drill-down; no editing, verification, owner-inbox or automatic evidence access |

Use explicit permission checks rather than treating every manager or escalation recipient as an ESH verifier. ESH coordinators and verifiers may be the same staff role if existing policy allows, but an owner may not verify their own corrective action. If an ESH staff member is also the Action Owner, another authorized ESH verifier is required.

Guest owner and guest escalation scopes cannot close findings, accept evidence, alter official due dates, reassign owners or change escalation policies. Acknowledging an escalation is not completing or closing the action.

## 6. Finding and action lifecycle

Maintain a finding separately from its corrective actions. The common case is one finding with one action; the UI should not expose unnecessary hierarchy.

| Action state | Meaning | Next responsible actor |
| --- | --- | --- |
| Assigned | Required result, owner and due date established | Action Owner |
| In progress | Work/update activity has begun | Action Owner |
| Awaiting verification | Owner explicitly submitted a completed correction | ESH verifier |
| Accepted | ESH accepted that action's current submission | No further action on this action |

A New finding may exist before an action is assigned. The finding becomes Closed only through an authorized ESH closure transaction after all required actions are Accepted. For the one-action case, present one ESH button: Accept & close finding. It accepts the action and closes the finding atomically when eligible. For multiple actions, accepting an intermediate action does not close the entire finding.

Request improvement returns the affected action to In progress with Changes requested context. Preserve the rejected submission and verification reason. A substantive owner update may move Assigned to In progress automatically; opening an email or viewing a page must not imply work has begun.

Overdue, escalated, extension requested and changes requested are overlays/events, not competing lifecycle states. Open is a register grouping encompassing all nonclosed findings. Pending verification remains open.

Cancelled, duplicate and withdrawn records are administrative outcomes requiring a reason. They are not verified closures. Preserve an audit link when merging duplicates; never delete the original record to make counts match.

## 7. ESH creation and assignment

Keep the common form compact, with advanced settings collapsed.

Required information for assignment:

- Finding title and description; department/location; reported date and source.
- Original evidence where available. Finding risk uses the organization's established assessment method; action priority is a separate Urgent / High / Normal field, reviewed by ESH. See section 39.
- Required corrective outcome and completion-evidence instruction.
- One Action Owner email address.
- Due date/time and ESH reviewer or review group.
- An escalation policy, with recipient emails entered at Levels 1–3 as appropriate.

The owner email field must accept a valid address that is not already in the employee directory. No administrator-created account, employee ID, password or acceptance of a registration invitation is required. Directory autocomplete is optional assistance; free email entry is mandatory. Display the full recipient address before assignment so a typo is easier to catch.

Level 1, Level 2 and Level 3 each accept email-address chips, including recipients absent from the directory. Higher levels can be added through a collapsed advanced control. No organization chart configuration is a prerequisite. A configured hierarchy may suggest addresses; ESH confirms the actual action-specific route.

Allow Save draft if required fields are incomplete. Assignment must commit the action, recipient association, policy snapshot, due schedule, audit event and notification outbox record together. Email dispatch happens after commit. Failure to send email must not erase a saved finding.

Duplicate recipients at a level are deduplicated. Repeated recipients across levels receive one message for each distinct escalation stage, not accidental duplicates. Warn if the owner is also an escalation recipient; do not silently invent a superior.

If a risk class requires an escalation route, enforce that configuration at assignment. Otherwise allow an explicit No further escalation decision with reason. Do not require three invented addresses when only one legitimate escalation level exists.

## 8. Email-first identity model

Create a lightweight `email_principal` contact record internally. This is a recipient identity for permissions and correspondence, not a normal ESH/TAMCO Focus user account and not a user-facing registration process.

Identity requirements:

- Scope every principal to the organization/tenant.
- Preserve the entered email for display; maintain a validated canonical matching key.
- Trim surrounding whitespace, normalize the domain consistently and apply the organization's documented local-part comparison rule. Do not silently merge aliases, strip plus suffixes or collapse Gmail dots.
- Corporate local parts may be case-insensitive under the declared organizational rule; support this consistently during create, import, lookup and reassignment. Do not make ad hoc casing changes in different endpoints.
- Unknown addresses create contact records automatically on assignment or escalation configuration.
- Matching an address is not authorization. The recipient must possess a valid email-link grant/session, and the server must check the live assignment or escalation entitlement.
- An optional link to an existing staff user is metadata only; never elevate guest access because its email matches a privileged account.

Use a unique constraint on `(organization_id, canonical_email)`. A contact can own many actions and be an escalation recipient for other actions. Those relationships confer different permissions and must remain separate.

Changing an email address is a controlled identity/assignment change, not a harmless profile edit. Revoke affected grants, notify correct parties and preserve historical attribution. Never transfer every action to a new address simply because an unauthenticated form requests it.

A shared mailbox identifies the mailbox, not an individually verified employee. Audit must accurately show the verified email and any separately captured display name without claiming the latter is proven identity. Recommend individual work emails for accountable actions; do not force account creation to compensate.

## 9. Two links in Action Owner emails

Every owner assignment email and owner action reminder includes:

1. **View finding & respond** — opens the specific assigned action with action-scoped authority.
2. **View All My Actions** — opens the verified recipient's owner inbox, containing all currently open actions assigned to that email within the organization.

These are separate grant scopes, not the same token with a different URL parameter. Both are delivered only to the owner recipient. Consuming one must not automatically consume the other. A digest can use one inbox link plus action-specific links as appropriate.

| Grant | Resource scope | Result |
| --- | --- | --- |
| `owner_action` | One action and its current assignment version | Read/respond/submit on that action |
| `owner_inbox` | One email principal within one organization | List currently owned open actions and access each permitted owner action |
| `escalation_action` | One action, recipient and activated escalation entitlement | Read relevant context and comment/acknowledge; no owner submission or ESH closure |
| `report_viewer` | One report-recipient entitlement, permitted snapshot/live scope and authorization version | Read approved summary/drill-down only; see sections 32–35 |

Never authorize `/respond/my-actions?email=someone@example.com` from the query value. The inbox identity comes from the verified server session. An action-only session cannot automatically become inbox-wide access by changing the route.

Inside an action page, My Actions returns directly when the session already has owner-inbox scope. Otherwise it offers Send me my actions link, delivering a new inbox grant to the already identified assigned email; it does not silently widen the current grant. The original email's View All My Actions link provides direct inbox access without this step.

An inbox session includes newly assigned actions dynamically while valid, since its purpose is all current ownership for that email. Live assignment checks immediately exclude reassigned/cancelled/accepted actions from the open list. This is intentional scope, not a static list baked into the token.

## 10. My Actions page

Use a simple standalone guest page, not the ESH dashboard or TAMCO Focus My Work page.

Header: TAMCO ESH · My Actions. Show the verified email in a compact account context and an End access control suitable for shared devices. Do not show a profile setup wizard, sidebar, modules or administrative menus.

Each row contains:

- Finding reference and concise action/finding title.
- Location/department where helpful.
- Action priority, due date or explicit overdue age, and latest meaningful update.
- Status, including Awaiting ESH review or Changes requested.
- Whole-row click to the authorized action conversation.

Use two filters: Needs my action (default; Assigned/In progress including Changes requested) and Awaiting ESH review. Within Needs my action, sort by Urgent / High / Normal, then earliest official due date, then stable action ID. Overdue is highlighted but does not outrank a higher priority by itself. All open actions are included regardless of creation date; do not apply a recent-time cutoff. Keep pending-verification work visible in its filter and label ESH as the next actor. Show both filter counts; add search when useful and paginate without truncating results. See section 40 for controlled multi-selection.

Example content supplied by the user, for test/demo use only:

- F-001 — Machine Guard Missing — Due 20 Sep.
- F-008 — Blocked Emergency Exit — Overdue.
- F-012 — Chemical Label Missing — Due 25 Sep.

If a finding has two actions owned by the same person, distinguish each action; do not collapse away an outstanding responsibility. The header count must match actions, not a mixture of findings and messages.

Empty state: You have no open actions assigned to this email. No other employee's actions are suggested. Query errors must not display a false empty state. On clicking a row, recheck assignment rather than trusting a previously rendered list.

## 11. Accepted Action Owner UI: one conversation

Only three visible areas are needed:

1. Compact header: finding reference/title, location, required outcome, due date, status and ESH contact. Original finding/evidence expands inline.
2. One conversation: messages, photos/documents and concise system events.
3. One composer: message, Attach, Photo, Send update and Submit for review.

Remove the previous separate Your corrective action form, separate permanent upload box, completion declaration checkbox, separate Action Chat form and separate extension/reassignment request section. Do not replace them with tabs.

Use the whole conversation/composer surface as a file drop target with a clear temporary highlight. Attach and Photo remain visible for mobile/keyboard users. No upload overlay should interfere with normal text selection or clicking controls.

Messages can include text, one or several attachments, or both. Display sender role, email/name appropriately, timestamp and upload/delivery state. Render messages in time order; maintain scroll position while reading older messages. Fetch earlier messages progressively, with the required outcome always easy to retrieve.

No guest menu should expose ESH Home or TAMCO Focus. A My Actions back link is local guest navigation subject to the scope rule in section 9, not a main application login.

## 12. Message versus completion submission

| Control | Behavior |
| --- | --- |
| Send update | Save message/attachments; action remains owner work unless already awaiting verification |
| Submit for review | Save the final message/evidence if not yet sent, create an immutable submission and move action to Awaiting verification |

The action-specific evidence instruction determines eligibility. Default new corrective actions to a short result description plus at least one qualifying file. ESH may configure an evidence exception for work without meaningful file proof, with a reason; the owner cannot bypass a file-required rule by typing Done.

Submit the current draft when it contains the intended final result. If the final update was already sent, reuse that specific message and its attached files: show a small inline indication of which update will be submitted. Prefer an explicit message reference selected by the owner or the current session's just-sent update. Never guess that the latest arbitrary message is the final correction, and never silently combine unrelated old messages to pass validation.

If evidence is incomplete, explain the missing requirement beside the composer. Do not open a duplicate corrective-action form. Selecting an existing relevant file/message should not require re-uploading or rewriting it.

Submission is an explicit completion declaration recorded by the button action; no second mandatory checkbox or confirmation modal. The owner never sees Close finding.

After submission, show Awaiting ESH review, record an event in the conversation, hide/disable repeat submission and keep ordinary conversation available. New chat messages do not replace the review snapshot. To materially revise a pending submission, the owner withdraws it through a secondary action and resubmits; preserve the previous version and notify ESH. Never allow ESH to accept a superseded snapshot.

## 13. ESH chat, changes and closure

ESH sees the same action conversation, with appropriate internal controls around it. Avoid rebuilding the owner's multi-section form for ESH.

When reviewing, make original condition and the submitted correction easily comparable side by side on desktop and stacked on mobile. Show the submission version, owner completion declaration, evidence and required outcome.

ESH actions:

- Send a message or clarification.
- Request improvement with an explicit explanation.
- Accept corrective action; for the final/only action, Accept & close finding.
- Change due date or reassign through a secondary menu, with reason and audit.

Acceptance records verification method, concise result, verifier and verified time. Methods can include photo/document review, site verification or another documented method. Evidence is not automatically accepted because a photo exists. Site checks remain available where necessary; this system reduces administrative chasing, not verification responsibility.

ESH may request further work after inspecting evidence. Return the action to In progress, preserve the old submission, notify the owner and explicitly retain or revise its deadline. The system must not quietly restart the deadline.

Reopening a closed finding requires authorized ESH action and a reason. Preserve original closure, accepted submission and later reopening events. Reopen the affected action(s), restore owner visibility/follow-up and issue new grants as needed; do not reactivate previously revoked security grants.

## 14. Requests for more time or a different owner

An owner asks naturally in the conversation, for example: Can we extend this to Friday? ESH can reply there and use Change due date or Reassign from the action menu.

The chat message itself does not change the official due date or owner. No AI parses it into an approved change. The explicit ESH action records the reason, old value, new value, actor and time, and posts a system event visible to the owner.

Reassignment is transactional: end the prior ownership interval, create the new one, increment assignment version, revoke obsolete action grants and permissions, update the inbox results, recompute notifications, preserve history and notify the new owner. A principal-wide session held by the old owner can continue to access their other actions, but not this reassigned one.

Keep baseline due dates and revisions. Approved extensions change future follow-up schedules but do not erase past late submission or escalation history. A new owner does not inherit authorship of earlier messages or declarations.

## 15. Escalation recipient experience

ESH only needs to enter recipient email addresses, not register supervisors as users or build an organization chart first. The system sends each recipient their own escalation email and their own scoped secure link when that level activates.

The email explains: which action is overdue, original owner, due date, current escalation level and what support is requested. The link opens that action's compact context and conversation. Recipients can respond or acknowledge; they cannot submit as the owner, approve extensions, reassign or close solely because they are escalation points.

Do not copy the owner's access URL into an escalation email. Do not send a group email containing one bearer link shared by all recipients. Do not expose the owner's My Actions inbox to supervisors through escalation.

Unactivated future-level recipients do not receive early access merely because their addresses were configured. Activating a level creates recipient-specific entitlements, audited with the policy version. Multiple recipients at the same level are supported. Removal from a route or explicit revocation removes access as well as stopping future notification.

If a person separately owns actions and also receives escalations, their owner inbox still contains only owned actions. A future My Escalations list is optional and outside the minimum release; do not mix escalated items into My Actions as if assigned ownership changed.

## 16. Follow-up policy and timers

Store a versioned policy and snapshot the applicable rule set on assignment. Settings can vary by risk/priority, subject to ESH authority. Do not hardcode one timing rule as safety policy for all findings.

Implementation example defaults, for configuration review:

| Event | Example timing |
| --- | --- |
| Owner pre-due reminder | Two calendar days before due date |
| Due-day reminder | Due day at configured notification time |
| Overdue owner reminder | Every two calendar days |
| Level 1 | One calendar day overdue |
| Level 2 | Three calendar days overdue |
| Level 3 | Seven calendar days overdue |
| ESH review reminder | Two working days after submission |

Timezone defaults to Asia/Kuala_Lumpur. Store instants in UTC. If due dates are date-only, define the local due time explicitly; proposed default is 17:00. Clearly label date-only versus exact-time policy in settings. Working-day rules use a maintained organization calendar; do not silently call Monday–Friday a Malaysian holiday-aware calendar.

The scheduler follows outstanding responsibility:

- Assigned/In progress: owner reminders and owner-route escalation.
- Awaiting verification: stop owner-completion reminders/escalation and start reviewer follow-up.
- Accepted/Closed/Cancelled: stop outstanding-action timers for the affected action.
- Changes requested or withdrawal: resume owner follow-up against the explicitly applicable deadline.

Preserve lateness at submission separately from current pending-review duration. A pending-review action can have been submitted late without requiring another owner completion reminder.

Escalation does not change ownership or the verifier. Notify ESH when the final configured level has been reached and remains unresolved; do not continue inventing levels. Delivery failure does not falsely count as a successful escalation notification; record triggered, queued and delivery outcomes distinctly.

Revalidate live status, due date, recipient membership and policy revision immediately before dispatch. Invalidate stale jobs after submission, closure, reassignment or extension. A provider email already accepted before a status change cannot be recalled; its link must always display live state.

Avoid reminder storms after downtime. Implementation default: coalesce missed routine reminders and send the highest currently due escalation level with history of skipped stages, rather than replaying every missed email. Keep this policy explicit/configurable. Critical operational alerting is a separately defined process, not an assumed property of reminder email.

## 17. Notification delivery contract

Use a transactional outbox with background dispatch, idempotency, retries, provider correlation and webhook handling. Scheduled workers must operate without anyone opening the application. Reuse existing email infrastructure if it meets the requirements.

Persist notification states such as queued, processing, provider_accepted, delivered, bounced, failed and suppressed. Mark delivered only with supporting provider evidence; do not claim that provider acceptance means the person read or acted on it. Do not use email-open tracking as acknowledgment.

Required notifications: assignment, owner reminders, escalation stages, ESH review submission, changes requested, ESH replies, meaningful owner replies, approved deadline/ownership changes, verification reminders and closure/reopening. Deduplicate repeated worker runs and avoid notifying the message author about their own message. Bundle routine conversation updates where appropriate without delaying formal submission or escalation events.

Each recipient receives personalized links based on their role. Disable access-link click tracking/rewriting under our email provider's control. Keep email content minimal; detailed evidence stays behind access checks. Support readable Outlook, Gmail and mobile layouts with HTML and plain-text versions.

Single-action owner email content: finding reference/title, required action summary, due date, View finding & respond, View All My Actions, ESH contact and a short note that ESH verifies closure. For imported assignments and routine reminder digests, section 41 applies: one compact summary per owner with an owner-inbox link and eligible action links. Aggregation changes delivery, not per-action obligations or permissions. No Create account, Set password or Login button. Label the mailbox as unmonitored for replies if reply ingestion is not implemented, and direct users to the conversation.

Bounces and persistent failures appear in an ESH Needs attention queue with the address and corrective action, such as correct email/resend. They do not silently look like employee noncompliance. Resending must recheck current permissions and issue appropriate fresh access grants.

## 18. Passwordless guest security model

Email-link access is authentication by possession of a secret delivered to the mailbox. It is not anonymous access and is not identity proof beyond mailbox control. Forwarding an unredeemed link can transfer its authority; never promise forwarded links are intrinsically safe. Limit scope, lifetime and reuse and make revocation effective.

Use cryptographically random opaque secrets with at least 256 bits of entropy, secure hash/HMAC storage, explicit purpose/scope, principal, organization, optional action/assignment version, expiry, consumption and revocation state. IDs or email addresses are not secrets. Do not make a permanent URL that authorizes solely from an email query.

Exchange a valid link for a server-managed guest session. Keep session secrets in secure cookies with HttpOnly, Secure and an explicit SameSite policy appropriate to email entry. Use separate guest and staff authentication contexts; a guest grant must never overwrite, impersonate or elevate a staff login. Protect cookie-authenticated mutations against CSRF and session fixation. See [OWASP Session Management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) for these session controls.

Implementation defaults: emailed bootstrap grants expire after 24 hours; an on-demand replacement link after 30 minutes; a guest session has a 12-hour absolute lifetime and 2-hour idle lifetime; signed file URLs expire after at most five minutes. These are configurable product defaults, not values mandated by the reference material. Use shorter policy where appropriate, but never silently create permanent login links.

All private reads and writes recheck live authorization. Revocation is effective server-side, including websocket subscriptions, file URL issuance and inbox/detail endpoints. An unexpired guest cookie is not sufficient if assignment has changed.

Protect bootstrap and response pages with TLS, no-store/private caching, noindex, a restrictive content policy and Referrer-Policy: no-referrer. Redact token-bearing URLs from application/proxy/error/analytics logs and avoid third-party resources on the bootstrap page. Remove the secret from the address bar after exchange. Never store link or session secrets in localStorage.

Use approved configured application origins for generated URLs and redirects. Do not trust request Host or user-provided return URLs. A destination must be allowlisted and authorized for the grant. Apply rate limits to token exchange, link requests, uploads and messaging without enabling easy permanent denial of service against a recipient.

## 19. Link redemption, scanners and recovery

Normal intended UX: click the email link, establish the scoped guest session and open the requested action or My Actions. No password, account enrollment or standard application login.

Do not redeem or consume a token on a GET/HEAD request. A safe landing/bootstrap request must not accept findings, send messages, acknowledge work or change business status. Email security scanners may prefetch links, a problem explicitly described in [Supabase's email template documentation](https://supabase.com/docs/guides/auth/auth-email-templates#email-prefetching).

Preferred implementation: safe bootstrap GET followed by a CSRF-protected browser POST exchange with atomic single-use redemption and session creation. Use an established, reviewed implementation of the cryptographic/session primitives. Do not assume a JavaScript POST defeats every scanner: some execute scripts.

Provide a scanner-safe fallback: a compact Open action / Open my actions button that performs the exchange through user interaction, without requesting email/password or account registration. Use it if required by the tested email environment. This may add one tap in a fresh browser; returning recipients with a valid appropriately scoped session go directly to their destination. Document that small tradeoff rather than bypassing token protections to simulate unconditional one-click access. Do not turn the fallback into a normal login page or add a mandatory OTP to every visit.

Single-use redemption must be atomic. Handle response loss with a narrowly scoped, short idempotent exchange receipt tied to the same bootstrap/browser challenge; it must not permit unrelated-browser replay. Subsequent use from an existing authorized session can navigate without reusing the consumed secret. A different browser gets a neutral expired/used-link recovery page.

Recovery offers Send a new link. A recognized expired link can identify the destination internally; otherwise ask only for email. Respond consistently whether or not the address has assignments, and do not disclose action counts/titles before verification. Send only to the stored/canonical eligible address; never to a replacement address supplied with a stolen token. Rate-limit email requests to prevent mailbox flooding. These recovery principles adapt [OWASP token and enumeration guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html); this module is not a password-reset workflow.

Generating a replacement must not globally invalidate all other action grants and lock out legitimate users through repeated unauthenticated requests. Revoke the specific replaced grant where justified, or enforce a safe bounded active-grant policy. Security revocation and contact deactivation can invalidate all principal sessions explicitly.

Test both links in the same email independently, old email links, browser refresh, private browsing, mobile email webviews, Outlook Safe Links/prefetch, expired links and session expiry while composing. Preserve a draft safely across reauthentication in the same tab without exposing it to another identity; clear guest state when a different principal uses the browser.

## 20. Authorization and data access boundary

Recommended architecture: guest browser → guest API/backend-for-frontend → validated guest session and action entitlement → narrowly scoped repository/DB operations → private storage. Existing internal staff APIs remain protected by staff authentication and role checks.

For reporting, use the same boundary with a report entitlement and scoped report repository rather than requiring an action assignment. Report-viewer access never bypasses the centralized guard.

Do not require a Supabase Auth user for each contact merely to satisfy a foreign key. Keep guest email principals independent of `auth.users`. Reusing approved managed passwordless primitives is acceptable only if there is still no account-enrollment requirement and no accidental normal-app entitlement.

Never expose a service-role credential to the browser. If a trusted server credential bypasses RLS, each guest operation must use a centralized authorization guard and tenant/action predicates; direct client table access remains denied. Prefer narrowly granted DB roles/functions or a reviewed equivalent. RLS and staff policies must not accidentally grant anonymous broad reads because the guest interface exists.

For every action or attachment request, validate:

1. Session/grant is valid, not expired/revoked and belongs to this organization.
2. Scope permits the operation, not just reading the page.
3. Live ownership assignment or activated escalation entitlement applies.
4. The referenced message/file/submission belongs to that permitted action or its expressly shared original-finding evidence.
5. Lifecycle allows the operation; for example, a cancelled action cannot accept completion.

Multiple-action findings must not leak another owner's conversation, files, email addresses or internal discussions. Action conversations are action-scoped; ESH can see the whole finding according to role. Shared original finding evidence is exposed only when explicitly relevant. Keep internal-only notes outside guest-visible serialization if existing functionality includes them.

Closed actions leave My Actions. A previously authorized single-action owner can see a read-only closure receipt for a configured short retention window, proposed 30 days, with a fresh eligible receipt link if needed. This must not restore write rights or former-owner access after reassignment. A closed action URL is never a public closure certificate.

## 21. Data model

Logical entities below may map onto existing tables. Use real migrations, foreign keys, constraints and indexes; do not add parallel tables duplicating suitable current infrastructure.

| Entity | Core data and invariants |
| --- | --- |
| `email_principals` | ID, organization, display/canonical email, optional name/staff reference, active/revoked status, identity version; unique organization/email key |
| `findings` | ID/reference, organization, title/description, source/reference, report date, location/department, risk assessment level/method/version/assessor/time, original evidence associations, lifecycle, created by, closure metadata, row version |
| `finding_actions` | Finding FK, action title/required outcome, priority (Urgent/High/Normal), priority decision/override history, current owner principal, current assignment version, state, baseline/current due date, evidence rule/instruction, ESH reviewer/group, policy version, current submission, row version |
| `action_assignments` | Action, principal, start/end, assigning actor, reason, version; at most one current owner per action |
| `action_escalation_recipients` | Action/policy version, ordered level, recipient principal, active interval and metadata; duplicate level/principal prevention |
| `escalation_entitlements` | Action, activated event/level, principal, activated/revoked timestamps, permitted operations |
| `action_messages` | Action, author actor kind/ID/email snapshot, role at event, body, visibility, sent time, edit/correction metadata, client idempotency key |
| `evidence_assets` | Organization, private object key, original name, verified type/size, content hash, uploader actor, upload/scan states, retention/deletion state |
| `evidence_links` | Asset association with original finding, action/message or submission; server validates authorized relationship |
| `action_submissions` | Action, monotonically increasing version, owner/assignment snapshot, source message IDs, immutable result/evidence snapshot, submitted time, baseline/current due snapshots, state/superseded/withdrawn metadata |
| `verification_events` | Submission version, verifier, accept/request-improvement decision, method, note, timestamp; verifier cannot be action owner |
| `due_date_changes` | Action, old/new due, baseline reference, reason, actor, time and policy revision |
| `followup_policies` | Organization/name/version, risk applicability, timezone/calendar, reminder offsets, escalation level thresholds, review timers, quiet hours/catch-up behavior |
| `followup_events` | Action, obligation kind, stage/cycle, due trigger, policy/assignment revision, scheduled/triggered/suppressed state |
| `email_access_grants` | Principal, organization, purpose/scope/resource, assignment/entitlement version where applicable, token hash, expiry, consumption/revocation, issuer/outbox correlation |
| `guest_sessions` | Session hash, principal, organization, explicit capabilities, issued/last-used/absolute-expiry/revoked times and safe exchange correlation |
| `notification_outbox` | Business event, recipient, template, authorized link intents, state, retry schedule, provider idempotency/correlation; no permanent raw bearer tokens |
| `delivery_events` | Provider accepted/delivered/bounced/failed events, verified webhook identity, timestamps and error detail without secrets |
| `audit_events` | Immutable actor/organization/resource/event, before/after or version references, timestamp and correlation |

Store authorship snapshots separately from mutable current owner/contact data. New assignments never rewrite history. Numeric human references such as F-001 are display identifiers, not authorization tokens.

Use composite tenant/resource relationships or equivalent constraints to prevent cross-organization linking. Index current actions by organization/owner/state/due, submissions by action/version, messages by action/time, follow-up triggers by state/time, and grant/session hashes uniquely. Enforce one active submission per action and prevent simultaneous verification of different versions.

## 22. Notification secrets and transaction design

Create outbox link intents when the business transaction commits. Mint recipient-specific grants at dispatch, with expiry based on actual send time. Do not store plaintext bearer tokens permanently in the database or serialized error payloads.

When an email provider retry requires identical content, retain the dispatch payload only in encrypted restricted transient storage with a documented TTL, or use a reviewed short-lived deterministic issuance mechanism with versioned server keys. Purge raw token-bearing payloads when no longer needed. Store durable hashed grants and provider identifiers for auditing.

Dispatch retries must not create unlimited valid links. Use stable outbox idempotency and provider keys where supported. Ambiguous provider timeout is not proof of failure or delivery: retry/reconcile according to provider capabilities and avoid duplicate escalation messages.

The following changes require transactionality or an equivalent recoverable state machine:

- Assignment + ownership interval + policy schedule + audit + outbox.
- Submit final message/evidence snapshot + action state + owner-timer cancellation + ESH review timer + audit + notification.
- Request improvement + submission decision + resumed owner responsibility + deadline decision + notification.
- Accept action + final finding closure when all required actions accepted + timer cancellation + audit + notifications.
- Reassignment/deadline change + revision + access/job invalidation + notification.

Use idempotency keys for messages/submissions and expected row/submission versions for concurrent changes. A double-click cannot create two submissions or notifications. Closure must lock/recheck all required actions so a simultaneous new action or resubmission cannot be bypassed.

## 23. Evidence handling

Files are conversation attachments and reusable evidence, not a second upload workflow. Preserve original versus corrective evidence associations and link a submission to specific assets/message versions. A later message/file deletion cannot silently remove accepted proof; use controlled retention/deletion behavior with visible audit tombstones.

Support approved business formats including JPEG/PNG/HEIC, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, CSV and TXT if the pipeline can safely process them. Explicitly reject unsupported/executable/script/active-content formats. Do not advertise unsupported formats. Video is outside initial scope unless already required by the existing application.

Implementation defaults: 25 MB per file, 10 files per message and 100 MB total per message; configurable within actual infrastructure limits. Reusing evidence by reference does not transfer duplicate bytes.

Validate extension/content/MIME, sanitize names, scan via the actual approved malware service, enforce organization quotas, protect downloads and prevent unsafe inline content rendering. Do not fake successful scan states when the service is absent. Treat the scanning integration as a deployment dependency.

Show each file as uploading, processing, ready, failed or rejected, with Retry/Remove. Preserve successful files when another fails. Do not allow Send/Submit to imply all selected files were attached when any are still pending/failed; require retry or explicit removal. Final submission additionally validates the configured evidence requirement server-side.

Images/PDFs preview safely where supported; Office files have authorized download fallback. Preserve original evidence quality. Do not send private documents to a public preview service without an approved integration. Signed file links are short-lived and issued only after entitlement checks; already issued links may remain usable until their short expiry, which is a known revocation limit.

Keep uploads bound to the session principal and action. Guessing another asset ID must not allow attaching or downloading it. Clean abandoned uploads asynchronously without deleting committed evidence.

## 24. Central register and ESH review UI

Overview is the default ESH entry, with four compact signals and one department table defined in section 33. Register offers All open / Needs attention / Overdue / Closed filters. Verification remains a dedicated queue. Closed is not a fourth top-level menu item. Overview counts link into the same canonical Register/Verification queries.

List content: finding reference/title, owner(s) with action count where needed, department/location, current action state, due date, escalation indicator and last meaningful update. Expand to action detail and conversation. Automatic reminder events do not count as a meaningful owner progress update.

Needs attention includes unassigned findings, overdue owner actions, delivery failures and overdue ESH verification. Distinguish who needs to act. Verification shows current submissions only, not withdrawn/superseded ones. Closed defaults to last 30 days with 60/90 days, year and custom range filters; open findings have no arbitrary recent-time cutoff.

Maintain reported, owner-completed/submitted, ESH-verified and finding-closed timestamps separately. Finding counts and action counts must be labelled accurately. Use the same canonical queries/filters for list totals, exports and detail results.

Before/after comparison is accessible at verification and in closure history; the guest interface remains the compact chat view. Do not force every owner to see management reports, escalation configuration or detailed verification forms.

## 25. Suggested server/API contracts

The implementing agent chooses exact routing conventions. Preserve these capabilities and checks:

| Capability | Required authorization/behavior |
| --- | --- |
| Create/update/assign finding/action | Internal ESH permission, tenant scope, input validation and transaction |
| Bootstrap/redeem/recover email access | Purpose-specific grant validation, anti-enumeration, replay/CSRF/rate-limit protection |
| Get My Actions | Server principal from owner-inbox session; live owned-open predicate and pagination |
| Get action/conversation | Owner/inbox or activated escalation entitlement; action-scoped guest serialization |
| Begin/finalize upload and issue download | Same resource authorization, server file readiness and private storage checks |
| Send message | Permitted live participant; idempotency and authorized files |
| Submit/withdraw completion | Current owner only; exact source messages, immutable snapshot and concurrency checks |
| Accept/request improvement/close/reopen | ESH verifier scope, exact submission version, segregation of duties, required-action gates |
| Change deadline/reassign | Authorized ESH, reason/history, invalidate stale access/jobs |
| Configure policy/route | Authorized ESH/admin; validate levels, recipient emails and policy version |
| Follow-up worker/delivery webhook | Service authentication, verified signatures, idempotency and safe state reconciliation |
| Import/export | Authorized ESH, validation/preview/confirmation, audit and privacy scope |
| Manage staff permissions/email contacts | Explicit access-management authority, scope ceiling, audit and revocation |
| Get overview/department drill-down | Internal Finding scope or report-viewer entitlement; totals and rows use the same authorized dataset |
| Configure/preview/activate reports | Report-management authority and delegable scope; preview does not send |
| Generate/send weekly snapshot | Service authentication, versioned scope, recipient revalidation and idempotent delivery |
| Open/recover report link | Purpose-specific report entitlement; no implicit owner/escalation/staff privileges |

All errors must be actionable without leaking another principal's existence or information. Private endpoints use no-store responses; do not cache one owner's HTML/API data under a shared route key. Realtime subscriptions require the same boundaries as REST/server actions.

## 26. Excel migration and data quality

Support a previewed import of existing findings/actions: references, descriptions, owner email, department/location, due date, original status, original dates and evidence references where available.

Flag duplicate references, invalid dates, invalid/missing owner emails, uncertain historical status and inaccessible attachments. Do not silently assign to guessed email addresses or mark Excel rows Closed solely because a loosely worded comment says Done. Preserve legacy reference and source provenance.

Imported closed records retain their historical evidence/verification provenance; missing verification is marked as legacy/unverified rather than invented. Open imports generate no emails during preview or staged import. Import and Release notifications are separate operations; after ESH reviews the imported assignments, release one consolidated assignment summary per owner. Section 38 specifies reconciliation, duplicate prevention and unresolved-row handling.

Export the authorized register with before/after descriptions, action owners, baseline/current due dates, submission/verification/closure dates and escalation state. Protect spreadsheet exports against formula injection in user-entered text. Exported evidence links must not become permanent public links or carry unrestricted guest login tokens.

## 27. Operational and interface quality

Use one design language across ESH modules, with isolated module menus. Support mobile first for guest pages, readable text, large touch targets, keyboard controls, descriptive attachment labels, visible focus and accessible error/status announcements. Do not make required actions hover-only.

Provide useful loading, empty, expired/revoked access, upload failure, offline/draft and stale-version states. Preserve unsent content when possible across transient failure. Do not promise offline submission unless actually implemented. On session expiry, reauthenticate through email and retry safely; never silently discard or submit as another email identity.

Allow users to End access on shared devices. Do not show another recipient's previous cached action after identity change, browser back or logout. Distinguish a staff session from a guest identity when both exist in one browser.

Paginate long conversations and inboxes; batch register aggregates; avoid N+1 queries. Measure with realistic organization-scale test data, including owners with many actions and escalation bursts. Job retries must recover after restart without browser activity or duplicate state transitions.

Log business-event correlation, failures and timings without secrets or unnecessary message/file contents. Add monitoring for scheduler inactivity, outbox backlog, failed delivery, scan backlog and overdue ESH review. A green HTTP response alone does not establish successful email delivery, correct schema or authorization.

## 28. Acceptance scenarios

Verify with integration/API tests for permissions and state changes, plus real browser/email tests. Demo records stay outside production. Do not claim success from screenshots alone.

| ID | Scenario | Expected result |
| --- | --- | --- |
| FM01 | Open ESH Home | Only two live module cards; no combined task/finding page |
| FM02 | Switch between modules | Local navigation is replaced; actual TAMCO Focus routes/menu keep working |
| FM03 | Assign action to an email absent from directory | Contact/action saved and email queued without normal user account or enrollment |
| FM04 | Owner opens email in a signed-out/private browser | Specific action reachable without main login or hosting SSO |
| FM05 | Owner opens View All My Actions from email | All and only currently open actions assigned to that verified email in this organization |
| FM06 | Several actions share one owner, including an older open action | All appear; pagination/counts are correct; no creation-date exclusion |
| FM07 | Inbox has awaiting-verification action | Remains visible, clearly waiting for ESH rather than owner completion |
| FM08 | Owner clicks a My Actions row and returns | Correct conversation opens; simple return to same authorized list |
| FM09 | Action-only token opens inbox route or alters email parameter | No scope expansion or another owner's data; offer appropriate email-link route |
| FM10 | Same email exists in another tenant | No cross-organization assignments, counts, messages or files exposed |
| FM11 | Two links in one email are redeemed independently | Action and inbox grants do not invalidate one another accidentally |
| FM12 | New action assigned during valid inbox session | New live assignment becomes visible without another account or manual linking |
| FM13 | Action reassigned after inbox loaded | Disappears for old owner; stale page writes/download issuance denied; new owner notified |
| FM14 | Old owner still owns other actions | Their valid inbox access to other owned actions is preserved |
| FM15 | Contact email corrected/deactivated | Controlled transfer/revocation; no automatic undocumented mass reassignment |
| FM16 | Owner sends chat update or Done message | Does not automatically submit or close the finding |
| FM17 | Owner submits composer with valid result/evidence | One message/submission snapshot, Awaiting verification, ESH notified |
| FM18 | Final update was already sent | Owner reuses that exact message/files; no duplicate text or upload required |
| FM19 | Arbitrary latest message lacks completion proof | Not silently selected or combined with unrelated evidence |
| FM20 | Submission lacks required file or selected upload failed | Clear inline blocker; no incorrect status change |
| FM21 | Additional messages arrive during review | Conversation continues; immutable submission unchanged |
| FM22 | Owner withdraws/resubmits while ESH reviews | Stale version cannot be accepted; history and current responsibility correct |
| FM23 | ESH requests improvement | Action reopens to owner work; reason visible; due date retained/revised explicitly |
| FM24 | Owner attempts close/verify API directly | Denied even if UI buttons are hidden |
| FM25 | ESH verifier is also Action Owner | Self-acceptance denied; independent authorized verifier required |
| FM26 | ESH accepts final required action | Finding closes atomically; timers stop and closure record remains |
| FM27 | Finding has multiple independent actions | Partial acceptance does not close outstanding actions; guest sees only entitled context |
| FM28 | Due-date extension requested in chat | Official deadline unchanged until ESH explicitly changes it |
| FM29 | Deadline changed after escalation | Baseline/history preserved; future jobs recalculated and stale jobs suppressed |
| FM30 | Configure Levels 1–3 using new emails only | No account/hierarchy setup prerequisite; levels and recipients stored correctly |
| FM31 | Multiple recipients at a level | Separate recipient-specific notifications/grants; no shared owner token |
| FM32 | Level 2 not yet triggered | Configured recipient has no unactivated escalation entitlement |
| FM33 | Escalation recipient opens/responds | Scoped action access works; owner inbox/submission/closure forbidden |
| FM34 | Recipient is also an owner elsewhere | Owner and escalation permissions/lists remain distinct |
| FM35 | Owner submits before reminder worker dispatch | Stale owner reminder suppressed; ESH review timer starts |
| FM36 | ESH review overdue | ESH reviewer route followed; owner not chased to complete again |
| FM37 | Scheduler reruns/restarts or catches up after outage | Idempotent events, coalesced catch-up policy, no email storm |
| FM38 | Provider accepts, then bounces email | Correct separate delivery states; ESH sees delivery problem, no false read claim |
| FM39 | Provider timeout/webhook duplicate | Retry/reconciliation does not duplicate business events or unlimited grants |
| FM40 | GET/HEAD email scanner prefetch | No token consumption or business mutation; actual recipient can recover/open |
| FM41 | Script-capable scanner or consumed-link failure | Documented safe fallback/recovery works without account/password requirement |
| FM42 | Expired/revoked link or changed destination | Neutral recovery/no data leak; only correct recipient receives replacement |
| FM43 | Token replay or simultaneous exchange | Atomic single-use behavior; only narrowly bound same-browser recovery allowed |
| FM44 | Unknown email link request and repeated resend | Neutral response, throttling and no recipient enumeration/mail storm |
| FM45 | Guest email matches privileged staff email | No elevation or staff-session takeover |
| FM46 | Owner changes action/file/submission IDs in request | Server denies unauthorized resource access and cross-action evidence reuse |
| FM47 | Upload multiple files, one failure or scan rejection | Successful files retained; explicit retry/remove; no phantom submitted evidence |
| FM48 | Mobile camera/gallery/PDF/Excel and desktop drop | Same composer workflow; no mandatory separate upload section |
| FM49 | Unauthorized or expired file download | No permanent public access; signed URL limits and authorization enforced |
| FM50 | Session expires mid-composition or identity changes | Safe draft handling/recovery; no cross-user draft or cached-data leak |
| FM51 | Double-click Send/Submit/Accept or concurrent reassignment | Exactly one valid transaction or clear conflict; no duplicate closure |
| FM52 | Finding reopened/cancelled/closed | Correct inbox/timers/access state with preserved prior history |
| FM53 | Excel preview, staged import and notification release | Preview/staging send nothing; invalid/duplicate rows surfaced; separate deliberate release generates consolidated assignment notifications |
| FM54 | Register/export counts and dates | Finding/action units, meaningful update dates and timestamps match canonical records |
| FM55 | Outlook/Gmail/mobile links and no main account | Both action and inbox entry paths verified in real signed-out environments |
| FM56 | Module regression and broader access tests | TAMCO Focus unchanged; internal app remains protected; guests cannot enumerate platform data |

## 29. Implementation and rollout sequence

1. Inspect the repository and map existing auth/email/storage/jobs and module layouts. Record compatibility decisions.
2. Add additive schema/constraints, module-specific staff permissions, managed email contacts and the centralized guest authorization boundary. Design token/session issuance and revoke paths before exposing private guest data. Preserve existing Focus access during migration.
3. Implement ESH Home/module switching while preserving TAMCO Focus routes.
4. Implement creation/assignment, email principals, scoped email links and My Actions end to end.
5. Implement the single-conversation UI, private evidence and immutable review submissions.
6. Implement ESH verification, due/owner changes and closure/reopening transactions.
7. Implement scheduled reminders, activated escalation scopes, ESH review follow-up and delivery monitoring.
8. Implement staged Excel mapping/import/reconciliation, risk/priority fields, two-filter My Actions, bulk operations and recipient digests. Validate representative legacy data and retry/revocation behavior without automatically mailing imports.
9. Implement ESH Overview and weekly report configuration, snapshots, report-viewer links and scheduling. Use controlled test recipients; leave actual leadership audiences unconfigured.
10. Verify all acceptance scenarios including section 37, especially signed-out access, My Actions isolation, report revocation and automated follow-up.
11. Roll out with explicit email/scanner/calendar/storage settings, migration/rollback notes and observed delivery behavior.

Authorization to implement does not justify destructive migrations or sending test findings to real employees. Use controlled test recipients and the project's existing release/approval rules. Preserve production secrets and historical evidence. Report genuinely blocked infrastructure rather than faking capability or silently dropping required functionality.

## 30. Required agent handoff

Deliver:

- Actual implemented route/screen map and concise before/after explanation.
- Database migrations, permission model and rationale for guest identity versus staff accounts.
- Exact link scopes, expiry defaults, scanner behavior/recovery and assignment-revocation behavior.
- Working owner email with both View finding & respond and View All My Actions; distinct escalation email.
- Notification/job configuration, provider delivery handling and operational alerts.
- Verified screenshots of ESH Home, separate module navigation, chat-first owner response, My Actions, escalation response and ESH verification.
- Updated screenshots of registered staff Module access, an email-link contact, ESH Overview, weekly report configuration and signed-out leadership report access. Version 1.0 mockups do not cover these new screens.
- Permission migration map, report metric definitions, configured versus still-unconfigured recipients/schedules, and report scope/revocation test evidence.
- Import mapping and reconciliation output; screenshots of import preview, Needs my action, bulk submission review and consolidated email; FM83–FM100 results.
- Acceptance-test results, unresolved risks/dependencies and precise deployment/rollback steps.

Definition of done: ESH enters owner/escalation email addresses; the system assigns and follows up automatically; recipients use secure email access without normal accounts; owners see all their open actions and respond through one chat; ESH alone verifies and closes; TAMCO Focus remains a separate, functioning module.


## 31. Identity & Access refinement — one directory, separate permissions

### 31.1 Replace the overloaded Role field

The current Team member / Manager / Administrator dropdown mixes job responsibility, Focus access and platform administration. Replace it with a compact Module access section on registered-person profiles. Do not redesign every existing administration function or make a new directory for each module.

| Profile group | Fields and behavior |
| --- | --- |
| Basic details | Full name, email, employee ID, job title, department and account status. Employee ID is not required for email-link contacts. |
| Module access | TAMCO Focus preset and its existing visibility controls; Finding Management preset and department scope. Only reveal controls for enabled modules. |
| Platform administration | Separate explicit administrator capability; never implied by Manager, COO, CFO or HOD job title. |
| Reporting relationships | Existing reporting manager, optional dotted-line manager and effective-dated history. Collapse secondary detail. |
| Summaries | Existing personal/team weekly summaries belong to TAMCO Focus. Leadership Finding reports are configured separately. |
| Advanced | Visibility explanation, audit history, deactivation/revocation and controlled corrections; collapsed initially. |

TAMCO Focus presets preserve existing behavior: No access / Team member / Manager. Map existing administrator behavior deliberately; do not silently remove existing access or lock out the last administrator. Reporting relationships continue to drive Focus visibility according to existing rules. A dotted-line relationship or department membership alone must not grant Finding visibility.

Finding presets are No access / Viewer / Coordinator / Verifier. These are editable business permission bundles, not organization job titles. For a lean first release:
- Viewer reads authorized findings and permitted evidence.
- Coordinator adds creation, assignment, chat, deadline/owner changes and action escalation configuration.
- Verifier includes Coordinator and can review/accept/request improvements/close, subject to scope and the no-self-verification rule.
- Report management is a separate capability available to authorized ESH coordinators/verifiers or administrators. It does not itself grant access to finding contents.
- Platform Administrator can maintain access/policies/delivery configuration, but needs an explicit Finding preset to view or verify business records.

Apply explicit Finding scope: selected departments or entire organization. Do not default new permissions to entire organization. Selecting a parent department does not silently include descendants; provide an explicit inclusion option. Show scope beside the preset. Separate permission to view data from permission to delegate that data to report recipients. Report managers cannot share beyond their approved delegable scope.

Keep an accessible “Effective access” summary: for example, “Focus: reports and selected people. Findings: Coordinator, ESH department. Platform administration: No.” It must be calculated from the same authorization rules as the server, not just descriptive frontend text.

### 31.2 Keep the administration UI small

Retain the existing search/list and selected-person detail arrangement. Label the shared page **People & access** or retain **Identity & Access** consistently. Add list filters All / Registered users / Email-link contacts and search by name/email. These are directory filters, not a new set of module menus.

A person may be registered staff and also an email-link participant. Display both facts without duplicate person records or merging permissions. Show only applicable fields in the detail view. Keep department maintenance/reporting relationships reachable from existing administration; do not add an organization-chart editor to this scope.

Migration must preserve current Focus roles, summaries, reporting history and explicit visibility overrides. Do not infer Finding permissions from department names, email domains, job titles or Manager status. Record an explicit reviewed migration map for existing ESH users. Existing verified staff-to-contact association must not convert guest grants into staff sessions.

### 31.3 Manage non-registered contacts explicitly

Reuse the organization-scoped email_principal from section 8. Creating an action assignment, escalation recipient or report recipient automatically creates/reuses a contact; administrators can also add one by email. No auth.users record, registration invitation, employee number or password is required.

Contact detail shows:
- Email, optional display name/department/job title, and email-link contact indicator.
- Current participation: Action Owner, Escalation recipient, Report recipient. These labels are derived from live assignments/entitlements, not global role dropdowns.
- Open assigned actions, configured escalation levels versus currently activated escalations, and report subscriptions.
- Access state, last verified link access if available, and notification delivery problems. Provider acceptance is not proof of receipt or reading.
- Targeted Resend access, Revoke access, Disable contact and Correct email actions, with scope/reason shown before saving.

Revoke a selected grant/session/entitlement independently when possible. Disable contact blocks all its guest access immediately and stops new guest notifications; show ESH outstanding actions requiring reassignment and disabled escalation/report routes. Disabling access does not complete, cancel or delete the associated work.

An email correction is an identity change, not merely a string edit. Validate the new email, show affected assignments/subscriptions, obtain an authorized deliberate save, record the old identity and reason, revoke old affected grants/sessions, move only the selected live relationships and issue fresh access. Historical authorship remains attributed to the original actor. Never silently merge similar addresses or transfer permissions to a different person.

Deactivating a linked staff user must explicitly resolve whether their email-link participation is also disabled; default to revoking associated guest access for an offboarding operation and show the affected work. A module-only role change need not deactivate independent guest assignments. Audit these distinct operations.

Hide permanent deletion from the routine workflow for identities referenced by findings/evidence/audit history. Use deactivation and the controlled retention process; do not cascade-delete accountability records.

## 32. Leadership recipients and the meaning of “public dashboard”

“Public dashboard” means **reachable without normal application login through secure email access**. It does not mean an anonymous website, an unprotected shared URL or a dashboard discoverable by knowing someone's email address.

Leadership report recipients are another email-link participation type. ESH enters email addresses, optionally labels them COO/CFO/HOD, and explicitly selects permitted departments. Actual names, addresses and organization-wide access are not assumed. A person can be both an Action Owner and a report recipient; each purpose retains separate authorization.

| Recipient purpose | Data access | Write access |
| --- | --- | --- |
| Action Owner | Their currently authorized action(s) and evidence; My Actions requires owner-inbox scope | Chat, files, completion submission and requests |
| Escalation recipient | Relevant context only after the escalation entitlement activates | Reply/support and optional acknowledgment |
| Leadership report recipient | Approved report summary and permitted action/finding drill-down within explicit scope | None |
| Registered ESH | Finding data allowed by module role and department scope | As allowed by Coordinator/Verifier permissions |
| Administrator | Identity/policy/delivery configuration | Administrative changes under audit; no implicit closure authority |

Introduce grant purpose **report_viewer**. Bind it to organization, email principal, report subscription/recipient entitlement, permitted snapshot, scope version and allowed operations. Follow the same token hashing, single-use exchange, scanner handling, expiry, secure-cookie, recovery and revocation protections as owner links. Do not place email addresses in URLs as authorization.

Owner or escalation links cannot open the leadership dashboard by inference. Report links cannot open My Actions or post messages, upload files or approve a finding. A principal with several legitimate entitlements still needs the correct purpose and live resource checks; merely recognizing an email is insufficient.

The report dashboard requires no account creation or main login. Include “Email me a new secure link” on expiry using a neutral anti-enumeration response. Send only if the report entitlement remains active. Report unsubscribe/pause affects weekly summaries, not mandatory owner/escalation accountability notifications.

Default guest drill-down fields: reference, finding title, accountable department/location, action owner display name, required action, state, due date, last meaningful update time and closure date where applicable. Do not expose full chat, email directories, internal notes or evidence by default. Use a dedicated read-only serialization rather than reusing an unrestricted internal detail endpoint.

Treat sensitive/restricted findings explicitly: exclude them from guest reports and their counts unless a separate approved reporting policy authorizes the necessary data. Do not leak excluded records through totals, search suggestions or exports. Internal ESH scope continues to apply independently. File access, if later enabled for a report audience, needs explicit evidence permission and per-file checks; it is not included merely because a report shows a finding title.

## 33. ESH Overview — open work, closure and departments

### 33.1 One overview, one set of definitions

Use **Overview / Register / Verification** as Finding navigation. Keep report/follow-up settings under a secondary Settings control. The overview answers “What remains unresolved, where is follow-up needed, and what closed recently?” Reuse the same layout in read-only form for leadership; do not create an executive analytics product.

Show a department selector bounded by the viewer's scope and a clearly labelled **Closures: Last 30 days** selector (30/60/90 days, this year, custom). The closure-period selector does not hide old open work. Show the data timestamp.

| Compact signal | Exact definition |
| --- | --- |
| Open findings | Distinct live findings not Closed/Cancelled/Duplicate, including New/unassigned. All ages. |
| Overdue actions | Owner-actionable Assigned/In progress actions whose official due_at is earlier than the as-of time. Excludes Awaiting verification, Accepted and cancelled work. |
| Awaiting ESH review | Actions with a current submitted, non-withdrawn review submission awaiting ESH verification. Show review overdue as a secondary exception. |
| Closed findings | Findings with an official ESH closure event in the selected closure window and still Closed at the as-of time. Reopened findings are open; do not count owner submission as closure. |

Counts have different units deliberately: label **findings** or **actions** in each signal and tooltip. They are not four parts of one total. Do not show a pie chart or sum them into a completion percentage. Accepted actions may belong to a finding still open because another action remains outstanding.

Below the signals, use one department table with the same four measures. Each finding has one required accountable department (or an explicit Unassigned bucket during draft/import). For this overview, group its actions under that finding's accountable department, even if an owner works elsewhere. This avoids double-counting a multi-action finding. Owner department is separate metadata and must not silently change accountability.

Clicking a department or signal opens the existing Register or Verification queue with the exact filters. Show action rows for an action count and finding rows for a finding count. Selecting an action opens its permitted detail. Department totals reconcile with the scoped organization totals, including Unassigned.

If a finding is reopened and reclosed, count it once when its current closure event falls in the window; preserve all earlier events for audit. Dashboard counts describe current resolution, not gross closure-event throughput. Label this definition in help text so a reopened item does not look like deleted history.

### 33.2 Keep attention visible without adding sections everywhere

Internal ESH may see one compact attention line for unassigned findings, delivery failures and review overdue, each linking to the existing queue. No performance scores, league tables, capacity ratios, extra charts or chronological system-event feed.

Empty state says no matching findings. Loading/error states must not display zero as if a query succeeded. Large datasets require server aggregation, indexed filters and paginated drill-down. On mobile, stack the four signals in two columns and turn department rows into compact labelled summaries; preserve the same meaning.

## 34. Weekly reports — configurable, concise and accountable

### 34.1 Configuration

Provide **Settings → Weekly reports**, with a small list and **New report**. One configuration has:
- Report name.
- Recipient email chips, with optional display names/job-title labels.
- Approved department scope: selected departments or explicit organization-wide scope; descendant inclusion explicit.
- Weekly day, local time and IANA timezone.
- Active/Paused state and report-policy version.
- Preview summary and recipient/scope confirmation before activation.

Use one scoped report for several recipients when they share the same audience. Separate configurations support different department audiences. Prefer one concise weekly report per recipient and scope, not separate emails for every overdue action or department. Action reminder/escalation emails continue independently.

Proposed draft schedule is Monday 08:30 Asia/Kuala_Lumpur; this is an editable implementation default, not a configured live instruction. Actual COO/CFO/other recipients and final schedule remain to be chosen. Leave new reports Draft until an authorized operator explicitly activates them. No real emails or ChatGPT automations should be created while implementing this specification.

Report setup lives in Finding settings. Contact detail can show the subscriptions and link to them; do not duplicate schedule editors on every person's profile or repurpose TAMCO Focus personal/team summary fields.

### 34.2 Reporting window and contents

At weekly generation, capture a consistent authorized snapshot:
- Open findings, overdue actions and awaiting ESH review are measured at the snapshot generation time and include all ages.
- Closed findings use the previous complete local calendar week: Monday 00:00 inclusive through the following Monday 00:00 exclusive.
- Clearly display both the open-work as-of timestamp and the closed-period dates. They are different concepts.
- A delayed run uses its actual capture timestamp for open work, labelled accurately; the scheduled report cycle determines the intended closed-week window.
- Record configured timezone and exact UTC boundaries. Do not use rolling seven days when the UI says previous calendar week.

Email contains a short heading, the four labelled signals, a compact department summary and **View report**. If a large department scope requires truncation, label “Showing X of Y departments” and link to the full scoped table. Optionally show up to five overdue owner actions with owner and due date; the dashboard holds the complete paginated list. Use read-only copy such as “Awaiting ESH review” rather than implying the owner has closed the finding.

The email link initially opens the saved weekly report so numbers match the email. Show a clear “Weekly report · [dates]” heading and “As of [timestamp]”. An optional **View current status** control opens a live view for the same currently authorized scope, labelled Live. Live rows must not be mistaken for the frozen weekly snapshot.

Store only the approved report fields in snapshots; do not duplicate entire chat/evidence records. Snapshot detail uses the captured field values. If opening current detail from a snapshot, label that transition and recheck current resource authorization.

### 34.3 Automation, failure and access changes

Use the existing application job service and notification outbox, not browser timers. Schedule against the configured timezone. Snapshot generation and per-recipient dispatch must be idempotent, with a unique cycle/definition/scope-version identity and recipient send key. Retries do not generate extra weekly emails. An intentional corrected resend is a new audited delivery version.

Revalidate report status, recipient entitlement and scope immediately before queueing, before dispatch and on every dashboard/API request. Pausing a report cancels future/queued weekly sends; revoking recipient access also invalidates existing report grants and sessions. Provide these as distinct operations.

Pause controls sending only: an otherwise valid previously issued report link may remain readable until expiry. Disable access/revoke explicitly blocks reading. A finding's accountable-department change also triggers affected report-scope invalidation; do not keep exposing a historical snapshot if current sharing policy no longer permits it.

Changing a recipient email, narrowing department scope or changing restricted-record classification invalidates affected older report links/sessions. Keep immutable snapshots for authorized internal audit, but do not keep exposing obsolete snapshots to the guest. Provide a neutral access-changed screen and a fresh currently permitted report/link. Do not partially redact old totals while presenting them as the original unchanged report.

Every recipient gets an individual grant and delivery record. Never use one shared token for a To/CC list or reveal recipient email lists to other recipients. Technical support recipients do not inherit report access.

If snapshot generation fails or produces incomplete data, do not send a reassuring all-zero summary. Retry, then surface the failed scheduled report to its authorized administrator/ESH maintainer. Delivery failures/bounces appear in report settings and contact detail. Dashboard interaction and optional acknowledgement do not affect action status. Opening a report must never suppress overdue reminders or escalation.

## 35. Database, authorization and API additions

Extend the existing schema; names below are logical contracts to adapt to the repository. Do not create a second authentication system or a separate database merely for this feature.

| Entity/change | Required data and constraints |
| --- | --- |
| Staff module access | Organization, staff identity, module, permission preset/capabilities, scope and authorization version; unique per staff/module; changes audited. |
| Department scope | Explicit department membership of a grant, optional descendant inclusion and delegable scope. Existing reporting relationships remain independent. |
| Email principals | Contact state, optional display metadata, optional verified staff association; no required application account; organization/email uniqueness remains. |
| Findings | Required accountable department for assigned findings; restricted/reportable classification; preserve department-change audit. |
| Report definitions | Organization, name, timezone, schedule, scope, closed-period policy, Draft/Active/Paused state, version, creator and maintainer. |
| Report recipients | Definition, email principal, enabled state, scope ceiling/entitlement version, added/revoked actor and time; unique live recipient per definition. |
| Report runs | Definition/version, scheduled cycle, actual snapshot timestamp, closed-window UTC bounds/timezone, generation status/error and idempotency key. |
| Report snapshots/rows | Immutable approved fields and aggregate counts from one consistent dataset, report scope/classification version, source IDs and capture time; no raw grant secrets. |
| Access grants/sessions | Add report_viewer purpose, report-recipient entitlement/snapshot references and authorization version; reuse hashed-secret and expiry model. |
| Notification outbox/delivery | Add weekly_report event, run/recipient/version references, deduplication key and provider status. Use existing retry/audit infrastructure. |
| Audit | Staff permission changes, contact correction/disable/revocation, report scope/schedule/recipient changes, activation, dispatch, link access and export if supported. |

Staff access and guest entitlements are separate checks even when linked to the same human. A report-viewer session needs a currently enabled principal, subscription recipient, permissible report/run and matching authorization version. Validate tenant and scope for every aggregate query, paginated row, search, count and resource reference.

Use a consistent database snapshot/transaction for report rows and counts. Do not execute unrelated count/list reads against changing data and claim they are one snapshot. Index organization/state/due date/accountable department/closure time and report scheduling/idempotency keys as appropriate.

Recommended additional capabilities:
- Get/update a person's per-module permissions and show effective access.
- List managed contacts and their scoped participations; revoke/resend/correct/disable with reasons.
- Read ESH overview and filtered drill-down through canonical metric queries.
- Create/update/preview/activate/pause report definitions and manage recipient entitlements.
- Generate a report run and dispatch through authenticated background workers.
- Read a secure report snapshot, read same-scope live status and recover a report link.

Do not add guest bulk download/export by default. Internal exports keep existing scoped controls. Directory listings and report administration endpoints never become guest-accessible.

## 36. Screen specification for this revision

These are layout requirements for implementing and capturing new screenshots. Existing version 1.0 screenshot assets remain useful for the home/chat/action flow, but do not depict the additions below.

| Screen | Main visible content | Progressive detail / primary action |
| --- | --- | --- |
| Registered person | Existing people list; selected name; Basic details; Module access with separate Focus and Finding presets/scope | Reporting relationships, summaries and audit collapsed; Save changes |
| Email-link contact | Email/name; “No account required”; current participation chips; open assignments, activated escalations and report subscriptions | Delivery/access history and administrative controls; targeted Resend access |
| ESH Overview | Finding navigation; department filter; four small signals; one department table; data timestamp | Signal/table drill-down into existing register; closure period affects closed metric only |
| Register | Existing compact finding/action list and filters; Closed included | Individual finding conversation/verification detail |
| Weekly reports settings | Report name, scoped audience, recipient count, weekly schedule, Active/Paused/Draft and last delivery outcome | Single editor for emails/scope/schedule; Preview then Activate |
| Leadership email | Report title/period; four labelled signals; compact department summary; View report | Unique secure link; no app-login instruction |
| Leadership dashboard | Platform brand, report title, as-of and closure dates; same scoped overview; compact read-only drill-down | Optional View current status; no module switcher, sidebar, editor or action composer |
| Expired/revoked report access | Short neutral explanation | Email me a new secure link if still authorized; no revealing private counts or recipient details |

Use the existing TAMCO visual language: restrained dark teal/navy, white surfaces, compact spacing, clear text hierarchy and exception-only emphasis. Maintain keyboard access, visible focus, readable contrast and mobile layouts. Do not create many decorative summary sections or an additional update form.

Representative mock data must be labelled as illustrative. Include both current and weekly-snapshot timestamps. Example owner names/emails and executive titles are examples only, never default production recipients.

## 37. Additional acceptance scenarios and completion criteria

Run these in addition to FM01–FM56. Focus on server-enforced behavior and meaningful integration tests; screenshot checks alone cannot prove permissions.

| ID | Scenario / expected result |
| --- | --- |
| FM57 | Existing Focus user migration preserves reporting-line visibility, explicit overrides, summaries and functioning admin access; no Finding permissions inferred. |
| FM58 | Focus Manager without Finding access cannot read Findings; Finding Viewer cannot assign/close; Verifier cannot verify their own action. |
| FM59 | Platform administration does not silently confer business verification or unrestricted finding-content access. |
| FM60 | Assigning an unknown email creates/reuses a managed contact without a staff account, password or registration requirement. |
| FM61 | Contact participation labels reflect actual ownership, configured versus activated escalation and report subscriptions; labels themselves grant no authority. |
| FM62 | An email correction revokes old affected access, reassigns only authorized live relationships, issues new access and preserves historical authorship. |
| FM63 | Disabling/offboarding a contact immediately blocks guest access, stops new sends and exposes outstanding work to ESH without deleting or closing it. |
| FM64 | Owner, escalation and report grants cannot cross purposes; guessing an email, action ID or report ID grants nothing. |
| FM65 | An authorized report recipient opens their report signed out, without account creation, password, main login or hosting SSO blockage. |
| FM66 | A report recipient cannot POST chat, upload, submit, accept/close, change dates or open an owner inbox using report scope. |
| FM67 | Department totals, signal totals and drill-down agree within scope; multi-action findings do not double-count; Unassigned is included explicitly. |
| FM68 | Old open findings remain visible when the closure-period selector changes; Assigned/In progress overdue counts exclude Awaiting verification and Accepted. |
| FM69 | Owner submission does not count as closure; reopened findings move to open and do not remain in current closed totals; reclosure uses the current official closure event. |
| FM70 | Weekly closures use exact previous-local-week boundaries; open counts use labelled capture time. Delayed runs and daylight-saving zones do not silently shift the intended reporting period. |
| FM71 | Snapshot rows/counts are transactionally consistent; opening the email report matches its snapshot, while live status is visibly distinguished. |
| FM72 | Draft/Paused reports send nothing; schedule retries do not duplicate deliveries; different recipients receive separate grants without exposing other emails. |
| FM73 | Removing a recipient, narrowing scope or restricting a record invalidates affected stale report access, including active sessions, API requests and queued sends. |
| FM74 | Link scanners, replay, expiry and recovery obey the existing guest security model; generic responses prevent report-subscription enumeration. |
| FM75 | Restricted findings do not leak through guest counts, lists, snippets, search, exports or evidence URLs. Cross-tenant and sibling-department requests fail. |
| FM76 | Failed snapshot queries are errors rather than zero counts; bounced/failed report deliveries surface to authorized maintainers. |
| FM77 | Report viewers who also own actions must use the correct live entitlement for each purpose; one legitimate role does not widen another grant. |
| FM78 | Reporting hierarchy, dotted-line visibility and COO/CFO labels do not implicitly grant Finding or leadership-report access. |
| FM79 | Report managers cannot share data beyond their explicit delegable scope; raw API changes are checked as strictly as the UI. |
| FM80 | Report pause/unsubscribe does not suppress owner/escalation notifications; report opening/acknowledgment does not change action states. |
| FM81 | New Overview/Register routes preserve existing deep links; guest pages have no platform/sidebar clutter; Focus navigation remains functional. |
| FM82 | The default report editor contains no actual executive recipients and does not activate production sending until configured. |

Revision 1.1 is complete when the original Finding workflow still works, ESH can manage registered and email-only participants without role ambiguity, open/closed work is visible by accountable department, and approved email recipients can receive and read scoped weekly reports without normal accounts. Keep the user-facing flow lean: **one directory, one ESH overview, one report configuration, and one secure read-only report view**.


## 38. Excel backlog import — review once, preserve accountability

### 38.1 Workflow and mapping

Support the existing backlog of 90+ unresolved items without requiring manual re-entry. The source workbook has not yet been supplied: inspect its real columns and sheets when available; do not assume its schema or invent records.

Workflow: **Upload Excel → Match columns → Validate → Preview → Import to staging → Release notifications**. Keep this a single guided import flow reachable from Register, not a new daily-work navigation area.

Accept .xlsx and .csv initially; clearly request conversion for unsupported legacy formats. Allow sheet/header-row selection for workbooks. Suggest mappings based on headers and sample values, but require ESH review. Provide a downloadable blank import template with field definitions and accepted values; do not require users to reformat a usable existing workbook unnecessarily.

| Source information | Destination / rule |
| --- | --- |
| Finding number | Original reference and source register identity; system reference remains distinct |
| Description / observation | Original finding description, preserved without rewriting |
| Required corrective action | Action requirement; if missing, ESH must define before release |
| Responsible person's name | Display hint; does not identify an authorized email principal |
| Owner email | Validated email principal; exact reviewed mapping, no fuzzy automatic assignment |
| Area / department | Location and accountable department mapped to existing values |
| Reported date | Original reported date; import date stored separately |
| Target date | Baseline/current due date with documented date/timezone interpretation |
| Risk | Map to the organization's configured scale; unmapped/missing means Not assessed |
| Priority | Map separately to Urgent / High / Normal; ambiguity requires ESH review |
| Remarks / progress | Historical note with import provenance; never presented as a new owner-authored message |
| Status | Preserve source status and map explicitly; “Done” does not prove ESH verification |
| Photos / evidence references | Explicit original-evidence associations and success/failure results |

Show both source and mapped values in preview. Ambiguous dates such as 04/05/2026 require a selected date convention; support Excel serial dates correctly and report invalid/far-future dates for correction. Do not replace old dates with today. Ignore blank rows explicitly and flag missing references/descriptions, unmapped departments, invalid emails and ambiguous owner names.

Embedded images must be associated with the intended row through reliable workbook anchors or explicit ESH confirmation. Show imported, unmatched and failed evidence counts. Do not assume a floating image belongs to the nearest finding. Links requiring credentials or pointing to local/network drives are unresolved evidence references until safely uploaded; never silently drop them. Do not fetch arbitrary supplied URLs from a privileged server without a constrained retrieval policy.

### 38.2 Staging, duplicates and reconciliation

Store the source file privately, plus file hash, source register identity, sheet/row, original values, mapping version and row validation outcome. Never execute spreadsheet macros/formulas or embedded code. Bound file size, expanded archive size, sheet/row/image counts and parsing time; reject unsupported or dangerous payloads with an actionable message.

Use source register + original reference as a stable import identity where reliable. File hash catches exact re-upload; normalized row fingerprint helps identify possible repeats where references are absent. Titles or row numbers alone are insufficient persistent identities.

For a likely existing finding, show Skip / Link to existing / Review proposed update. Do not silently overwrite its live conversation, submission, risk assessment or changed deadline. Re-import must not re-notify unchanged assignments. Similar wording is a review suggestion, not an automatic merge.

Keep blocked rows in a visible import-review queue with row-level reasons; permit importing/releasing an explicitly selected valid subset. Show reconciled totals: source rows, blank/ignored, staged, blocked, skipped duplicates, linked/updated and newly created. Every nonblank row has a traceable outcome. Unreleased staging records are excluded from live finding counts and timers; they remain visible to ESH as Pending import, not hidden or discarded.

Missing owner email goes to Needs assignment in staging. ESH can save an explicit name-to-email mapping for this batch and review all rows it affects. Missing required action, unresolved department, missing due date or unreviewed priority blocks that row's release. Do not create invented dates or addresses. Known evidence-import failures require correction or an explicit ESH acknowledgment before release.

ESH may consolidate genuinely duplicate observations into one finding while preserving every source reference, note and evidence association. Different locations or corrective actions may require distinct actions or findings. Record the consolidation decision and resulting ownership; never erase source rows.

### 38.3 Controlled release

Import does not send. Release shows the selected findings/actions, distinct recipients, priority distribution and already-overdue items. An authorized ESH operator deliberately releases the selected ready rows; released items become live and their assignment/outbox records commit together.

Retain original overdue dates. Any agreed extension is a separate audited deadline change with reason, baseline and current date. Import is not an excuse to reset lateness.

For overdue backlog, show the applicable escalation policy before release. Define the follow-up activation time explicitly. Evaluate current overdue state on activation, coalesce historical routine reminders and use the configured catch-up rule for the currently due escalation stage. Never backdate notifications or claim earlier escalations occurred. Any intentional transition period must be an explicit ESH-approved policy override with reason and end time, not a concealed grace period.

Repeated release/job retries cannot create duplicate findings, assignments or notifications. Before release, a staged batch may be corrected/discarded. After live activity or notification, corrections use audited normal operations; do not offer destructive rollback that erases responses.

## 39. Risk, action priority and overdue status

| Concept | Owner / implementation |
| --- | --- |
| Finding risk | ESH assessment using TAMCO's configured method; store method/version, assessed level, assessor and date. Missing assessment is Not assessed. |
| Action priority | Explicit Urgent / High / Normal on each action; ESH sets and changes it. Use for sequencing owner work. |
| Due date | Official agreed action deadline, with preserved baseline and change history. |
| Overdue | Computed exception for owner-actionable work after due_at; never a manually selected risk class. |

Do not invent a universal risk matrix or automatically map arbitrary imported numbers to risk levels. Where an approved risk-to-priority policy exists, suggest its result. ESH confirms the action priority, and overrides require a reason. Without a configured mapping, request ESH selection; do not silently label unassessed findings Low or default all imported actions to Normal.

Urgent means the action needs immediate attention under the organization's agreed process; High precedes Normal. These labels organize work and notifications; they do not certify safety or replace established emergency controls. Deadline and escalation rules remain explicitly configured. Priority changes are audited and show their impact on applicable follow-up policy; do not silently restart escalation clocks.

For a finding with multiple actions, keep risk at finding level and priority at action level. A finding-list priority summary may show the highest outstanding action priority, labelled as such. Finding risk must not be downgraded automatically because an action was submitted.

Owner rows emphasize priority and due date; risk assessment details sit inside the finding. Use exception emphasis for Urgent/High/Overdue and quiet styling for Normal. ESH Register supports risk/priority filters when needed without adding more navigation sections.

## 40. My Actions and controlled bulk operations

Use the two filters and priority-first ordering in section 10. Keep the single-action chat unchanged. Search supports reference/title/location. Multi-selection is opt-in through **Select actions**; only then reveal bulk controls. Show selected count and titles, and distinguish selecting the visible page from explicitly selecting all matching actions.

| Operation | Required behavior |
| --- | --- |
| Common progress update | Preview selected actions and message; post an individually attributed message to each authorized action. |
| Request more time | One shared explanation and proposed date(s), linked to selected actions. Official deadlines change only through explicit ESH approval per action. |
| Reuse evidence | Upload once, explicitly choose the target actions and associate the file with each; retain per-action authorization and provenance. |
| Submit several actions for review | Compact row per action with result text/source message and selected final evidence; validate every row before dispatch. Create a distinct immutable submission for each action. |

No “Mark all completed,” bulk owner closure or automatic ESH acceptance. Sending a common progress update does not submit anything. Common evidence only satisfies an action's rule when explicitly selected, relevant and ready; a shared file is not proof that every selected action is finished.

Batch submission may prefill explicitly chosen common result/evidence, but the owner reviews each row. Show missing requirements, active uploads and failures beside the affected action. ESH verifies each submission independently; accepting one never accepts the rest of the batch.

Bulk write controls operate on currently owned actions in Needs my action through owner-inbox authorization. Action-only links do not widen themselves to batch scope; the user follows their separately issued My Actions link. Pending-review discussion remains available in individual chat, but awaiting-review actions cannot be accidentally resubmitted by a batch.

Use an operation ID and per-action idempotency key, returning Succeeded / Failed / Skipped for every selected item. A partial failure keeps successful writes and retries only failed items. Recheck principal, live ownership, state, version and file rights for every item at execution. If reassigned, revoked, closed or newly submitted meanwhile, skip/fail that item with an actionable result; never report whole-batch success.

A shared upload uses separate authorized evidence associations, not a public URL or a cross-action attachment shortcut. Reusing evidence must not expose another owner's conversation or files. Removing one association must not destroy evidence referenced by another action or immutable submission. Preserve the requester's identity and per-action audit history.

## 41. Consolidated owner reminders and escalation emails

Consolidation changes email packaging, not obligations, entitlement scopes, due dates or audit history.

- Initial released import: one assignment summary per owner per release batch, listing their newly assigned actions with priority/due date and **View All My Actions**. Include eligible per-action links; large lists may show a labelled preview plus the exact total.
- Routine reminders: collect due notification events for the same owner, organization and configured dispatch cycle into one digest. List only actions currently requiring that owner's response.
- Urgent assignments: separate immediate dispatch according to configured policy; do not hold them for a routine digest.
- Escalation: group events for the same recipient/organization at the same dispatch opportunity, while recording every action's activated level and delivery outcome. Do not delay a due escalation to wait for a later routine email.
- Leadership weekly reports remain the separately scoped reporting feature; escalation digest receipt does not confer leadership dashboard access.

Use role/purpose-specific links. Owner digest gets owner-inbox access and relevant action links. An escalation digest gets separate action-scoped links for the activated entitlements, never the owner's My Actions link or one unrestricted team token. Multiple levels/recipients retain distinct entitlements even when delivery is consolidated.

Derive routine dispatch windows from configured policies, with an explicit maximum delay; do not add another hidden daily waiting period to due events. Formal completion submissions and requested changes remain timely under the existing notification contract. Do not send both a routine single-action email and a digest for the same event.

Persist digest membership and a unique recipient/cycle/purpose delivery key. Revalidate each member before dispatch: remove resolved, reassigned, extended or unauthorized items and recompute the summary. Suppress an empty digest. If the provider has already accepted a message it cannot be recalled; linked pages still enforce current rights/state.

A failed digest maps failure to its included per-action notification events for operational visibility, without manufacturing multiple emails on retry. Exact duplicate retries reuse the delivery intent/idempotency key; deliberate resend is audited. Neither opening a digest nor acknowledging an escalation completes an action.

## 42. Data additions, screens and acceptance tests for backlog scale

Extend existing APIs/entities rather than creating a separate backlog module:
- Import batches/rows: source identity/hash, mapping/schema version, private source file, raw source values, row identity, validation outcome, duplicate resolution, resulting finding/action IDs, staging/release state and audit.
- Findings/actions: distinct configured risk-assessment metadata and action priority; retain baseline dates and source references.
- Bulk operations/items: actor/purpose, operation ID, per-action idempotency/version, request/result and error state.
- Digest deliveries/members: organization, recipient, purpose, dispatch cycle, event membership, grant intents and delivery outcomes. Reuse the transactional outbox and private evidence model.
- APIs: preview/map/validate import, reconcile/commit staging, release selected ready rows, execute/retry per-item bulk operations and generate role-specific digests. Apply tenant, ESH scope and current guest-entitlement checks server-side.

Screen requirements: one import wizard with a mapping preview and row errors; one final release summary; the same My Actions screen with two filters and optional selection toolbar; one compact bulk review list; concise owner/escalation email templates. No additional full-page dashboards.

Validate with a nonproduction fixture of at least 100 rows, including multiple actions per owner, missing/invalid emails, duplicate references, old due dates, missing evidence and ambiguous dates. Fixtures are tests, never production records. Verify server pagination, stable priority ordering, asynchronous import progress and bounded processing; partial failures must remain resumable.

| ID | Acceptance scenario |
| --- | --- |
| FM83 | Actual workbook headers can be mapped/previewed; chosen sheet/date convention is recorded; original values and dates are preserved. |
| FM84 | Names without confirmed emails remain Needs assignment; blocked rows stay visible and cannot notify guessed recipients. |
| FM85 | Re-uploading the same file or register reference does not duplicate findings or re-notify unchanged assignments; proposed updates require review. |
| FM86 | Every nonblank row reconciles to an explicit outcome; partial imports show counts and downloadable row-error details within ESH scope. |
| FM87 | Embedded/unmatched photos and inaccessible links have visible outcomes; no silent evidence loss, macro execution or unrestricted server URL retrieval. |
| FM88 | Staged import sends nothing and is excluded from live metrics; release creates live assignments atomically with notification intent, once only. |
| FM89 | Old deadlines remain overdue; release evaluates catch-up policy without backdating escalations or replaying historical email storms. |
| FM90 | Risk, priority and overdue are independent; missing risk reads Not assessed; ESH confirms priorities and records override reasons. |
| FM91 | Needs my action sorts priority then due date stably across pages; Awaiting ESH review contains pending submissions and no owner completion reminders. |
| FM92 | Common update creates separate attributed messages without submitting; bulk extension requests do not change official deadlines. |
| FM93 | Shared evidence has per-action authorized links; removing one link does not delete another action's or submission's evidence. |
| FM94 | Batch submission checks each row's result/evidence and creates independent immutable submissions; each still requires ESH verification. |
| FM95 | Partial batch failure reports each outcome; retry affects only failed items and cannot duplicate successful updates/submissions. |
| FM96 | Concurrent reassignment/revocation/state changes are enforced per item; action-only, report and escalation grants cannot invoke owner bulk writes. |
| FM97 | A released batch sends one owner summary per recipient; routine events consolidate without duplicate single-action emails. |
| FM98 | Urgent assignments and due escalations are not delayed by routine digests; escalation digest links authorize only activated per-action scopes. |
| FM99 | Dispatch revalidation removes ineligible members, recomputes counts and suppresses empty digests; retries preserve per-action event/delivery traceability. |
| FM100 | At least 100 mixed import rows and many actions for one owner remain searchable/paginated/resumable; no hidden truncation or false whole-batch success. |

Version 1.2 completion criteria: ESH can safely import and release the existing backlog, owners can identify their next actions and reuse updates/evidence without repetitive entry, and notification consolidation reduces email volume while retaining individual ownership, deadlines, submission evidence and ESH closure control.


## 43. Mandatory restricted rollout during the upgrade

### 43.1 Initial availability

The user has explicitly required that the new Finding Management functionality remain unavailable to the team until an administrator enables access. The initial enabled identity is **izzul.asyraf@tamco.com.my**, with visibility across all TAMCO departments and all Finding Management business views.

This applies to the new Finding module and its overview, register, verification view, imports, reports, guest response/My Actions surfaces and associated notifications. It does not revoke existing TAMCO Focus access, change its operational workflow or hide existing shared administration needed to manage the rollout.

Resolve Izzul's existing verified identity in the correct organization through trusted server-side identity data. Seed an auditable, organization-scoped rollout entitlement bound to its stable identity ID. Do not authorize from a browser-supplied email, display name or unverified profile field. If no unique verified match exists, keep the feature restricted and report the unresolved bootstrap identity; do not create a password/account or grant similarly named users access.

Full visibility means organization-wide read access to Finding records, including restricted records within the organization's authorized internal ESH boundary, and the new business screens. Preserve any existing authorized Coordinator/Verifier/Administrator capabilities. This instruction does not automatically grant closure authority, allow self-verification, reveal secrets or grant access to another organization. Technical configuration still requires its appropriate administrator capability.

All other staff and email contacts start disabled for the new module, including managers, ESH department members and other administrators. Existing administrators may maintain rollout/access configuration through shared administration, but that does not itself grant them Finding business-data access.

### 43.2 Simple administrator control

Reuse **Identity & Access → selected person/contact → Finding Management access**:
- **Enable access** switch, default Off for everyone except the resolved Izzul identity.
- Registered staff: module role and explicit department scope, using section 31.
- Email-link contacts: enabled participation and its existing action/escalation/report entitlement; enabling a contact does not grant organization-wide visibility.
- Show who enabled/disabled access and when. Save records an audit event and increments authorization version.

An administrator deliberately enables selected people when ready. Do not automatically enable the team after deployment, import release, adding a department, assigning a manager role, adding an action owner or activating a report schedule. Creating an assignment/contact is not permission to bypass the rollout restriction.

Use a global rollout mode **Restricted** by default, plus per-identity entitlements. In this release access remains explicitly controlled; do not implement an automatic date-based launch or “everyone enabled” fallback. A future broad launch requires an explicit authorized decision.

Preserve the initial Izzul entitlement on routine deployments without re-enabling identities an administrator intentionally revoked. Initialization is idempotent and only seeds the intended first setup. Prevent accidental removal of the last authorized rollout administrator through normal access editing; use existing account-recovery procedures rather than a hidden email-based bypass.

### 43.3 Enforce availability everywhere

Authorization is the intersection of: correct organization, active identity, rollout enabled, purpose-specific module/guest entitlement, permitted operation and resource scope.

For a disabled person:
- Hide Finding Management cards, module-switcher entries, menus, search results, badges and notification counts. No disabled teaser card is needed.
- Reject direct routes, APIs, server actions, exports, signed-file issuance and realtime subscriptions; hiding navigation alone is insufficient.
- Do not issue/redeem new owner, escalation or report access grants; reject existing guest sessions at the next request.
- Do not send new Finding assignment, reminder, escalation or report emails to that recipient during the restricted rollout.

Izzul may inspect all authorized internal Finding data, but an owner link still cannot impersonate a different Action Owner. Guest testing requires an explicit permitted contact and real scoped assignments; full staff visibility does not remove guest-purpose boundaries.

Do not expose private content in denied-route HTML, cached responses or error messages. Authorization changes must invalidate affected sessions/cache access and be checked again before file issuance and background dispatch. Existing short-lived file URLs follow the previously specified expiry/revocation model; avoid claiming already downloaded evidence can be recalled.

### 43.4 Backlog and notification behavior while restricted

Izzul can review/import the backlog internally. Owners whose rollout access is Off may be recorded as intended assignees, but notification release must show them as **Access not enabled — notification held**. Do not silently enable them, send unusable links, mark notifications delivered or treat access failure as owner inactivity.

Keep unreleased imported work in staging under section 38. For any live restricted record, show ESH that owner notification/follow-up activation is held; preserve its actual due date and overdue information. Do not escalate to a superior merely because the owner was not allowed into the new workflow.

Enable access and release notifications are separate deliberate operations. After enablement, ESH reviews/releases the held assignments; catch-up policy applies from the explicit follow-up activation as defined in section 38. Do not replay accumulated reminder emails. Other disabled recipients, including escalation points and leadership report recipients, remain blocked independently.

Blocked report deliveries and action notifications have an auditable rollout-held state distinct from bounce, failure or delivery. Pausing/revoking a person later cancels queued sends, blocks access and surfaces outstanding work to ESH for handling; it never closes the work.

### 43.5 Implementation and acceptance gate

Add organization rollout settings and organization/identity rollout entitlements with enabled state, actor/time and authorization version. Integrate the gate into the existing centralized authorization guard and notification dispatcher; do not maintain unrelated frontend/backend allowlists.

Implement and verify this restriction before exposing the new module or enabling production notification jobs. Deployment must fail closed if the rollout configuration is absent/unreadable. Existing TAMCO Focus operation must continue.

| ID | Acceptance scenario |
| --- | --- |
| FM101 | First setup enables only the uniquely resolved verified izzul.asyraf@tamco.com.my identity for organization-wide Finding visibility; all other team identities remain disabled. |
| FM102 | Izzul can view all authorized TAMCO Finding business views/departments; verification and administrative mutations still obey capabilities and segregation of duties. |
| FM103 | Disabled users see no new Finding entry/count/search data, and direct page/API/file/realtime access is denied. |
| FM104 | Admin explicitly enables one staff user with a selected role/scope; only that user gains that permitted access and other users remain disabled. |
| FM105 | Creating an owner/contact/escalation/report recipient does not enable rollout access or send email; blocked delivery is visible as rollout-held. |
| FM106 | Enabling a contact does not widen action/report scopes or release held assignment emails automatically; approved release sends eligible summaries once. |
| FM107 | Disabling access invalidates subsequent staff/guest requests and queued dispatch, preserves all work/history and flags unresolved obligations to ESH. |
| FM108 | Repeated deployments do not reopen intentionally revoked access; missing configuration fails closed; existing Focus access and shared administration remain functional. |

This is a specification requirement, not a claim that production access has already changed. The implementing agent must provide verification evidence before stating that the team is blocked and Izzul's access is active.
