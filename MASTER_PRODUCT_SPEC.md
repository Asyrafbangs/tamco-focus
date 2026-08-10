# TAMCO Focus — Master Product Specification

**Document status:** Authoritative product source of truth  
**Baseline:** v49 attention summary and exact-action UI repair — v37 synchronized baseline plus v38 audited due commitments and checklist-derived progress, and the v40 to v49 revisions recorded in section 33
**Product name:** TAMCO Focus  
**Document owner:** Product Owner / EHS Manager  
**Prepared:** 7 August 2026  
**Applies to:** Desktop web application, mobile web application, backend services, database, notifications, records, permissions, and audit controls

---

## 0. Document control

### 0.1 Purpose

This document consolidates the latest approved product vision and requirements agreed during the complete prototype-design conversation. It records the intended production behaviour of TAMCO Focus so that developers, Codex, Claude Code, designers, testers, reviewers, and future maintainers do not need to reconstruct requirements from chat history or earlier prototype versions.

Earlier ideas that were later replaced are not requirements unless they are explicitly retained here.

### 0.2 Source-of-truth hierarchy

When documentation or prototype behaviour conflicts, use this priority:

1. `MASTER_PRODUCT_SPEC.md` — latest approved product requirement and product intent.
2. `PRODUCTION_LOGIC.md` — detailed state, validation, transaction, audit, and implementation logic.
3. Desktop and mobile prototypes — visual and interaction acceptance reference.
4. `README.md` — package opening and review instructions.
5. Change history — explanation of approved revisions.

The production application must not infer missing business rules solely from sample data or prototype JavaScript.

### 0.3 Mandatory maintenance rule

Every future approved product change must update, in the same revision:

- `MASTER_PRODUCT_SPEC.md`
- `PRODUCTION_LOGIC.md` when workflow, validation, permissions, data, or audit behaviour changes
- `desktop/index.html`
- `mobile/index.html`
- `README.md`
- `ONE_SHOT_LOCAL_BUILD_PROMPT.md` when implementation instructions change
- `AGENTS.md` and `CLAUDE.md` when coding-agent operating rules change
- change history or revision notes

A visual-only change must still update the relevant UX section in this specification when it changes an approved design pattern.

### 0.4 Revision discipline

Each revision must record:

- date
- affected module
- previous behaviour
- approved new behaviour
- reason for change
- impact on desktop
- impact on mobile
- impact on backend, data, permissions, notifications, or audit
- migration impact, if any

---

# 1. Product vision

TAMCO Focus is a lean work-management system for employees, managers, and administrators. It helps users:

- understand what needs attention today
- manage current focus without hiding routine workload
- capture work identified by employees themselves
- maintain visible priorities without requiring manager approval for every action
- collaborate on shared tasks
- record evidence and updates
- raise barriers early
- manage recurring duties
- review completed work where accountability requires it
- preserve a reliable, timestamped audit trail

The system must feel like a practical daily workspace, not an administrative form repository.

## 1.1 Core operating principle

> Employees own execution and may manage their own work. Managers provide direction, urgency, visibility, and support. The system provides guardrails, transparency, and auditability.

## 1.2 Lean design principle

The interface must answer the next useful question rather than display the entire database.

Examples:

- **My Day:** What needs attention and what should I do next?
- **My Focus:** What sustained commitments am I actively carrying?
- **Routine Work:** What scheduled occurrence must I complete?
- **Team Focus:** Who needs management attention, where is focus under pressure, and what changed?
- **Records:** What completed evidence or retained record needs review?

## 1.3 Product principles

1. **Capture first, classify afterward.**
2. **Focus targets guide behaviour but do not block necessary work.**
3. **Routine work is scheduled separately from sustained focus.**
4. **Exceptions receive attention; normal work remains visually quiet.**
5. **One task has one primary accountable owner.**
6. **Collaboration does not automatically create duplicate capacity load.**
7. **Evidence and updates are timestamped automatically.**
8. **Viewing evidence is not the same as accepting completion.**
9. **Visibility is separate from editing and approval authority.**
10. **Destructive and high-impact actions require explicit confirmation and audit.**
11. **Desktop and mobile provide equivalent essential capability using layouts appropriate to each device.**
12. **Colour is never the only status signal.**

---

# 2. Scope

## 2.1 In scope

- role-based access and user visibility
- My Day decision dashboard
- My Focus workspace
- Quick Actions
- Major Projects
- Operational Actions
- Self-Development Plans
- Available Work
- Active, Paused, Completed, and archived/cancelled outcomes
- soft focus targets
- Capture Work
- employee-initiated work
- manager-assigned work
- routine templates and routine occurrences
- checklists
- task updates
- file and screenshot attachments
- evidence requirements
- collaboration and checklist handoffs
- barriers and support requests
- Related Work / task dependencies
- Monthly Plan
- Team Focus
- Meeting Queue / decision queue
- completion review
- Records, attachments, audit history, and archive
- personal settings
- manager rules
- administrator visibility rules
- day and night themes
- desktop and mobile layouts
- loading, empty, validation, error, permission, and success states

## 2.2 Out of scope for the visual prototype

The current HTML prototypes do not implement:

- production authentication
- persistent database storage
- production RLS policies
- real file storage
- virus scanning
- email delivery
- background jobs
- live calendars
- production API integrations
- final retention configuration

These must be implemented in production according to this specification and supporting technical documents.

---

# 3. User roles and authority

## 3.1 Team Member / Task Owner

A team member may:

- view their own authorised work
- capture self-initiated work
- create Quick Actions
- create Operational Available Work
- propose a Routine Template
- propose a Major Project
- create or activate a Self-Development Plan, subject to focus behaviour
- activate assigned Available Work
- activate beyond the recommended focus target after answering one reason question
- move their Active work back to Available Work
- pause and resume their own work where permitted
- complete checklist items
- post updates
- attach files and pasted screenshots
- raise barriers
- collaborate on tasks shared with them
- complete routine occurrences
- request schedule changes
- submit completion with evidence
- view their own records and audit history

A team member may not silently:

- change another user’s primary ownership
- alter manager-set urgency or mandatory classification without permission
- change organisation-wide focus targets
- edit routine templates without authority
- accept their own completion when independent review is required
- grant themselves visibility to other users
- change retention or audit-access policies

## 3.2 Manager

A manager may, within authorised scope:

- assign tasks
- define owner, bucket, urgency, due date, and review-by date
- view authorised team members’ focus and routine load
- set team-level focus targets where allowed
- review over-target reasons
- respond to barriers
- manage Meeting Queue decisions
- create or manage routine templates
- review completion evidence
- Accept Completion or Request Changes
- reassign or reprioritise work when authorised
- configure team alerts and completion-review rules
- use temporary delegation
- access authorised team records and audit history

A manager is not required to approve:

- every captured item
- every Quick Action
- ordinary within-target activation
- ordinary over-target activation after the owner records a reason
- checklist completion
- routine occurrence completion without exceptions
- ordinary updates and attachments

## 3.3 Administrator

An administrator may:

- configure system-wide settings
- configure user visibility rules
- configure organisation-wide focus targets
- manage role capabilities
- manage retention and audit-access policies
- review all authorised records
- manage administrative delegations
- view and audit high-impact configuration changes

## 3.4 Visibility versus authority

View access does not grant:

- task editing
- task activation
- reassignment
- completion acceptance
- evidence approval
- urgency changes
- manager authority

These remain controlled separately by role and task-specific permissions.

---

# 4. Navigation and information architecture

## 4.1 Permanent desktop navigation

The lean permanent destinations are:

- **Today**
- **Work**
- **Goals**
- **Plan**
- **Team** — manager and administrator only
- **More**

The desktop design uses a compact navigation rail. Labels appear through clear accessible navigation treatment and must remain understandable through keyboard focus and assistive technology.

## 4.2 Mobile navigation

Mobile uses a labelled bottom navigation appropriate for touch interaction. Essential destinations must remain reachable without opening deep menus.

## 4.3 Contextual pages

These are not permanent primary-navigation items:

- Task Detail
- Routine Detail
- completion-review detail
- attachment preview
- record detail
- Meeting Queue detail
- Settings detail

They open contextually through drawers, panels, sheets, or dedicated pages.

## 4.4 Work sub-navigation

Work contains:

- **Focus**
- **Routine**

Focus contains tabs:

- Major Project
- Operational Actions
- Self-Development Plan
- Shared / Collaborative
- Available Work

Only one focus tab’s content is displayed at a time.

## 4.5 More

More provides lower-frequency modules such as:

- Records
- Settings
- other authorised utilities

Prototype documentation is not part of the production user navigation.

---

# 5. Terminology

Use these terms consistently:

| Approved term | Meaning |
|---|---|
| Available Work | Valid Backlog work not currently Active |
| Active | Work currently part of the primary owner’s focus |
| Paused | Work temporarily stopped with restart or review information |
| Completed | Work completed with required evidence |
| Focus target | Recommended Active count, not a blocking quota |
| Major Project | One sustained strategic result |
| Operational Action | Sustained follow-up, corrective action, coordination, or commitment |
| Self-Development Plan | Active self-improvement plan such as self-learning, e-learning, coaching, certification preparation, or competency practice |
| Quick Action | Small same-day, low-governance work |
| Routine occurrence | One scheduled instance generated from a recurring template |
| Primary Owner | One person accountable for the task |
| Collaborator | Person contributing without becoming primary owner |
| Barrier | Explicit request for support or decision affecting progress |
| Related Work | Plain-language relationship to another task or routine |
| Completion Review | Manager or verifier decision after task completion |

Avoid presenting focus targets as “hard limits,” “quotas,” or “cannot activate.”

---

# 6. Work model

## 6.1 Normal task states

Only these states appear in the normal task lifecycle:

- `backlog` — displayed as Available Work where appropriate
- `active`
- `paused`
- `completed`

Cancellation is a terminal archived outcome, not a normal working column.

## 6.2 Work origins

Each work item records its origin:

- manager assigned
- self-initiated
- routine generated
- finding generated
- collaborative request
- meeting generated
- system generated

Origin is metadata, not a state or separate board.

## 6.3 Work classes

### Quick Action

Use when work is:

- expected to finish in the same working day
- primarily owned by one person
- low governance
- not safety, legal, audit, or customer critical
- not dependent on extensive follow-up
- not requiring formal completion review

Quick Actions do not consume focus targets.

If a Quick Action continues beyond the day, gains dependencies, needs formal evidence, requires coordination, or becomes substantial, the system prompts conversion to Operational Available Work.

### Routine Work

Use for work that:

- repeats on a known schedule
- uses a standard checklist or evidence rule
- has a recurring accountability need
- should produce a separate record for each occurrence

Routine work does not consume focus targets.

### Major Project

Use for a sustained strategic result or substantial change programme requiring protected focus.

### Operational Action

Use for multi-day follow-up, corrective action, coordination, cross-functional work, or important commitments.

### Self-Development Plan

Use for one active personal capability-improvement plan, including:

- self-learning
- e-learning
- coaching or mentoring
- certification preparation
- professional reading
- competency practice
- deliberate skill-building actions

### Collaborative Contribution

Use for a small assigned contribution inside another owner’s task. It does not consume another focus slot unless converted into a separately accountable work item.

---

# 7. Focus targets and activation

## 7.1 Default targets per primary owner

- Major Project: 1
- Operational Actions: 5
- Self-Development Plan: 1

These apply independently to each user.

## 7.2 Soft-target rule

The targets are recommendations, not hard limits.

The system must never disable activation solely because the user reached the target.

## 7.3 Within-target activation

When the resulting count is within target:

- one-click Activate
- no confirmation
- no manager approval
- timestamp and audit record
- count recalculates immediately
- approximately 10-second Undo

## 7.4 Over-target activation

When activation will exceed the target:

- Activate remains available
- ask exactly one trigger question explaining current count and resulting count
- require one reason
- require a note only when “Other” is selected
- activate immediately after reason submission
- no approval required
- notify manager
- show count in red, for example `6 / 5`
- show written label **Over focus target**
- preserve reason in audit history
- provide Undo

Approved reason options:

- urgent deadline or commitment
- temporary workload peak
- current work cannot reasonably be moved out
- manager, customer, or regulatory request
- dependency requires both tasks to remain active
- other

## 7.5 Move to Available Work

Active focus tasks display a quiet secondary action:

- **Move out** in compact rows
- **Move to Available** in detailed views

One action changes Active to Available Work while preserving:

- owner
- bucket
- urgency
- due/review date
- progress
- checklist
- comments
- evidence
- relationships
- audit history

Provide Undo.

## 7.6 Over-target visibility

Team members and managers see:

- current count and target
- red over-target indicator
- written label
- tasks contributing to the condition
- reason for the additional focus
- duration above target

Manager approval is not required, but discussion or reprioritisation may occur.

---

# 8. Capture Work

## 8.1 Objective

Employees must be able to record newly identified work in approximately ten seconds without understanding the full classification model.

## 8.2 Initial capture screen

Show only:

- **What needs to be done?** — required
- **When is it needed?** — Today, This week, Choose date, No date yet
- optional file/photo/screenshot attachment
- **Add Work**

Secondary actions:

- Add more details
- Report urgent safety or compliance work

## 8.3 Attachment capture

Support:

- desktop drag and drop
- standard file chooser
- pasted screenshot
- mobile camera or file upload

Attachments are optional unless the urgent or final classified workflow requires evidence.

## 8.4 Classification after capture

After Add Work, the system recommends one destination:

- Quick Action
- Operational Available Work
- Routine Template Request
- Self-Development Plan
- Collaborative Contribution
- Major Project Request
- Mandatory Operational Action

The default result screen shows only:

- recommended destination
- captured title
- one-sentence reason
- due timing
- capacity effect
- manager visibility effect
- quiet audit message
- **Change type**
- **Edit details**
- **Confirm & Create**

The full type list is hidden until Change type is selected.

Desktop uses a compact chooser or focused panel. Mobile uses a bottom sheet.

## 8.5 Clarifying questions

Ask only one relevant follow-up question when the system cannot classify confidently.

Example:

> Will this require continued follow-up after today?

Avoid presenting all classification questions simultaneously.

## 8.6 Urgent wording

Safety, PPE, legal, or compliance keywords must not automatically create a Mandatory Operational Action.

When potentially urgent wording is detected, ask:

> Does this need immediate controlled action because of an active safety risk, legal requirement, or compliance deadline?

- No → continue ordinary classification
- Yes → Mandatory Operational Action and immediate manager notification

Mandatory Operational Action is not included in the ordinary Change type list.

## 8.7 Classification implementation

The production implementation may be rules-based, AI-assisted, or hybrid, provided that:

- the user sees the recommendation reason
- the user may correct the recommendation
- there is a deterministic fallback when AI is unavailable
- the final type and origin are audited
- mandatory classification is never based solely on keywords

## 8.8 Self-initiated work governance

Employees may create and manage their own work.

Manager approval is generally not required for:

- Quick Actions
- Operational Available Work within normal authority
- checklist contributions
- routine occurrence completion
- updates and evidence

Manager or administrator review is required for:

- Major Project proposals
- new recurring Routine Templates
- mandatory safety/legal/compliance actions
- cross-department ownership or significant resource commitments
- high-impact reclassification
- capacity override rules if policy later requires it

---

# 9. My Day

## 9.1 Purpose

My Day is a decision page, not a full system summary.

It answers:

1. What requires attention?
2. What should I do next?
3. What is coming soon?

## 9.2 Structure

- page header with date and role-appropriate actions
- conditional Needs Attention banner
- one Start Here recommendation
- Why this? explanation
- short Today list
- compact workload summary
- limited Coming Up section

Duplicate “Open a workspace” cards are not required.

## 9.3 Needs Attention

Show only genuine exceptions:

- urgent safety/legal/compliance action
- overdue work
- open barrier
- missing mandatory evidence
- missed selection deadline
- paused review date passed
- manager decision required
- overdue routine
- completion review overdue

Do not use as a general notification count.

## 9.4 Start Here prioritisation

Rank work in this order:

1. immediate safety, legal, or compliance action
2. overdue or blocked work requiring the user
3. work due today, ordered by due time
4. review or selection deadline today
5. collaborative handoff ready
6. next action from Active focus work
7. due soon within the configured upcoming window

Tie-breaking order:

1. earliest exact due time
2. Critical before High before Normal
3. work blocking the most other work
4. oldest unresolved barrier
5. least recently updated
6. manager-set review deadline

The recommendation guides but does not force.

## 9.5 Why this?

Every Start Here recommendation provides a plain-language explanation, such as:

> Selected because this routine is due today before your other commitments.

## 9.6 Today list

Limit the list to approximately three to five useful items, combining:

- routine due today
- collaborative handoff ready
- next focus action
- meeting or review due today
- Quick Actions

Selecting an item opens its task or routine detail.

## 9.7 Coming Up

Show only the nearest two or three commitments within the configured upcoming window, followed by View Monthly Plan.

---

# 10. My Focus / Work workspace

## 10.1 Focus tabs

- Major Project
- Operational Actions
- Self-Development Plan
- Shared / Collaborative
- Available Work

## 10.2 Tab badges

- neutral badge: active count or count against target
- red or amber badge: action required
- do not use generic unexplained notification counts

## 10.3 Task row content

Display only:

- task title
- next action
- quiet progress indicator
- due or review date
- exception label where needed
- Open
- relevant Activate or Move out action

## 10.4 Task detail pattern

Selecting a task opens a right-side master-detail drawer on desktop and full-width sheet on mobile.

Full-page expansion remains available for complex work.

The detail view includes:

- task title and work type
- compact metadata row
- red barrier action near the top
- Next action
- checklist
- updates
- attachments and evidence
- collaborators
- Related Work
- recent activity
- full history

---

# 11. Checklists and progress

## 11.1 Checklist use

Use checklists for verifiable steps. Do not force a checklist on every simple task.

Each item may include:

- action
- assigned person
- evidence rule: not required, optional, required
- due date only when different from parent task
- dependency on another checklist item

## 11.2 Completion

When evidence is not required:

- one tap completes
- system records user and timestamp

When evidence is required:

- compact completion panel
- completion note
- required attachment
- complete item

## 11.3 Progress source

When a checklist exists, checklist completion is the single progress source.

Do not also ask the user to manually enter a conflicting progress percentage.

For tasks without a checklist, a simple manual progress control may be used.

## 11.4 Reopening

Reopening an item creates a reversal event. It does not erase the original completion event.

---

# 12. Updates and attachments

## 12.1 Update composer

The update composer is accessible near Next action but remains collapsed or visually quiet until needed.

Prompt:

> What changed, and what happens next?

Support:

- written update
- paste screenshot
- drag and drop
- multiple files
- mentions
- evidence-only update
- raise barrier

## 12.2 Automatic record

Every update records:

- author
- date and time
- related task
- attachment references
- mention recipients
- resulting checklist or status change where applicable

## 12.3 Routine update rule

Completing a routine checklist is the routine’s progress update. Do not require a duplicate text update unless explanation is useful.

---

# 13. Collaboration

## 13.1 Accountability

Every task has one Primary Owner.

Collaborators may:

- complete assigned checklist items
- post updates
- attach evidence
- paste screenshots
- raise barriers
- view authorised shared history

## 13.2 Capacity treatment

A small contribution does not consume another focus target.

Convert to a separate Operational Action only when the contribution becomes:

- substantial
- multi-day
- independently accountable
- separately due
- dependent on several follow-ups

## 13.3 Handoff

Dependent checklist items may move from Waiting to Ready automatically when the prerequisite item is completed.

Example:

- Izzah completes stock replenishment.
- Amer’s briefing item becomes Ready.
- Amer sees it in Shared with Me and My Day.

---

# 14. Barriers and support

## 14.1 Position and appearance

Raise Barrier is visible near the top of task detail.

Use a quiet neutral support row when no barrier exists. Reserve red/pink alert treatment for an actual open barrier.

Include an information control explaining when to raise one.

## 14.2 Barrier form

Ask:

- What is the barrier?
- What support is needed?
- What is the impact if unresolved?
- optional evidence
- whether to add to Meeting Queue

Impact options include:

- task may be delayed
- work cannot continue
- safety or compliance risk
- management decision required

## 14.3 State effect

A barrier does not automatically pause a task.

If the user states work cannot continue:

- task becomes Paused or blocked according to policy
- review or restart information is required

Otherwise, task remains Active.

## 14.4 Notifications

Barrier creation records actor and timestamp, notifies relevant people, and adds to Meeting Queue when configured.

---

# 15. Related Work

## 15.1 User-facing wording

Use **Related Work**, not complex dependency terminology.

## 15.2 Relationships

- Before this task
- After this task
- Related only

## 15.3 Behaviour

A relationship must not silently change:

- status
- owner
- priority
- due date
- focus target

When a prerequisite completes, notify the affected owner and prompt review or resumption.

Ordinary collaboration should remain checklist-based rather than creating unnecessary linked tasks.

---

# 16. Routine Work

## 16.1 Template and occurrence model

A controlled Routine Template creates separate Routine Occurrences.

The template does not stay permanently Active.

Each occurrence has its own:

- due date and time
- owner
- checklist
- evidence
- findings
- status
- completion record
- audit history

## 16.2 Template authority

Managers or administrators create and maintain templates. Team members may suggest or request a routine but do not create uncontrolled duplicates.

## 16.3 Routine visibility

Only current and relevant upcoming occurrences are shown. Future cycles do not flood the interface.

## 16.4 Findings

Minor finding:

- correct and close inside the occurrence

Significant finding:

- create linked Operational Available Work
- assigned owner decides activation according to focus rules

Immediate serious risk:

- create or activate Mandatory Operational Action

## 16.5 Completion

Routine completion requires:

- required checklist items
- required evidence
- findings recorded

Completing one occurrence does not close the recurring template.

## 16.6 Routine burden

Routine work does not consume focus targets, but Team Focus may show:

- occurrences this week
- completed
- upcoming
- overdue
- approximate expected effort

---

# 17. Monthly Plan

## 17.1 Purpose

Monthly Plan provides an overview of due and planned work without cluttering My Day.

## 17.2 Events shown

- Active task due dates
- overdue work
- planned or Available Work dates
- routine occurrences
- review and selection deadlines
- project milestones
- Self-Development review dates

## 17.3 Interaction

Every item is clickable and opens the relevant task, routine, or selection view.

The calendar is primarily informational. It must not allow ungoverned drag-and-drop changes to due date, ownership, or task state.

## 17.4 Mobile

Mobile uses a date-grouped agenda rather than forcing a compressed desktop calendar grid.

---

# 18. Team Focus

## 18.1 Purpose

Team Focus is the manager exception-first workspace. It answers three questions quickly:

1. Who needs management attention?
2. Where is focus under pressure?
3. What changed meaningfully?

It is not a full expanded workload report for every employee.

## 18.2 Default view

- compact people list
- default filter: **Needs attention**
- optional **Everyone** view
- default sort: management priority
- optional name sort
- each person row shows identity, meaningful exception indicators, compact Major / Operational / Development focus counts, highest current concern, and last meaningful activity
- empty focus categories do not create large panels
- focus capacity is numeric and must not be represented as task-completion progress bars

## 18.3 Priority order

Default priority sorting is:

1. barrier, safety or critical issue
2. overdue work
3. manager decision waiting
4. over-focus-target condition
5. stale work
6. normal work

## 18.4 Team-member detail

Selecting a person opens a right-side detail drawer on desktop and full-width detail on mobile. The detail prioritises:

- actionable manager attention
- current focus
- each current task's Next action
- selective abnormal ageing
- compact Available Work summary
- routine workload
- goal exceptions
- link to the employee workspace where authorised

## 18.5 Information discipline

Normal short-lived task age remains visually quiet. Age becomes prominent when overdue, stale, unusually old, or long-paused. Raw activity counts such as work created this week do not appear by default unless an unusual volume has a management implication.

## 18.6 Permissions

Team Focus is a presentation layer over existing authorised tasks, routines, goals, barriers and audit events. It does not grant new permissions or create duplicate manager-only data.

# 19. Meeting Queue

## 19.1 Purpose

Meetings discuss only items needing:

- decision
- support
- escalation
- reprioritisation
- clarification

Normal task-by-task status reading is not required.

## 19.2 Sources

- open barriers
- overdue high-impact work
- stale work
- over-target focus needing discussion
- missed selection deadlines
- completion review overdue
- unresolved dependency

## 19.3 Decision record

Record:

- decision or agreed action
- owner
- due date
- related task
- author
- timestamp

The decision becomes part of task activity and audit history.

---

# 20. Completion and completion review

## 20.1 Completion validation

A task cannot complete when required checklist items or evidence are missing.

The system must explain exactly what is missing and how to fix it.

## 20.2 Review metadata

Pending Review is review metadata, not a fifth task state.

## 20.3 Review policy

Configurable by work type:

- safety, legal, incident, and audit action
- Operational Action with mandatory evidence
- ordinary routine occurrence
- Self-Development Plan

## 20.4 Evidence viewing

Opening an attachment automatically records:

- reviewer
- attachment
- date and time

Do not require a manual Viewed checkbox.

## 20.5 Manager decision

After reviewing required evidence, the reviewer chooses:

- **Accept Completion**
- **Request Changes**
- optional review note

Viewing is not acceptance.

## 20.6 Request Changes

Request Changes preserves history and follows the configured outcome:

- reopen to Active after focus check, or
- return to Available Work

The default must be explicit in Settings and must not be invented by implementation.

## 20.7 Ordinary routines

Ordinary routine occurrences may auto-archive unless:

- exception exists
- mandatory evidence requires review
- policy requires review

---

# 21. Records

## 21.1 Record areas

- Completion Reviews
- All Records
- Attachments
- Audit History
- Archive

## 21.2 Search and filters

Support:

- title or reference
- owner
- record type
- state
- review outcome
- date range
- attachment status

## 21.3 Record preservation

Completed and archived records retain:

- task information
- comments
- checklist
- attachments
- evidence
- completion decision
- audit events
- related work

## 21.4 Archive

Archive is searchable. Archive is not deletion.

---

# 22. Settings

## 22.1 Design principle

Settings must contain meaningful operational or personal decisions only. Do not add controls merely because settings pages normally contain them.

Use a lean master-detail pattern.

## 22.2 Personal settings

### My Workspace

- default opening page
- daily brief frequency and time
- quiet hours for non-critical reminders
- first day of week
- read-only account identity and timezone where controlled externally

### My Alerts

- barrier/support involving me
- assignment/reassignment
- collaborative handoff
- due-today and selection deadlines
- routine upcoming
- in-app/email/digest behaviour where permitted

### Accessibility

- Follow device, Day, or Night theme
- text size
- reduced motion
- written status labels always visible
- keyboard shortcut hints

## 22.3 Manager rules

### Focus Capacity

- default targets
- self-selection allowed
- reason required when replacing Active work
- urgency requires review-by
- stale update threshold

### Completion Review

- review by work type
- default reviewer
- review target
- Request Changes outcome
- dual verification where required

### Routine Work

- who may create templates
- how early occurrences appear
- missed-routine escalation
- significant-finding handling
- ordinary routine archive behaviour

### Alerts and Escalation

- barrier escalation
- selection deadline missed
- mandatory overdue
- stale Active work
- completion review overdue

## 22.4 Security and Records

- role capability matrix
- temporary delegation
- retention policy — administrator controlled
- audit-history access
- high-impact changes require audit

## 22.5 Visibility Rules / RLS administration

Administrator-only master-detail setting.

For each viewer, configure:

- Specific people only
- Direct reports + selected people
- No team visibility

Use searchable people chips and effective-access preview.

Example:

- Amer may view Izzah and Ajmal because they are his interns.

Default security model:

> Default deny → own work always visible → inherited direct reports where configured → explicit additional visibility granted by administrator.

All changes create an immutable administrator audit event.

---

# 23. Notifications

## 23.1 Principle

Notifications are targeted and limited. Routine information should be combined into My Day or digest views.

## 23.2 Immediate notifications

- barrier raised
- work cannot continue
- mandatory safety/legal/compliance action
- urgent manager decision
- reassignment affecting user
- completion review assignment where immediate action is required

## 23.3 Non-immediate notifications

- ordinary assignment
- upcoming routine
- due-soon work
- stale-work digest
- routine summary

## 23.4 Red indicators

Use red notification dots or counts only when action is genuinely required.

Examples:

- open barrier
- overdue mandatory work
- missed selection deadline
- manager decision waiting

Every red indicator must have a written explanation.

---

# 24. Audit and traceability

## 24.1 Immutable audit events

Record at minimum:

- creation
- origin
- classification recommendation and final classification
- assignment and reassignment
- activation
- over-target reason
- Move to Available Work
- pause and resume
- checklist completion and reopening
- update and attachment
- barrier raised and resolved
- relationship added or removed
- completion submission
- evidence opened
- Accept Completion
- Request Changes
- settings changes
- visibility/RLS changes
- Undo/reversal

## 24.2 Automatic timestamps

Users do not manually enter action timestamps.

## 24.3 Undo

Undo creates a reversal event linked to the original event. It never deletes history.

---

# 25. UI and interaction specification

## 25.1 Visual direction

- corporate blue, white, light grey, dark navy
- neutral typography
- light borders
- minimal shadow
- no unnecessary gradients
- moderate corner radius
- clear whitespace
- professional enterprise appearance

## 25.2 Typography

- regular weight for descriptions and metadata
- medium for labels, tabs, and buttons
- semibold for headings and task names
- avoid heavy bold across normal content

## 25.3 Master-detail pattern

Use for:

- tasks
- routines
- records
- completion review
- visibility settings
- other list-detail workflows

Desktop opens a right-side panel. Mobile opens a full-width sheet or dedicated detail surface.

## 25.4 Drawers and panels

Include:

- close
- expand when complex
- tabs only when they reduce content overload
- keyboard Escape
- preserved context behind drawer

## 25.5 Metadata row

Status, due/occurrence, urgency, and progress use compact readable metadata chips or a quiet meta row, not sentence-like boxed label/value strips.

## 25.6 Buttons

- one clear primary action per context
- secondary actions visually quiet
- destructive actions separate
- disabled states explain why where needed
- touch target suitable for mobile

## 25.7 Themes

One top-bar toggle switches Day and Night modes.

Requirements:

- saved preference
- first use may follow device preference
- equivalent contrast and status meaning
- mobile compact toggle

## 25.8 Accessibility

- colour contrast appropriate for enterprise use
- colour not sole status signal
- visible focus state
- keyboard-friendly tabs, drawers, forms, and dialogs
- reduced-motion option
- readable text sizes
- meaningful labels and instructions

---

# 26. Desktop and mobile requirements

## 26.1 Separate deliverables

Every approved revision must include:

- `desktop/index.html`
- `mobile/index.html`

Mobile is not merely a smaller desktop page.

## 26.2 Equivalent capability

Desktop and mobile must both support essential actions:

- My Day
- Capture Work
- task activation
- over-target reason
- Move to Available Work
- checklist completion
- updates and attachments
- barriers
- routine completion
- Monthly Plan
- collaboration
- completion review where authorised

## 26.3 Mobile adaptations

- bottom navigation
- full-width sheets
- horizontal tab scrolling where needed
- date-grouped agenda for Monthly Plan
- camera/file upload
- thumb-reachable primary actions
- no dense desktop tables

---

# 27. Loading, empty, error, validation, and permission states

## 27.1 Loading

- preserve layout with skeletons
- do not show misleading zero values while loading

## 27.2 Empty

Explain:

- what is empty
- why it may be empty
- the next useful action

## 27.3 Validation

- inline, specific, and actionable
- preserve entered data
- focus first invalid field

## 27.4 Error

- explain whether anything changed
- provide Retry where safe
- provide return path
- do not silently lose attachments or updates

## 27.5 Permission denied

- explain that access is restricted
- do not reveal unauthorised data
- provide authorised return path

## 27.6 Conflict

When another user changed the record:

> This task was updated by another user. Review the latest information before continuing.

Do not silently overwrite.

---

# 28. Non-functional product requirements

## 28.1 Security

- authenticated access
- least privilege
- server-enforced RLS
- private attachment storage
- signed access where appropriate
- audit of high-impact actions
- input validation
- protection against duplicate actions and replay

## 28.2 Reliability

- transactional task state changes
- idempotent repeated clicks
- recoverable background jobs
- no partial activation/reassignment transactions

## 28.3 Performance

The application should feel immediate for ordinary navigation and task actions. Exact service-level targets remain to be defined before production build.

## 28.4 Data retention

Retention duration and legal policy are administrator-controlled and remain an unresolved implementation decision until formally approved.

## 28.5 Browser and device support

Exact supported browser versions remain to be defined, but production must support modern desktop and mobile browsers used by TAMCO employees.

---

# 29. Acceptance criteria by capability

## 29.1 Capture Work

- user records work with title, timing, and optional attachment
- system recommends destination afterward
- user may change recommendation
- urgent wording asks one clear question
- mandatory classification is not based only on keywords
- origin and timestamp are retained

## 29.2 Focus

- each user has independent 1 / 5 / 1 targets
- within-target activation is one click
- over-target activation asks one reason and proceeds
- red over-target state is visible
- Move to Available Work is one action
- Undo preserves audit history

## 29.3 Routine

- template creates separate occurrences
- current occurrence is independently completed
- routine does not consume focus target
- significant finding can create Operational Available Work

## 29.4 Collaboration

- collaborator sees assigned contribution
- collaborator updates same task
- handoff becomes Ready after prerequisite completion
- small contribution does not consume separate focus target

## 29.5 Barrier

- barrier is easy to raise
- support needed and impact are recorded
- manager is notified
- Meeting Queue behaviour is configurable
- task pauses only when work cannot continue

## 29.6 Completion review

- required evidence must exist
- evidence opening is logged automatically
- reviewer selects Accept Completion or Request Changes
- manual Viewed checkbox is not required
- review decision is audited

## 29.7 Visibility

- administrator can configure exact users a viewer may see
- effective view is previewable
- view access does not grant edit or approval
- database RLS enforces the rule
- change is audited

## 29.8 Desktop/mobile parity

- equivalent essential actions exist
- layouts are device-appropriate
- mobile does not require desktop-sized tables or dialogs

---

# 30. Explicit unresolved production decisions

The following architecture direction is now approved for the first implementation:

- local-first web application using a current stable Next.js App Router and TypeScript baseline
- local Supabase stack for Postgres, Auth, Storage, migrations, seeds, and Row-Level Security
- production deployment to Supabase and Vercel at a later approved stage
- local Git repository from the beginning, with GitHub remote connection deferred until a later approved stage

Developers must not invent the remaining decisions without Product Owner approval:

1. final attachment type and size limits
2. production virus-scanning service
3. final retention periods
4. exact production notification channels and email provider
5. exact browser support matrix beyond the documented modern-browser baseline
6. exact SLA and recovery targets
7. holiday and working-day calendar rules
8. whether Capture Work classification is rules-based, AI-assisted, or hybrid in the first production release
9. final default outcome for Request Changes
10. exact dual-verification scenarios
11. final organisation hierarchy source and sync method
12. final routine occurrence generation strategy and production scheduler
13. final export formats and authorised export scope
14. production environment naming, domain, and identity-provider configuration

Where implementation can proceed safely using a reversible local default, the development agent must document the assumption and continue. Where a decision affects security, irreversible data design, legal retention, or external cost, the agent must surface the decision instead of inventing it.

---

# 31. Production implementation handoff rule

Codex, Claude Code, or any development team must:

1. read this document before implementation
2. read `PRODUCTION_LOGIC.md`
3. use desktop and mobile prototypes as visual acceptance references
4. identify unresolved decisions before coding affected functionality
5. implement in controlled phases
6. add tests for permissions, RLS, state transitions, evidence, audit, and concurrency
7. not silently simplify or remove approved functionality
8. not treat prototype hard-coded data as production rules

---

# 31A. Local-first production implementation baseline

## 31A.1 Current delivery objective

The first coding implementation must produce a complete, reproducible application that runs on the Product Owner's computer without requiring Vercel, a hosted Supabase project, or a GitHub remote.

The local build is not a disposable mock. It must use the same application architecture, database migrations, Row-Level Security policies, private storage model, and testable workflows intended for later hosted deployment.

## 31A.2 Current platform baseline

Use the following baseline unless a later approved revision of this specification explicitly changes it:

- current stable Next.js App Router
- React and strict TypeScript
- responsive desktop and mobile web application
- local Supabase stack for Postgres, Auth, Storage, and database APIs
- SQL migrations committed to the repository
- generated TypeScript database types
- private attachment storage with policy-controlled access
- automated unit, integration, Row-Level Security, and end-to-end tests
- local Git repository using a `main` default branch

Exact dependency versions must be pinned by the implementation and recorded in the lockfile. Do not hard-code version numbers in product requirements unless compatibility requires it.

## 31A.3 Deferred external connections

During this stage, do not:

- link the local Supabase project to a hosted Supabase project
- deploy to Vercel
- create or connect a GitHub remote
- commit real secrets
- expose the local Supabase stack to external traffic

The repository must nevertheless be prepared so those connections can be added later without restructuring the application.

## 31A.4 Future-change compatibility

The implementation prompt and coding-agent instructions are intentionally process-stable but product-flexible.

When the Product Owner later supplies updated Markdown specifications or updated desktop/mobile `index.html` prototypes:

1. inventory all changed files before modifying code
2. compare them against the current approved baseline
3. produce an impact map covering UI, workflow, data, permissions, tests, and migrations
4. treat the latest approved `MASTER_PRODUCT_SPEC.md` as authoritative
5. update the application without reverting unrelated approved behaviour
6. add migrations instead of editing applied migration history
7. update tests, documentation, and change history in the same revision
8. ask for clarification only where files genuinely conflict or a security-critical decision is missing

The implementation must never treat the initial one-shot prompt as a frozen copy of the product. The authoritative product files are expected to evolve.

## 31A.5 Repository instruction files

The implementation package includes:

- `ONE_SHOT_LOCAL_BUILD_PROMPT.md` — complete build mission and quality gates
- `AGENTS.md` — repository instructions for Codex and compatible coding agents
- `CLAUDE.md` — repository instructions for Claude Code
- `CHANGE_INTAKE_PROTOCOL.md` — required process for later specification and prototype updates
- `LOCAL_FIRST_BUILD_GUIDE.md` — local setup and future connection sequence
- `BUILD_ACCEPTANCE_GATES.md` — objective completion criteria

These files govern implementation behaviour but do not override this Master Product Specification.

---


# 31B. User directory, weekly email summaries, and task-age visibility

## 31B.1 User directory and account creation

The production application must include an administrator-only user directory. Administrators can create and maintain application users without editing database records manually.

Required user identity fields are:

- full name
- unique employee ID
- unique email address
- department
- application role
- reporting manager, where applicable
- account status
- personal weekly-summary preference
- manager team-summary preference, where applicable

Employee ID and email uniqueness must be enforced by database constraints and validated before submission. Email addresses are used for authentication and task-summary delivery. Creating a user must create an immutable administration audit event.

## 31B.2 Account status and deletion

Normal removal is **deactivation**, not destructive deletion.

Deactivation must:

- prevent new sign-in
- prevent new assignment unless explicitly reactivated
- preserve historical ownership, comments, evidence, decisions, review records, and audit events
- identify open owned work that requires reassignment
- preserve the employee identity on historical records

Permanent deletion may be offered only where the account has no retained task, routine, attachment, approval, review, notification, or audit history. Production deletion must require explicit confirmation using the employee ID and an administrator audit event. The database must reject destructive deletion when referential history exists.

## 31B.3 Weekly personal email summary

Each active user with a valid email address may receive one weekly summary, defaulting to Monday at 8:00 AM in `Asia/Kuala_Lumpur`.

The personal summary is generated from recorded application activity; it is not a separate report the employee must prepare. It must include:

- work completed during the previous reporting week
- meaningful progress, checklist, state, owner, due-date, or next-action changes
- overdue work
- stale Active work with no qualifying update
- commitments due in the current week
- routines due in the current week
- the highest-priority recommended next action
- a direct link to My Day

The email job must be idempotent, auditable, retryable, and protected against duplicate sends. Delivery status and failure reason must be retained.

## 31B.4 Manager team-change summary

A manager receives the personal summary plus a clearly separated direct-report section. The team section must be derived from reporting lines, visibility rules, task records, and audit events. It must include:

- work completed by direct reports last week
- meaningful task progress or state changes
- newly activated or moved-out focus work
- newly overdue work
- barriers raised or resolved
- stale Active work requiring follow-up
- over-focus-target activations and their recorded reasons
- items requiring manager decision or support

The manager summary must highlight changes and exceptions rather than reproduce every team task. It must not require employees to prepare duplicate weekly status reports.

## 31B.5 Task age terminology

Every non-completed task must carry three independently calculated timeline values where applicable:

- **Open age:** calendar time from task creation until completion or cancellation. It does not reset when task state changes.
- **Current-state age:** calendar time since the task entered its present state. It resets on each valid state transition.
- **Overdue age:** calendar time after the due timestamp while the task remains incomplete. It is zero before the due timestamp and stops when completed or the due date is validly changed.

For Routine Work, age belongs to the generated occurrence, not the recurring template.

## 31B.6 Task-age presentation

The interface must show age without making every row visually heavy:

- neutral compact chip such as `Open 18d`
- blue compact chip such as `Active 11d`
- red compact chip such as `Overdue 2d`
- amber compact chip such as `No update 7d` when the configured stale threshold is exceeded

Age indicators appear in My Day, My Focus, Available Work, Team Focus where management-significant, routine occurrence lists, and task detail. Red is reserved for genuinely overdue or actionable conditions. Tooltips or accessible labels must explain how each duration is calculated.

## 31B.7 Date and time calculation requirements

Production duration calculations must use stored timestamps rather than incrementing counters. The backend must calculate durations using the organisation timezone for display while retaining UTC timestamps. Due timestamps must support date-only and date-time commitments without introducing an accidental one-day overdue result. Changes to due dates and states must be audited.

## 31B.8 Acceptance requirements

A release is not acceptable unless:

- an administrator can create a user with unique employee ID and email
- duplicate employee ID and email are rejected
- an existing user can be deactivated and reactivated without losing history
- permanent deletion is blocked when retained history exists
- a history-free test user can be permanently deleted after employee-ID confirmation
- personal weekly email content is generated from real task and audit records
- manager email content includes direct-report changes and exceptions
- duplicate weekly emails are prevented
- Open, current-state, overdue, and stale indicators are calculated from timestamps and displayed consistently on desktop and mobile


## V37 — Synchronized reference baseline

The uploaded `index(20260807-072841).html` is the canonical visual and interaction reference for this revision. Production and future prototypes must preserve its example-data relationships, wording, navigation, click behaviour, drawers, themes, Goals flow, Next action behaviour and Team Focus flow unless a later approved change explicitly supersedes them.

This revision reconciles older conflicting text: Goals are a dedicated primary workspace, Plan remains Calendar, the task detail uses **Next action**, and the manager workspace is **Team Focus**.

# 32. Revision history

## v34 — 5 August 2026

- added administrator user creation, account maintenance, deactivation, and controlled deletion
- added personal weekly email summaries and manager team-change summaries
- defined timestamp-derived Open, current-state, overdue, and stale durations
- added compact task-age indicators to desktop and mobile prototype references
- updated acceptance requirements for identity lifecycle, email delivery, data retention, and duration calculations

## v28 — 5 August 2026

- established the local-first production implementation baseline
- selected Next.js and local Supabase as the current implementation direction
- deferred Vercel, hosted Supabase, and GitHub remote connection to a later approved stage
- added a flexible change-intake rule so later Markdown and prototype updates supersede the initial build package
- added coding-agent instruction files and objective build acceptance gates
- retained the existing product behaviour and visual prototype as the functional baseline

## v27 — 5 August 2026

- created first consolidated Master Product Specification
- consolidated latest approved decisions from the complete prototype-design conversation
- established document hierarchy and mandatory maintenance rule
- retained v26 application behaviour as the visual baseline
- confirmed soft focus targets, employee-initiated work, lean Capture Work, routine separation, collaboration, completion review, Records, meaningful Settings, Visibility Rules, desktop/mobile parity, and minimalist master-detail UI

---

# Appendix A — Approved end-to-end user journeys

## A1. Employee captures small work

My Day → Capture Work → title + Today → Add Work → Quick Action recommendation → Confirm → appears in My Day → complete → retained in history.

## A2. Employee captures sustained follow-up

Capture Work → title + timing → system asks one follow-up question → Operational Available Work recommendation → Confirm → appears in Available Work → employee activates within target or records over-target reason → Active focus.

## A3. Employee identifies recurring work

Capture Work → repeatable wording or user choice → Routine Template Request → manager reviews template → future occurrences generated separately.

## A4. Employee exceeds focus target

Available Work → Activate → one reason question → Activate anyway → red `6/5` indicator → manager notified → reason audited → later Move to Available or completion returns count below target.

## A5. Collaborative handoff

Primary owner completes prerequisite checklist item → collaborator’s checklist contribution becomes Ready → collaborator sees My Day and Shared → completes briefing/evidence → shared task updates → primary owner remains accountable.

## A6. Routine inspection finding

Routine occurrence → checklist → record finding → minor correction closed in occurrence or significant issue creates Operational Available Work → occurrence completed with evidence → next occurrence remains separate.

## A7. Barrier

Task detail → Raise Barrier → issue + support + impact → manager notified → optionally Meeting Queue → decision recorded → barrier resolved or task paused when work cannot continue.

## A8. Completion review

Owner completes task with evidence → task becomes Completed with Pending Review metadata → reviewer opens attachments → system logs views → reviewer Accepts Completion or Requests Changes → decision audited.

## A9. Administrator grants visibility

Settings → Visibility Rules → select Amer → add Izzah and Ajmal → preview effective access → Save → RLS rule updated → audit event recorded → Amer gains view-only access within defined scope.

---

# Appendix B — Product-owner review checklist for future revisions

Before approving a change, confirm:

- Does it make daily work simpler?
- Does it preserve employee ownership?
- Does it add unnecessary manager approval?
- Does it affect focus targets?
- Does it affect routine behaviour?
- Does it affect permissions or visibility?
- Does it affect audit or evidence?
- Is it implemented consistently on desktop and mobile?
- Does it require an update to this specification?
- Does it require a data migration or new test?



## V34 — Lean Goals module

### Purpose
The Goals module manages agreed performance and development outcomes without becoming a second task list or a duplicate weekly-reporting process. A goal represents the outcome to achieve; tasks and routines represent work that supports the outcome.

### Navigation
Goals are a dedicated primary workspace, separate from Calendar. Employees see My Goals. Managers and authorised viewers also see Team Goals. Plan remains the Calendar/planning workspace.

### Goal-setting operating model
1. The manager prepares the expected result, business reason, baseline, target, target date and proposed weight.
2. The employee contributes the proposed approach, dependencies and support required during a one-to-one discussion.
3. Both agree the final success result, milestones, weight, date and support.
4. The action is recorded as **Agreed & Active**, not merely approved by the manager.
5. Progress updates do not require approval unless the target, measure, owner or due date is materially changed.

### Lean lifecycle and health
Internal lifecycle: Draft, Discussion, Active, Closed. Active-goal health shown to users: On track, Need attention, Completed.

### Required goal fields
- Expected result / goal title
- Why it matters
- Current position or baseline
- Agreed success result
- Target date
- Owner
- Manager or reviewer
- Weight where the goal belongs to a formal weighted set
- Employee approach
- Support or dependency
- Milestones and milestone weights

### Progress method
Formal goals should default to milestone-based progress. The overall percentage is the weighted total of milestone progress. Linked-task completion must never increase goal progress automatically. The system may prompt the owner to post a goal update when linked work changes.

### Lean progress check-in
A normal update must be completable in approximately one minute and capture only: milestone changed, current status, current result where useful, what changed, next step, optional attachment, and whether support is needed. Attachments are linked to the specific update and also shown in the goal Evidence view.

### Manager experience
Managers see team goal health, meaningful progress, goals needing attention, stale check-ins, support requests and upcoming target dates. The interface must not rank employees against one another. A one-to-one preparation view should recognise progress, surface expectation or support issues and reuse existing task/goal evidence rather than request duplicate reporting.

### Integration
- My Day surfaces a goal only when a check-in is due, support is requested, a target is near, a manager requests an update or a linked milestone changes.
- Weekly employee email includes meaningful goal progress or check-ins due.
- Weekly manager email includes recognition, goals needing support, stale check-ins and material goal changes.
- Goal detail shows linked tasks and routines, but a goal remains a separate outcome record.

### Initial refined annual goal set
The prototype includes a five-goal, 100%-weighted annual set: BR2 Warehouse ESH Readiness and Stabilisation (30%), Field Service Safety Assurance (25%), Electrical Testing-Area Safety Improvement (20%), Safety Digitalisation with Demonstrated Benefit (10%), and Bukit Raja Safety Opportunity Performance (15%). The detailed milestones and success measures in the prototype are the approved starting structure.


## V34 — Lean minimalist Goal workspace redesign

### Design correction
The Goal module must follow the same interaction model as the rest of TAMCO Focus. It must not use a dense dashboard, multiple summary-card grids, or a large centred detail modal.

### Approved Goal workspace pattern
- Goals remain a dedicated primary workspace, separate from Calendar.
- My Goals uses one compact list.
- Team Goals uses a two-pane master-detail layout: people on the left and the selected person's goals on the right.
- Summary information is shown as one compact line rather than multiple metric cards.
- Each goal is shown as a single row containing health, title, current milestone, progress, target date, update age, and one Update action.
- Goal weight remains secondary information.
- Goal details open in the same right-side drawer pattern used elsewhere in the application.

### Lean update flow
A normal goal update requires only:
1. Milestone
2. Milestone progress stage
3. What changed

Next step, support request, and attachment are optional. Health is inferred: a support request or stated concern changes the goal to Need attention; otherwise it remains On track unless all milestones are complete.

### Progressive disclosure
Manager expectation, employee approach, support, baseline, and purpose remain available in the goal drawer but are collapsed behind expandable agreement sections so the default view stays concise.


## V34 — Standalone Goals workspace and actionable milestones

### Placement
Goals are a dedicated primary workspace and are not embedded inside the Calendar page. Calendar remains a separate planning view. My Day shows only a compact goal strip when a check-in, support request, approaching target, or other meaningful exception exists.

### Quick goal update
Opening a goal provides a one-minute update path: adjust the overall progress with a slider, write a short progress note, optionally attach a file/photo/screenshot, and save. Next step and support request remain progressively disclosed.

### Actionable milestones
Each milestone supports direct progress adjustment, mark complete, comment/evidence update, and retained update history. Milestones are created together during the goal-setting conversation rather than generated automatically after activation.

### Milestone alignment
Employees may suggest milestone changes. Managers and employees discuss the change. Saving for discussion does not replace the current agreed milestone version. Agreeing changes creates a new active milestone version and records the previous version in audit history.

### Safety Digitalisation example
The standard example milestones are: identify recurring operational issues suitable for digitalisation; select a suitable digital or AI tool; develop a working prototype; test with users; and record results, lessons learned, and next actions.


## V34 — Goal workspace focus and formal weighting

### Goal views
The Goal workspace must separate **Active**, **For discussion**, **Completed**, and **All**. The default view is Active. Draft or discussion goals must never be presented as agreed outcomes.

### Formal goal weight
Only agreed Active performance goals contribute to the formal weight total and weighted progress. The system must show allocated and remaining weight. An Active goal cannot be agreed if it would increase the formal set above 100%; it may be saved for discussion instead.

### Goal-list hierarchy
Each row shows one primary progress value, health, target date, last meaningful update, and secondary weight. Milestone-based goals calculate overall progress from milestone weights. The whole row is clickable; repeated Update buttons remain hidden until hover/focus or an attention condition.

### Milestone check-in
Completed milestones are collapsed by default. The current milestone is prominent. Updating a milestone uses a right-side drawer on desktop and a bottom sheet on mobile. The user adjusts progress through a slider or direct 5% input, records **What changed?**, optionally attaches evidence or requests support, optionally marks the milestone complete, and saves through one primary **Save update** action.


## V36 — Next action and task-age clarity

### Next action purpose
Every Active task may carry one concise **Next action**: the smallest concrete action that will move the task forward. The interface must never show generic placeholder text such as “Continue next action.” When no action has been recorded, show **No next action recorded** with a clear Set next action control.

### Update paths
The owner may update the Next action directly from the task Overview or through the **What happens next?** field when posting a progress update. In Checklist, the current Next action is pinned separately from the permanent task checklist and is never counted in checklist progress. Marking the Next action done does not complete the task; it clears the immediate action and prompts the owner to set the next practical action.

### Task-age explanation
Open age, current-state age, overdue age, and stale/no-update age remain compact indicators. Their calculation explanation must be hidden behind an accessible information control beside the indicators. The explanation must not appear inside the Next action card.

### Reuse
A meaningful Next action may be reused by My Day, Start Here, task lists, handovers, manager views, stale-work review, and weekly email summaries.


## V38 — Task-detail clarity and trustworthy commitments

### Quiet task information
Task Overview uses one compact information line for status, urgency, due commitment, overdue age when applicable, progress, checklist count, and a single information control. Open age and current-state age remain calculated and accessible through that information control; they do not permanently compete with the work itself.

### Due-date change history
An authorised task editor may select **Edit due**, review the current due commitment, choose a new date or date-time, and optionally record a reason. Saving never overwrites history: the immutable event records the previous commitment, new commitment, actor, timestamp, date-only/date-time semantics, and optional reason. Recent activity presents that change in readable before/after form.

### Focused Next Action and checklist preview
The normal Overview card contains the Next Action, compact due/overdue context, Mark done, and Edit. Explanatory teaching copy is omitted from the normal working view. A whole-row checklist preview shows completed/total progress and the number of outstanding evidence-required items, and opens the Checklist tab.

### Permanent checklist and evidence rules
The Current Next Action is pinned separately and excluded from the permanent checklist count. Permanent checklist rows use one clear rule and action:

- **No evidence required** → Complete.
- **Evidence optional** → Evidence and Complete remain independent.
- **Evidence required** → Complete with evidence opens one compact file/photo/screenshot and optional completion-note step.

For required evidence, attachment metadata and checklist completion receive the same transaction timestamp. Reopening writes a new history event and never erases the original completion.

### Progress authority
When at least one permanent checklist item exists, completed items divided by total permanent items is the only task-progress source. The Current Next Action is not part of the denominator. Insertions, removals, completion, reopening, and existing-data backfill must not leave a manual percentage that disagrees with the checklist.

### Recent activity and barrier treatment
Recent activity gives readable, actor-and-time-stamped entries for due changes, Next Action changes/completion, checklist completion/reopening, evidence attachment, and resulting progress. A task without an open barrier uses a neutral **Need help?** row; stronger red/pink treatment is reserved for a recorded open barrier.


## V36 — Team Focus manager workspace

The manager Team workspace is renamed **Team Focus** and follows an exception-first master–detail pattern. Its default purpose is to answer: who needs management attention, where focus is under pressure, and what has meaningfully changed.

### Default manager view
- Show a compact team list rather than expanded workload cards for every person.
- Default filter: **Needs attention**. An **Everyone** view remains available.
- Default sort: management priority, with optional name sort.
- Each person row shows identity, only meaningful exception indicators, compact 1/5/1 focus counts, highest current concern, and last meaningful activity.
- Empty Major Project or Self-Development categories must not consume large panels.
- Capacity counts are numeric indicators, not completion progress bars.

### Team-member detail
Selecting a person opens a right-side detail drawer on desktop and full-width detail on mobile. The detail prioritises: actionable manager attention, current focus, next actions, selective abnormal ageing, then compact secondary workload. Routine, Available Work and Goal information remain collapsed summaries unless they require attention.

### Information discipline
Normal task age stays visually quiet. Ageing becomes prominent only when overdue, stale, unusually old, or long-paused. Low-value activity counts such as raw work-created-this-week should not appear in the default manager scan unless an unusual volume creates a management implication.

---

## 33. v40 to v49 — approved behaviour changes

Recorded here so the specification matches the implementation. Full engineering
rationale is in `PRODUCTION_LOGIC.md` section 40.

**Navigation (v40, v43).** Focus navigates by state: Active, Available, Shared.
Major Project, Operational Action and Self-Development remain work classes and
capacity categories, shown on rows and in a capacity strip, never as tabs.
`My Work | My Team` is a separate scope control above them. Routine keeps its own
occurrence lifecycle — Due now / this week, Upcoming, Completed — inside the same
Work shell, and never borrows Focus vocabulary.

**Ownership (v41).** Primary Owner is chosen at Capture: implicitly for an
employee, explicitly by a manager. One result has exactly one Primary Owner.

**Collaboration (v41, v44, v45).** Collaboration happens through checklist items.
Assigning a step to somebody else creates a Shared contribution — a projection of
that same row, never a second task. The assignee is notified on assignment and
again when the contribution becomes Ready, and never twice for the same state.
Any active team member may be assigned a step: collaboration is not bounded by
the reporting line, and eligibility is never `role = manager OR user = primary
owner`. Names of active colleagues are readable by everyone for this purpose;
whose work may be *read* is still decided by the reporting line.

**Checklist steps are editable (v45).** A step's title, assignee, due date,
evidence rule and prerequisite can be corrected after it is written, and every
field change is recorded. Restructuring is edit authority, never contribute
authority: the assignee completes their step, the owner or their manager decides
what the step is. A completed step is a record and cannot be rewritten or
removed — it is reopened first. A step is not removed while it holds evidence or
while another step waits for it.

**Available and Active (v41).** Available answers "should I start carrying
this?" and offers Activate. Active answers "what do I do next?" and carries the
Next action. No next action is ever fabricated for work nobody has started.

**Updates (v43).** An update records what changed. It no longer carries a next
action, a barrier shortcut, an evidence-only checkbox or a participant selector.
Evidence-only is inferred from attachments with no text.

**Barrier (v44, v45).** A barrier states what is blocking the work, what kind of
action is needed, what is needed from the recipient, who must act, and the impact
if unresolved. Only "work cannot continue" pauses the task. A response is not a
resolution. Resolution requires a recorded outcome and hands control back to the
Primary Owner rather than resuming work for them.

Whether the named person still owes an answer is tracked separately from whether
the work is blocked. Replying clears the obligation — the request leaves that
person's Needs Attention list — and leaves the barrier open. An approval request
records which answer it received. Nothing resumes automatically when a barrier is
answered or resolved.

**Notifications (v42, v44, v46).** Notifications are created only for meaningful
handoffs and required actions, carry the entity they concern, and open that exact
record. The bell counts unread and actionable items only. A notification is
awareness and a deep link, never the place the work lives: reading one does not
discharge the request it announced.

**Needs Attention (v46).** Something requires this person to act now. It is
derived from the records themselves — an open barrier, addressed to them, still
unanswered — and never stored as its own object. It appears on My Day for the
person who must act and on My Team for the manager whose team is affected;
these are two views of one request, and answering it clears both.

**Shared and Needs Attention are different (v46).** Shared means a checklist
contribution somebody assigned you to perform. Needs Attention means somebody is
waiting on your decision, approval or response. Barriers never enter Shared and
checklist assignments never create attention requests. Neither list may grow
into "anything another person wants from me".

**Barrier surfaces (v46).** A barrier lives in its parent Task Detail and
nowhere else — no barrier workspace, no permanent tab, no second record. Arriving
from a notification, My Day or My Team opens that same Task Detail with the
request expanded, the requested action stated first, and the response control
ready; task context follows underneath. What the barrier shows depends on the
viewer: who they are waiting for, or that the answer is theirs to give.

**Meeting Queue (v46, v47).** Adding a barrier to the Meeting Queue is the
responding manager's option, not a field on the employee's request, and it
reuses the existing queue rather than copying the work. The same barrier is
never queued twice. The queue lives inside Monthly Plan, never as its own
navigation entry.

**Discussion instead of an immediate answer (v47).** A request may be deferred
to a conversation: queued when the need is known, scheduled when a time is. A
scheduled discussion is an event on the Monthly Plan calendar, linked to both
the work and the request, and opening it returns to the request. Neither
queueing nor scheduling answers anything — the requested decision, approval or
response is still owed, still on Needs Attention, and only the actual response
clears it.

**Mandatory work (v48).** Mandatory means the work could not wait for normal
prioritisation. It has already been decided, so there is nothing to approve and
no approval step stands in front of it. It is not, by itself, manager attention:
running normally it is information, visible under Everyone. It reaches Needs
Attention only when something else is true as well — it pushed the person over
their focus target, it carries a barrier addressed to the manager, or it is
overdue past the existing intervention threshold — and each of those states its
own reason and its own action.

**Workload review (v48).** When mandatory work takes somebody over target, the
open question is not whether the work should have started but what gives way now
that it has. The manager may accept the overload, which is recorded as a
decision, or move a non-mandatory item back to Available. The system never
chooses, and mandatory work is never the item moved.

**Needs Attention is validated (v48).** An item may appear only if it can answer
why it is there, what the manager should do, and where they would do it. Items
that cannot are excluded rather than shown, because one meaningless card teaches
people to skim the whole list.

**Team Member Detail (v48).** A team member's name opens a drawer over My Team
answering, in order: does this person need me, what are they working on, what has
meaningfully changed, and how much else are they carrying. It is not an employee
dashboard and carries no metric nobody would act on. No Active focus is stated
plainly; it is not an exception.

**Summary surfaces (v49, amended 10 August 2026).** A summary shows what deserves attention first and
never the whole backlog. My Day shows the two highest-priority items, the true
count, and a link to Work → My Team → Needs Attention. Ranking is deterministic
and shared — no surface computes its own order. The My Day request summary and
the My Team people list may share the semantic attention read model and action
resolver, but never share a presentation-row component.

**Exception and action required (v49).** Something abnormal a manager should
know about is not the same as something they personally owe. Overdue work and
overdue routines are exceptions; a decision, approval, support request, evidence
review or workload review is an action. The two are labelled and coloured
differently, and only the second may claim "Needs you".

**Manager actions name their operation (v49).** A control says what pressing it
will do — Open task, Open routine, Provide decision, Review evidence, Review
workload — wherever the system knows the object. Vague labels ("Review with
them", a bare "Review") and generic destinations are not used. An attention item
whose underlying workflow does not exist is not displayed at all.

**Rows are records (v49).** Where a row represents one thing, the whole row
opens it, by keyboard as well as pointer. Controls inside the row keep their own
actions. A My Team person row contains nested action buttons and therefore uses
an accessible non-element wrapper (`div` with button semantics and keyboard
activation); each child action stops propagation and opens the exact source
record without first opening Team Member Detail. Generic task-row link overlays
are not used for this people-row presentation.

**Attention target validation (v49 repair).** Every actionable item carries an
explicit `sourceType`, `sourceId`, and `ctaType`. Barrier actions additionally
carry both task and barrier identity. One resolver validates those fields and
maps them to the action label and exact destination. Invalid identity produces
a controlled unavailable state and a development error, never a visible dead
button. An overdue routine resolves to its exact occurrence and is not allowed
to be selected first by the generic overdue-task branch.

**Contextual navigation (v48).** A drawer returns the user to the exact list,
filter and person it was opened from, one layer at a time. Layers are search
parameters, so closing one removes only its own and everything beneath is
preserved. No drawer decides that any particular screen is its parent.

**List cards and user text (v48).** A list row shows a bounded, structured
preview — action type, subject, short preview, who and when, then the action —
and the detail view holds the complete original. No card composes its heading
from unbounded user-entered text.

**One way into a barrier (v47).** Every surface that mentions a request —
notification, My Day, My Team, the task banner, the Meeting Queue, the calendar
entry — opens the same Task Detail with the same barrier expanded, through one
shared path. A visible control either performs its stated action or is not
shown.

**Classification (v40).** Deterministic and auditable. Hidden safety keyword
classification is removed; mandatory work is reachable only through the explicit
urgent path. Every classification stores the rule that produced it.

## v50 — Goal lifecycle and performance cadence (10 August 2026)

This section supersedes older Goal-specific progress, update-cadence and manager-attention
wording. It does not change task, routine, barrier, authentication, visibility or focus rules.

A Goal is an agreed performance or development outcome, not a task list. The recognized
structure remains **Performance Goal / Objectives (Success Measures) / Result / Weight**.
Success measures are structured qualitative, numeric or percentage results with a target,
current value or state, optional unit, reporting period and stable position. Milestones are
two to five meaningful checkpoints and never replace success measures or supporting work.

Goal setup has two logical steps. **Expectation** records employee, result, structured success
measures, target date and formal weight, with optional baseline, purpose and category.
**Alignment** records the employee approach, optional support/dependencies and two to five
milestones, then saves for discussion or activates within the 100% formal-weight guard.

An Active Goal uses four views: **Progress, Check-in, Milestones, History**. Progress presents
success measures first and the derived overall percentage second. When measures exist, overall
progress is the deterministic average of measure progress. Linked work and current milestone
completion do not change it. Legacy Goals without structured measures retain their approved
narrative measure and milestone fallback until revised.

The Goal owner submits at most one monthly check-in per Goal and calendar month. It records On
track, At risk or Off track; a concise summary or valid No material change; optional measure and
evidence updates; and optional explicit manager support. A normal On track check-in is
informational and creates no manager action. At risk, Off track and explicit support create an
exact Goal exception for the manager.

Each calendar quarter has one discussion record. The employee submits a short summary; the
authorised manager records the discussion, agreed actions and status using **Agree & continue**.
This is alignment, not approve/reject. Dates come from calendar month/quarter boundaries and are
not hard-coded per employee. Monthly owner cadence appears on My Day; an approaching quarterly
discussion appears under Coming up. A manager-requested update is owner work and must not alter
Goal health or reappear in the manager's own queue. My Team shows only genuine Goal support,
risk/Off track or a submitted quarterly discussion.

Year-end Result wording is traceable to the structured measures, monthly check-ins, agreed
quarterly discussions, milestones, evidence and support history. It may be refined before the
authorised manager finalizes it. History remains immutable and records measure changes, monthly
submissions, quarterly submission/agreement, evidence and year-end save/finalization with actor
and timestamp.

## v51 — Lean Goal agreement experience (10 August 2026)

This section supersedes the v50 Goal-authoring interface and terminology where they conflict. It
does not create another Goal type or record. Existing Goal versions, lifecycle history, evidence,
permissions, formal-weight rules, monthly cadence, quarterly conversations and year-end records
remain authoritative.

There is one Goals workspace with **My Goals** and manager-only **My Team**. An employee starts or
edits their own Draft and may save it **For Discussion**. A manager starts the same Goal record for
the selected team member, may refine that pending version, and is the only role that can **Agree &
activate** a formal Goal. The user-facing lifecycle is Draft → For Discussion → Active → Completed.

Goal setup is a short two-step agreement:

1. **Expectation** asks for the expected result, one or more plain-language statements of success,
   one Goal target date and formal weight. A success statement inherits the Goal target date unless
   its optional different date is deliberately opened. Category, baseline and purpose sit under
   **More context**. Measure Type, Target State and Period are not setup fields.
2. **Alignment** asks for the agreed approach and optional support. Dependencies and risks sit under
   **More details**. Milestones are optional: zero to five result checkpoints, each with only a
   result and **Done when**. No empty milestone is generated for the user.

The allocation summary always makes the consequence of a formal weight legible: current active
weight, weight after activation and remaining or over-allocated weight. An employee never receives
the manager activation control. Choosing a person in **My Team** fixes the owner before the form is
opened, so the form does not ask for that employee again.

An Active Goal is read as an agreement, not as its setup wizard. **Success** leads with the agreed
result and success statements, then monthly cadence and the next quarterly conversation.
**Check-in**, **Milestones** and **History** remain available. The monthly owner check-in stays lean:
On track / At risk / Off track, a short update or No material change, optional support and evidence.
A quarterly manager conversation asks what is working, what is getting in the way, what support or
adjustment is agreed, and the overall status. Normal On track reporting remains quiet; only genuine
risk, support and review exceptions reach manager attention.

Pre-activation edits replace the pending version of the same Goal transactionally and retain audit
history. Structural edits after activation use **Revise goal** and remain pending until authorised
agreement; they never silently alter the active version. Legacy structured measures remain readable
and calculable, while newly authored success statements are stored compatibly on the same
version-owned measure records.
## v53 — closed-loop execution and employee-level Goal governance (10 August 2026)

This section supersedes earlier Task terminal, Major Project proposal, per-Goal cadence, Goal
progress and Goal closing wording wherever they conflict. The future ESH finding/action system is
explicitly excluded. TAMCO Focus owns one shared Task execution engine and one Goal-management
domain; no management module or parallel task engine is introduced.

### Task execution boundary

- Completion and cancellation are terminal, retained outcomes. Both release focus and make source
  Barriers, action notifications and unscheduled Meeting Queue topics non-actionable without deleting
  them or falsely marking them resolved.
- An owner or authorised manager may cancel ordinary work. Mandatory work may be cancelled only by
  an authorised manager. The reason, actor and timestamp are immutable history.
- Reassignment is an authorised manager operation. Available remains Available and Active remains
  Active. Both owners' focus is recalculated; an over-target result succeeds and explicitly requests
  workload review. Shared remains a projection of incomplete checklist assignments away from the
  current primary owner.
- A response to a request is not resolution. A terminal source makes the request historical and
  non-actionable. Needs Attention remains derived and names why it exists, what action is required,
  and where that action occurs; ordinary assignments and routine progress never qualify alone.
- Major Project proposals use Send for discussion → Agree / Request changes / Decline. Agreement
  creates one Major Project in Available; only its owner decides when to activate it.
- Tasks may carry nullable `source_module`, `source_entity_type` and `source_entity_id`. The three
  values are all present or all absent. A specialist module owns its source record; TAMCO Focus owns
  execution. No ESH-specific Task columns or domain objects are part of this release.

### Goal plan and cadence

- A performance period owns one employee Goal plan. Draft construction may remain below 100%; plan
  finalisation is a separate authorised transaction requiring exactly 100% formal allocation.
- One employee monthly session records one health snapshot for every Active Goal in that period and
  completes the month exactly once. On track and No material change are informational. At risk and
  Off track require explanation. Explicit support identifies a person and creates a shared
  Barrier/request; no approval is created for normal reporting.
- One employee quarterly session reviews every Active Goal once, records current health, optional
  attention and optional agreed support adjustment, and completes the quarter once. Under
  `department_only` governance, an authorised manager may review their own plan; the application
  never invents a superior. `organization_hierarchy` is a stored future mode, not an active fiction.
- Governance mode is captured when a Goal becomes Active. Active structural revision records the
  before snapshot, after snapshot, reason, actor and timestamp while the existing agreement remains
  active until the pending revision is agreed.
- Goal completion and cancellation are different outcomes. Completion records an actual result for
  every agreed success measure and a final result summary. Cancellation records why the agreement no
  longer applies and leaves the resulting allocation deficit visible; weight is never redistributed
  automatically.
- UI and summaries must not invent an overall Goal achievement percentage. They present formal
  weight, current health, actual versus target success measures, and milestone execution as separate
  facts.
- Goal support uses the same Barrier/request engine as Task support, with a Goal source. Legacy Goal
  support and per-Goal cadence rows remain readable during compatibility migration but no new client
  flow writes a competing lifecycle.
