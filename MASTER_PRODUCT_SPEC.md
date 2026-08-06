# TAMCO Focus — Master Product Specification

**Document status:** Authoritative product source of truth  
**Baseline:** v30 user lifecycle, weekly digest, and task-age visibility baseline  
**Product name:** TAMCO Focus  
**Document owner:** Product Owner / EHS Manager  
**Prepared:** 5 August 2026  
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
- **Team Load:** Where does someone need support, reprioritisation, or a decision?
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
- Team Load
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
- Do Next
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

The update composer is accessible near Do Next but remains collapsed or visually quiet until needed.

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

Use a light red treatment when no barrier exists and a stronger alert treatment when a barrier is open.

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

Routine work does not consume focus targets, but Team Load shows:

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

# 18. Team Load

## 18.1 Purpose

Team Load gives managers visibility without requiring approval of every action.

## 18.2 Views

- by person
- by focus bucket
- routine load

## 18.3 Per-person display

Show:

- Major Project count and titles
- Operational count and titles
- Self-Development Plan count and title
- quiet progress percentage
- current due dates
- Available Work needing selection
- over-target state
- barriers
- stale updates
- routine burden

## 18.4 Employee-initiated work summary

Show compact weekly summary:

- Quick Actions created
- Operational Actions created
- items needing manager decision

Do not show every Quick Action individually unless it becomes exceptional.

## 18.5 Manager attention

Surface individual items when:

- approval or management decision is required
- Active focus changed materially
- over-target condition exists
- work is safety/compliance related
- work is overdue or stale
- barrier is raised
- classification appears inappropriate

---

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

Age indicators appear in My Day, My Focus, Available Work, Team Load, routine occurrence lists, and task detail. Red is reserved for genuinely overdue or actionable conditions. Tooltips or accessible labels must explain how each duration is calculated.

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

# 32. Revision history

## v30 — 5 August 2026

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

## A10. V34 Goal workspace and formal weighting

- Goals remain a dedicated workspace, separate from Calendar, with My Goals and authorised Team Goals views.
- Active, For discussion, Completed, and All lifecycle views use the same compact, whole-row interaction. Draft and `pending_discussion` Goals appear under For discussion; completed and closed Goals appear under Completed.
- Only Active Goals count toward formal allocation and weighted progress. The formal set targets exactly 100%; discussion and completed Goals are excluded. Agreeing or activating above 100% is blocked, while Save for discussion remains available.
- A Goal exposes one primary progress value, calculated from the agreed milestone weights. Historical reported values remain retained records but are not presented as a competing current percentage.
- Completed milestones are collapsed by default. The current open milestone is visually prominent and opens a focused right-side update drawer on desktop or bottom sheet on mobile.
- A milestone check-in starts from saved progress, keeps the 5% slider and percentage entry synchronised, distinguishes unsaved progress, requires What changed, and optionally captures evidence, next step, or support. Mark complete is part of the same form and Save update is the sole primary action.
- Evidence is linked to the specific milestone update. Support continues through the existing actionable manager notification and escalation path.

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

