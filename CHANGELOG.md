# TAMCO Focus — Change Log

## v212 One question at a time, "not mine", and a held email you can unblock — 23 September 2026

- **Recording a finding is three steps.** What was found, then who puts it right by when, then who
  to tell if it runs late. A step already answered is marked; the rest of the form is still one
  form and one save, so nothing is lost by moving between them. A problem pulls the form back to
  the step that holds it rather than reporting it against a screen nobody is looking at.
- **An owner can say "not mine" and name who should hold it.** The address rides with their
  message exactly as a requested date does: it creates no contact, issues no link and moves no
  work. ESH sees "Says this belongs to …" and hands it over with one press, which is the ordinary
  reassignment — new assignment interval, reason, audit, old links revoked.
- **A held email can be unblocked where it is held.** A finding whose assignment is waiting now
  says so in plain words and offers the switch: an administrator enables the contact from the
  finding itself, with a reason, instead of knowing to go to Identity and access. Enabling still
  sends nothing — releasing the email remains a separate press.
- **Fixed: pressing Next saved the finding.** Rendered as one conditional, React reconciled Next
  and Assign into the same DOM node and only flipped `type` from button to submit, which the
  browser honoured for the click already in flight. A half-answered finding could be assigned by
  somebody navigating the form. Found by a test, not by a user.
- pgTAP (13), three desktop journeys, and screenshots at 390 and 1440.

## v211 Recording a finding in ninety seconds, and an owner's screen that reads like a chat — 23 September 2026

Two screens, reshaped around the people who actually use them.

- **The new finding form asks for eight things.** What was found, where, whose department, what has
  to change, who does it, how urgent, by when, and who to tell if it runs late. Everything that
  already had a sound answer — the date it was reported, where it came from, what evidence to
  send, who verifies it, the time of day it falls due, risk, restriction — moved under More
  settings. It is all still submitted; it is just no longer asked for. Escalation starts with one
  level instead of three empty boxes, and More settings opens itself if something inside it is what
  needs correcting.
- **The Action Owner's page is a conversation.** One line of identity at the top, what ESH needs
  pinned beneath it, the thread, and a bar at the bottom that stays on screen: attach, write, send.
  Enter sends. The finding, its original evidence and the ESH contact are one tap away instead of
  filling the screen above the first message.
- **An owner can ask for more time, and ESH can grant it in one press.** The date they ask for is
  kept with their message and shown to both sides. It moves nothing by itself — only ESH moves a
  deadline, with a reason, on the record. Granting it is now a single button that sets exactly the
  date that was asked for.
- **Fixed: due-date changes were invisible until a verification existed.** They were rendered
  inside the Verification card, which only appears once a submission has been decided — so a
  deadline moved early was recorded correctly and shown to nobody. They now have their own card.
- pgTAP (14), two desktop journeys, and screenshots at 390 and 1440.

## v210 What the letter says, what a preview shows, and whether anything ran — 23 September 2026

The last four things a second reading of the specification found missing, none of which a passing
test suite could have noticed, because they were absent rather than wrong.

- **The weekly letter carries its own summary.** Leadership sees each department's open, overdue,
  awaiting-review and closed counts, worst first, with up to five overdue actions and who they are
  waiting on — without opening anything. A truncated letter says "Showing 3 of 9 departments"
  rather than trailing off. All of it comes from the run's own snapshot, so the email and the page
  cannot disagree.
- **A report can be read before it is switched on.** Preview names the recipients, the departments
  in scope, the four counts and the week it would report on, and says plainly that nothing was
  sent. It captures nothing and queues nothing, so nobody turns on a weekly email to real
  leadership having seen only a form.
- **The register says how far something has escalated.** A row that reached level 2 says so; a
  withdrawn escalation stops being claimed.
- **Silence became visible.** Every scheduled run leaves an append-only record, and the Overview
  says when the daily job last reported, what bounced, what is held and who has been waiting over a
  week for ESH. Nothing is shown while the work is flowing. There is no scanner in this deployment,
  so its backlog is reported as absent rather than as zero.
- pgTAP (35), unit tests for the letter and for what is worth saying, and two desktop journeys.

## v209 Outcomes that are not closures, and a policy that can differ — 23 September 2026

Two things the specification asked for that nothing had built, found by reading it again against
the code.

- **A finding raised in error can be answered for.** Cancel, Withdraw or Duplicate, each with a
  reason, from the finding itself. None of them says ESH verified a correction, which is what
  closing says. Nothing is deleted: the reference, the conversation and the history stay on the
  register, its outstanding work stops, the owner's links stop working, and anything still queued
  to send is cancelled. A duplicate keeps a link to the finding it repeats, and that finding
  carries on untouched.
- **Follow-up can differ by risk and by priority.** The organisation's policy still answers for
  most work; a rule can now answer for critical findings or urgent actions instead. The rule that
  governs an action is settled when it is assigned, so changing policy never rewrites what an owner
  was already promised.
- **Quiet hours and catching up are settings, not habits.** Routine reminders raised overnight wait
  until morning — escalation never does — and an organisation can choose between coalescing missed
  stages after an outage and sending every one.
- pgTAP (34) and two desktop journeys.

## v208 Priority, changed and explained — 23 September 2026

A short stage closing the last of §39, still local-only and behind the restricted rollout.

- **ESH can change what an owner should do first**, from the action menu, after the action has been
  assigned. Until now priority was set once and never again, so an imported backlog stayed Normal
  however the week went.
- **Every change carries a reason**, kept with what it was and what it became. A priority nobody
  can account for is how everything ends up Urgent.
- **It moves nothing else.** The agreed deadline, the risk assessment and the follow-up schedule
  stay where they are: no reminder or escalation clock restarts because a label changed, and the
  screen says so as it saves.
- pgTAP (15), and the browser journey that changes a due date now changes a priority too.

## v207 One letter instead of eleven — 23 September 2026

The last Finding Management stage remains local-only and behind the restricted rollout.

- **Routine notices arrive together.** An owner with several things due today receives one message
  listing them, with one link to their own list. An escalation recipient receives one message
  covering the actions escalated to them, each with its own scoped link — never the owner's list.
- **Consolidation is packaging, nothing else.** Every action keeps its own notification event, its
  own entitlement and its own recorded outcome. A summary that fails is a recorded failure for each
  action it carried.
- **Nothing stale is sent.** Every line is re-checked as the message goes: work submitted,
  reassigned, closed, rescheduled or no longer escalated drops out and is closed off on its own. A
  summary with nothing left in it is not sent at all.
- **Nothing urgent waits for it.** Assignments, replies and decisions are not routine and were
  never gathered; they go when they are made.
- **A released backlog is the same idea**, and now actually sends: one letter per owner listing the
  actions that release gave them, with the dates already agreed.
- pgTAP (25), unit (8), integration through the real worker.

## v206 Several actions at once, each still its own — 23 September 2026

The tenth Finding Management stage remains local-only and behind the restricted rollout.

- **Select actions is opt-in.** My Actions is the list it was until somebody asks to select; only
  then do tickboxes and the operations appear.
- **Three operations, none of which finishes anything.** One progress update, posted to each chosen
  action as its own attributed message. One request for more time, with the date being asked for on
  the record — official deadlines still change only through ESH, one action at a time. And
  submitting several, which creates a separate immutable submission for each, verified separately.
- **A shared file is a file on each action**, copied so its authorisation is its own: removing one
  cannot reach another action's evidence or a submission already made.
- **Per-item answers.** Succeeded, failed or skipped, with the reason beside the action it belongs
  to. A batch that half worked says so; nothing ever reports whole-batch success. Pressing twice is
  the same operation, not a second one.
- **Batch work belongs to the owner's own inbox link.** An action-only link cannot widen itself,
  and every item is rechecked at execution against the live assignment and state.
- pgTAP (29), unit (8), integration and a desktop end-to-end journey.

## v205 The existing backlog, imported once — 22 September 2026

The ninth and last Finding Management stage remains local-only and behind the restricted rollout.

- **The file as it is.** Excel or CSV, the sheet you choose, the heading row you point at, and the
  date convention you say it was written in. Column meanings are suggested from the headings and
  never applied without being looked at. Formulas are read as their last saved value and never run.
- **Staged, not created.** Every nonblank row is kept with both readings — the original and this
  organisation's — and reaches an explicit outcome: ready, needs a decision, already in the
  register, or blank and ignored. A staged row is in no count, no report and no timer.
- **Nothing is guessed.** A name without an address needs an address; one decision covers every row
  with that name. A missing corrective action, department, target date, reported date or priority
  holds that row back until somebody writes it. Unrecognised risk reads Not assessed. A date that
  cannot be read under the chosen convention is reported, never replaced with today's.
- **A repeat is a repeat.** The same file is recognised by its contents, and a reference already in
  the register can be skipped or linked, never silently overwritten.
- **Photographs and links are answered for.** Nothing is fetched from a link in a spreadsheet, and
  no unresolved evidence leaves the import without an explicit acknowledgment.
- **Release is deliberate.** It shows what it is about to do, including how many are already late.
  Old deadlines stay old, following up starts when the release says it does, and each owner
  receives one summary of their own rather than one email per row.
- pgTAP (34), unit (15), integration at a hundred rows, and a desktop end-to-end journey.

## v204 Weekly leadership reports — 22 September 2026

The eighth Finding Management stage remains local-only and behind the restricted rollout.

- **A report is configured, not assumed.** Name, timezone, weekday and local time, whole
  organisation or named departments, and the recipients who receive it. A new report starts as a
  Draft and captures nothing; activating it is a second, deliberate act.
- **One consistent snapshot a week.** The scheduled run captures open, overdue, awaiting-review and
  closed-last-week rows against one instant, in the report's own timezone, and stores them. A
  captured run cannot be rewritten or deleted, and a repeated scheduler run, a catch-up or a restart
  adds nothing to it.
- **Restricted findings are never in a leadership report**, whatever the scope says.
- **Each recipient has their own link.** One delivery per recipient per run, individually
  authorised, read-only, with no owner inbox, no action controls and no finding conversation. A
  recipient whose contact access is off is held, not quietly sent to.
- **Changing the report withdraws what no longer matches.** A changed definition or scope revokes
  the links and sessions issued against the old one; pausing stops future capture and leaves a link
  somebody already has alone.
- **Identity & access counts report participation** beside owned actions and escalation routes.
- pgTAP (42), unit, integration and desktop/mobile end-to-end coverage.

## v203 People and access, in one directory — 21 September 2026

The seventh Finding Management stage remains local-only and behind the restricted rollout.

- **One directory, three separate facts.** Focus access, Finding access and platform administration
  are recorded and shown separately instead of one overloaded Role, and every existing person's
  migration to that reading is recorded rather than inferred.
- **A contact is described by live work.** Owned open actions, configured escalation routes and
  activated entitlements are counted from the work itself, so a label cannot drift from reality.
- **Audited contact controls.** Resend, revoke, disable and email correction are recorded, and each
  one withdraws the access it invalidates instead of leaving a stale link working.
- **Platform administration alone never reads finding content** — it reads the counts and controls
  a directory needs, nothing more.
- pgTAP (27), unit, integration and desktop/mobile end-to-end coverage.

## v202 Overview, reconciled drill-down and safe export — 21 September 2026

The sixth Finding Management stage remains local-only and behind the restricted rollout.

- **One overview definition.** Four compact, explicitly labelled signals and the department table
  come from one RLS-scoped database function and one as-of instant. Department rows sum back to the
  signals, multi-action findings count once as findings, and Unassigned is explicit.
- **Exact units and drill-down.** Open and Closed lead to finding rows; Overdue and Verification lead
  to action rows. Awaiting-verification and accepted actions are not called overdue owner work.
- **Closure periods do one job.** Last 30/60/90 days, This year and a custom local-date range affect
  only the Closed metric. Old open findings remain visible. A reopened finding leaves current closed
  totals; reclosure uses its current official closure timestamp.
- **One Register.** Overview / Register / Verification are the daily navigation. Closed is a Register
  filter, and the former `/findings/closed` link translates into that canonical view.
- **Authorized CSV.** The action-level export includes before/after descriptions, owner, baseline and
  current due dates, submission/verification/closure dates and escalation state. Spreadsheet-active
  text is neutralized; evidence links and guest tokens are never exported.
- pgTAP (25), unit (9), integration and desktop/mobile end-to-end coverage.

## v201 Follow-up, escalation and delivery evidence — 20 September 2026

The fifth Finding Management stage remains behind the restricted rollout.

- **Policy snapshots.** Verifiers configure owner reminders, escalation timing and ESH review
  follow-up. Every assignment keeps the complete policy it started with, so a later edit never
  rewrites live work.
- **An honest working-day calendar.** ESH maintains normal working weekdays, labelled exceptions
  and a confirmed-through date. The product does not silently claim Malaysian public-holiday
  coverage.
- **Daily, duplicate-safe follow-up.** The existing local cron evaluates pre-due, due-day and
  repeating overdue reminders, coalesces missed escalation levels, and stops owner chasing while a
  submission is with ESH. Every trigger is recorded and can run again without duplicating mail.
- **Escalation without reassignment.** A reached recipient gets a link to that one action. They can
  read, reply and acknowledge, but cannot upload, submit, change the deadline, reassign, verify or
  close. Their reply never changes the action state or owner.
- **ESH is kept in the loop.** Meaningful owner and escalation replies notify the named reviewer,
  or covering Verifiers when none is named. Stale reminders are suppressed at dispatch after a
  due-date, assignment or workflow change.
- **Delivery is not guessed.** Provider acceptance, delivery, bounce and terminal failure are
  separate facts. An idempotent authenticated callback records provider delivery evidence; bounce
  or terminal failure raises Needs attention.
- **Hydration-safe guest forms.** The escalation reply and acknowledgement form has a same-origin
  POST fallback, so a fast first click before the client island hydrates is not lost.
- pgTAP (52), unit, integration, and desktop/mobile end-to-end coverage.

## v200 ESH verifies, closes and reopens — 20 September 2026

The fourth stage of ESH Finding Management, still behind the rollout.

- **Verification queue.** A new Verification page lists every correction waiting for ESH, oldest
  first, with a count beside the menu item.
- **Before and after, side by side.** The finding's original condition and evidence next to the
  submitted result and its files, stacked on a phone.
- **One decision, recorded.** Accept asks how it was verified — photo or document review, site
  verification, or another documented method — and for the last open action the button says what
  it does: Accept & close finding. A correction submitted from your own address is verified by
  somebody else.
- **Request improvement.** Asking for more needs an explanation the owner reads in the
  conversation, and an explicit choice about the deadline: keep it, or give a new one. Nothing
  restarts the clock quietly, and the earlier version stays in the record.
- **Reopen.** A closed finding reopens only by a Verifier, with a reason. The closure, the
  accepted submission and the verification stay in history; the owner gets the work back and
  fresh links.
- **Due date and owner.** Both change only through ESH, with a reason, recorded and shown to the
  owner as an event in the conversation. An owner asking for more time in the chat changes
  nothing by itself. A reassignment ends the old owner's links at once, tells them plainly that
  nothing more is needed, and emails the new owner.
- **Closed findings.** A Closed page with its own period — 30 days, 90 days, a year, or all — and
  search, and a closure record on every closed finding.
- **The owner keeps a receipt.** An accepted action stays readable to its owner for 30 days,
  read-only, then falls away.
- pgTAP (34), unit, integration and end-to-end coverage.

## v199 Evidence, and Submit for review — 20 September 2026

The third stage of ESH Finding Management, still behind the rollout.

- **Photos and documents in the conversation.** Owners and ESH attach files with Attach or Photo,
  or by dropping them on the composer. Each file shows its own progress, and one that fails can be
  retried or removed without losing the others. Photos, PDFs, Word, Excel, PowerPoint, CSV and
  text, up to 10 MB each and ten per message.
- **A file is what it says it is.** The server reads every file back and checks its content against
  its name; a renamed program or a PDF calling itself a photo is refused and deleted. There is no
  virus scanner in this deployment, so every file is labelled Not scanned, never "clean".
- **Private files.** Evidence sits in a private store nobody can read directly. Each file opens
  through a link made for that person, valid for five minutes, only if they may see it.
- **Submit for review.** The owner submits the result from the composer, or presses Submit on an
  update they already sent, and it is used as it was: no retyping, no second upload. The action
  needs a short result and at least one file unless ESH made an exception. The submission is fixed:
  later messages do not change it. While ESH reviews, the owner can withdraw it to revise; the
  withdrawn version stays in the history.
- **ESH is told.** The named reviewer, or every Verifier who covers the finding, is emailed when
  something is submitted or withdrawn. The finding shows the submission, fixed, with its files.
- **Original evidence.** ESH adds the photos of what was found to the finding; the owner sees them
  under Original finding & evidence.

## v198 Action Owners answer from a link in their email — 20 September 2026

The second stage of ESH Finding Management. Still behind the rollout: nobody outside the people
an administrator enables sees any of it, and no email goes to an owner until ESH releases it.

- **No account, two links.** When ESH assigns an action, the owner is emailed View finding &
  respond (that action) and View All My Actions (every open action for their address). Each link
  is a one-time secret: pressing Open on the page it lands on swaps it for a session on that
  device, for up to 12 hours. Opening the page alone spends nothing, so an email scanner cannot
  use the link up. The page never asks for a password.
- **My Actions.** The owner's own list: Needs my action (Urgent first, then the earliest due
  date) and Awaiting ESH review, with counts, search and pages. Late work says how late. End
  access on this device closes it on a shared computer.
- **One conversation.** The owner's action page is the finding, the required outcome and a
  conversation with ESH. Send update writes to ESH; the first update marks the action In
  progress. ESH replies from the finding, and the owner is emailed that ESH replied.
- **A fresh link when one has expired.** A used or expired link offers Send me a new link, to the
  address on record only, valid 30 minutes, at most three an hour. Asking by email gives the same
  answer whether or not the address has work.
- **Contacts are switched on one at a time.** Identity and access has a new Email contacts tab.
  An administrator switches a contact's access on; that sends nothing. ESH then releases the held
  assignment email from the finding. Switching a contact off ends their links and sessions at
  once and holds anything waiting to be sent.
- **Email is sent and retried.** After ESH assigns or replies, and daily from the scheduled job.
  A failed send cancels the links it contained; a refused address stops retrying and shows on the
  register as needing attention.

## v197 Finding Management begins, behind a locked door — 19 September 2026

The first stage of the ESH Finding Management module (specification v1.3, attached 19 September).
Nothing changes for the team: the module is hidden from everybody who has not been given access,
and at the start that is everybody except Izzul.

- **ESH Home.** `/esh` shows TAMCO Focus and Finding Management side by side. For someone with
  Finding access, TAMCO Focus's top bar gains an ESH Home link and a module switcher where the
  product name was. For everyone else it looks exactly as before.
- **Access, one person at a time.** Identity & Access has a Finding Management section for each
  person. An administrator switches access on and chooses a role (Viewer, Coordinator or Verifier)
  and the departments it covers. Being a manager or an administrator grants nothing by itself.
  Production enables only `izzul.asyraf@tamco.com.my`, and only to view; the administrator gives
  Coordinator or Verifier when it is time to create and verify.
- **New finding.** What was found, where, which department is accountable, the required outcome,
  the evidence expected, the Action Owner's email, the due date, priority, reviewer, and escalation
  addresses by level. Drafts can be saved half-finished. Assigning records everything together.
- **The owner is not emailed yet.** Owners have no account. Their emails are held until their
  access is enabled, which comes with secure links in the next stage.
- **Finding Register.** Needs attention, All open, Overdue and Closed, with search, a department
  filter and the full detail of each finding.

## v196 The database answers in milliseconds — 19 September 2026

Reported after v195: "it is getting smooth now, but it still loads and takes time. Is it because
of the server?" It was the database. Production's own statistics showed the reads behind every
page averaging 120 to 480 milliseconds for 166 tasks. The cause was the check that decides who may
see a piece of work. It was worked out again for every single task, step, attachment and update a
page touched, and each time it rebuilt the whole picture of who reports to whom. For a manager,
just counting 154 steps took 134 milliseconds.

- **Who may see what is now worked out once per request, not once per row.** Measured at
  Production's size, as a manager:

  | Read                                  | Before | After |
  | ------------------------------------- | -----: | ----: |
  | Every task                            | 126 ms |  4 ms |
  | Every step                            | 129 ms |  1 ms |
  | The team's work list                  |  99 ms |  3 ms |
  | The team summary                      | 110 ms |  7 ms |
  | One person's tasks with their details | 189 ms | 13 ms |

- **Nobody sees anything different.** The rules are the same rules. A new database test keeps
  the old ones as the specification and checks every user against every task, request and person.
  It also checks that each person reads exactly the rows they could read before. When the new
  rules were broken on purpose, the test caught it.
- **Closing a window leaves the keyboard on its row, even when the page redraws just afterwards.**
  The faster database let the page finish redrawing sooner, which exposed a case where the
  keyboard focus was dropped. It now stays on the row, and never leaves a window you have just
  reopened.

## v195 A task opens the moment you press it — 18 September 2026

Reported: "when I click, it loads slowly and takes time. It is not as smooth." Opening a task
redrew the whole page on the server, and nothing moved until that finished. With Production's
network hop that was about half a second of the page seeming to ignore the press, and longer
when the server had been idle.

- **The window starts opening straight away.** It slides in with the task's title the moment
  the row is pressed, and the details fill in when they arrive. Escape or Cancel stops an open
  that has not arrived yet. Goals and proposals open the same way.
- **The details arrive sooner.** Measured with Production's delay: about 0.3 seconds instead
  of 0.5. Sign-in is now checked once per click, not twice, and the task's details, the team
  count and this week's priorities are read side by side rather than one after another. Saves
  and closes get the same saving.
- **"This week" rows no longer reload the whole page.** They open the task window like every
  other row.
- **Pressing a task just after closing it brings it back.** Pressed after the close had set
  off but before it finished, the window used to stay on the page closed and invisible, and
  further presses did nothing. The v194 fix only covered the first quarter of a second.

## v194 The task window survives being opened again and again — 18 September 2026

Reported: "after I open the pop up task windows many times, it becomes unresponsive. I have to
refresh the page." Two faults, both from closing one window as another opens:

- **A task opened while the last one was closing was cancelled.** Closing waits 245ms before
  returning to the list, so it could open a task and then navigate away from it. The task
  flashed and vanished; doing it a few times looked like the page had stopped responding. A
  press on any link now cancels the close, and pressing the same task again brings it back.
- **The page could be left unable to scroll.** The window and the dialogs inside it each saved
  and restored the page's scrolling on their own, so whichever left last could restore
  "locked" for good. They now share one counted lock, released when the last one closes.

## v193 Every notice opens the right place — 17 September 2026

The notices and emails sent to everybody were checked against Production's records and a replay
of every notifying event (docs/notification-debug-v193.md). The right people were told and every
email went out within a minute. Three things about where a notice leads were wrong:

- A notice you had not read yet could be re-pointed at a step when somebody handed you a step on
  the same work. A "Decision needed" or "Work reassigned" then opened a step instead. Notices
  already affected are corrected.
- "Work reassigned", "Contribution reassigned", "Contribution withdrawn" and "Contribution removed"
  said "Open task" for work you no longer have. They now open My Work or Shared, and say so.
- "Decision needed" and the other barrier notices open the barrier itself, with the decision form
  ready. Only the person asked to act sees "Respond to request"; everybody else sees "Open
  request".

## v192 Found by the debug crawl — 16 September 2026

Every page was crawled as each role, on desktop and phone, in light and Night mode, checking for
errors, failed requests, pages wider than the screen, deadline wording that reads wrong, and
accessibility faults. It found no errors, no failed requests, no overflow and no bad deadline
wording. It found two accessibility faults, fixed here.

- **Night mode:** the red count badges were white on a light red, about 2.7:1 and hard to read.
  Affected: "My Team 1" and "Routine 2 overdue", the bell's unread count, the navigation badge
  and a completed step's tick. They now use dark text in Night mode; the day theme is unchanged.
- **Phone calendar:** after hiding the weekday headers and empty days, the agenda still marked
  every empty week as a table row. A screen reader read that as a broken table. Those rows are
  now hidden too.
- The Alerts & escalation settings section described itself as the "Today window", which v188
  removed. It now says "Attention window".

## v191 Your calendar keeps the work you handed out — 15 September 2026

- **Only me** on the Monthly Plan now shows work you assigned to somebody else, on its due date,
  marked with who owes it: "↘ Amer". Until now it disappeared from your calendar the moment you
  assigned it, and could only be found under My team, or nowhere when the person is outside your
  team. Its review date and its steps stay on the owner's calendar, not yours.
- The owner's "Contribution overdue on your work" notice (v190) is sent when a step has just gone
  late, within three days. Without this, the first morning after v190 would have emailed owners
  once for every step left late on their work, however long ago. My Day still lists all of them.

## v190 Everybody hears about a step at the right moment — 15 September 2026

- **Due tomorrow:** the person who owes a step on somebody else's work gets one reminder, in the
  bell and by email, the morning before it is due.
- **Overdue:** the owner of the work is now told as well as the person who owes it: "Contribution
  overdue on your work · Waiting on Amer Hakim". Once per step and due date. A step due with the
  work is covered by "Work overdue" (v185), so it is not told twice.
- **Reopened:** when somebody reopens a step, the person who owes it is told straight away, with
  the reason when there is one. Reopening your own step tells nobody. Undo on a step no longer
  records the invented reason "Reopened from task detail.", which would have been sent.
- **New due date:** giving a step a different day tells the person who owes it, from and to.
  Moving the work tells the people whose steps are due with it, once each. Changing the wording,
  or the time on the same day, still tells nobody.
- Opening any notice about a step you owe on somebody else's work now lands on that step. It used
  to open the work with its steps closed, which on a phone meant another tap to find it.
- Completing or re-dating a late step clears its overdue notices from the bell. Completion
  still tells the owner quietly, and attaching evidence adds nothing.
- "Due-today and selection deadlines" in My Alerts switches off the reminder, the overdue and
  the new-date notices. "Collaborative handoff" keeps the reopened notice in the bell only.
  Mandatory work is always told.

## v189 My Team shows what is late and what is about to be — 15 September 2026

- A person's row now reads "⚠ 1 overdue · ! 2 due within 5 days". The due-soon count covers their
  own work and the steps they owe on other people's. Routine occurrences count only once late.
- Opening a person starts with **Needs attention**: Overdue, then Due within 5 days. It lists their
  tasks, paused and not-started work, late routines and the steps they owe, so a manager can step in
  before the work is late.

## v188 My Day is the action view — 15 September 2026

- My Day opens with one sentence, "2 overdue · 3 due within 5 days", then two sections: **Overdue**
  and **Due within 5 days**.
- Each problem is one card:
  - A task of yours carries its own late or close steps, and the steps others owe on it, as lines:
    "Your step overdue 1 day", "Waiting on Amer · due tomorrow".
  - Work that is not due soon itself still appears when one of its steps is.
  - A step you owe on somebody else's work is its own card and opens at the step.
  - A routine appears once, and a quarterly goal discussion inside the window is a card.
- Start here, Next up, Waiting on others and Coming up are gone, replaced by the two sections, as
  the Product Owner decided. The overdue count left the workload strip, because the sentence says it.
- Settings loses the "today list max items" policy, which nothing reads any more.

## v187 One deadline language — 15 September 2026

- Every deadline now says how close it is:
  - "⚠ Overdue 3 days" in red once late;
  - "! Due today", "! Due tomorrow" and "! Due in 3 days" in amber inside the attention window;
  - the date, as before, further out.
- The same words appear on My Work, Shared, a task's steps, the task drawer and My Team's panel.
- The attention window is five days, an organisation setting. It was seven, and meant only how far
  ahead Coming up looked.
- Shared lists what you owe in order of urgency: overdue, today, tomorrow, due soon, later.
- On My Work a task shows "! Delegated step due tomorrow" when somebody else's step on it falls
  inside the window, even when the task itself is weeks away. Your own step reads "! Your step due in
  2 days".
- A step reads "Amer Hakim · ! Due in 2 days" rather than "Due 17 Sep", and "Overdue 1 day" rather
  than "Overdue since 14 Sep". My Team's panel lists late work first, then work due soon.

## v186 My Alerts does what it says — 15 September 2026

- "Barrier or support involving me", "Assignment and reassignment" and "Collaborative handoff" in
  My Alerts now work. Switch one off and its emails stop. The notice still appears in
  Notifications, because each of them asks you to do something. Until now these switches changed
  nothing.
- A barrier about a safety or compliance risk, and anything about mandatory work, is always sent.
  That now includes overdue and moved-due-date notices on mandatory work, which "Due-today and
  selection deadlines" could switch off.
- "Routine work coming up" is no longer listed. Nothing ever sent a notice for it, so switching it
  did nothing. Whatever you had chosen is kept.
- My Alerts now says what switching an alert off does.

## v185 Overdue work is told, and counted the same way everywhere — 15 September 2026

- The owner of late work is now emailed once, the morning after it passes its due date. Several
  pieces of late work arrive as one email ("4 pieces of work overdue"). Before this, only someone
  owing a step on another person's work was ever told.
- Pushing a due date later tells the owner's manager and whoever assigned the work, by email:
  "Amer Hakim moved it from 13 Sep to 20 Sep. It was 2 days overdue. Reason: …". When somebody
  else moves your due date, in either direction, you are told.
- "Due-today and selection deadlines" in My Alerts switches these off, and the step overdue
  notice too. Until now none of the My Alerts switches did anything.
- Days late are counted by calendar day on every screen. Work due 13 September read "overdue
  by 1 day" on My Day beside a step due the same day reading "2 days late"; work due yesterday
  read "11h overdue" in the task and "Overdue" with no number on My Work.
- My Team lists a person's late work first. It said "5 overdue" above five rows that were on
  time, with the late ones behind "Show more". Paused work is now listed, marked Paused; it was
  counted on the row but shown nowhere. "Not started" says how many are overdue.
- Fixed: work due today read "Due 15 Sep" rather than "Due today" on My Work, and a task with
  no due date read "Due No date yet".

## v184 Ask for an update — 15 September 2026

- On somebody else's work, a small "Ask for update" link sits at the end of the task's
  buttons: for their manager, for anyone given visibility of their work, and for whoever
  assigned it. An optional note says what you want to know.
- Each unfinished step has its own "Ask for update" link. It asks the person the step is
  assigned to, or the work's owner when nobody is.
- The person asked is emailed and sees the request at the top of the work, with Add update
  beside it. The email opens the work with the update box ready. My Work and Shared rows show
  "Update requested".
- A written update answers it, and completing the step answers a step request. Either way,
  the person who asked is emailed the reply.
- You can ask the same person about the same thing once a day. While you wait, the work says
  when you asked and when you can ask again.

## v183 Every control on a phone is big enough to press — 15 September 2026

- On a phone, filter fields and dropdowns, Settings fields, the period and More menus, the tabs
  and buttons at the top of task and goal drawers, the routine form's fields and weekday buttons,
  and fold-out sections such as "Add details" are all at least 44px tall. Some were as small as
  15-25px.
- On My Team, the person's name is a full-size target on a phone.

## v182 When a session ends in the middle of a save — 15 September 2026

- Pressing Save after your session has expired now takes you to sign-in with "Your session
  ended", and back to the same page afterwards. It used to show an error page saying the
  problem was "a read, not a save" and to check the local database.
- Signing in after following a link returns you to the same record, not just the same screen:
  the page's address is kept whole.
- The error page that remains for real failures no longer claims nothing was saved, and tells
  you to check whether a save went through before repeating it.

## v181 What a crawl of every page found — 14 September 2026

- My Team: each person's name is the button that opens them. The whole row was announced as one
  button, so a screen reader heard only "Expand team member detail" and none of what the row
  says, and the manager's decision button sat inside it. Clicking anywhere on the row still opens
  the person.
- Attachments no longer pushes the page sideways on a phone, and its table can be scrolled by
  keyboard. Tab rows wider than a phone, such as Records, scroll within themselves.
- Night mode: attachment names, the section headings on a Directory page, and the "Open person"
  links on waiting work were nearly invisible, and are readable now.

## v180 Assigned work keeps its evidence rule and files — 14 September 2026

- A manager creating New Work with somebody else as Primary owner now gets exactly what the form
  said: the Completion evidence rule and its instruction, the reason given for a project, and
  the attached files all arrive on the assigned task. Before, the task arrived with evidence
  optional and no files, and the files were deleted.

## v179 A chosen option does something — 14 September 2026

- Filters apply as soon as an option is chosen: Directory status, the Organisation department
  filter, and the Records filters. Apply and Find stay for typed searches. Stepping through a
  filter with the arrow keys waits until you press Enter or move on, so a keyboard can still
  reach every option.
- On a person's visibility settings, the people list no longer greys out under "No team
  visibility". Ticking somebody switches the mode to "Specific people only", and the form says so.
- "Also invite" when scheduling a discussion is a list of ticks. It was a multiple select, where
  an ordinary click replaced the person already chosen.

## v178 Import the organisation from Excel — 14 September 2026

- Import organisation accepts an Excel workbook (.xlsx) as well as CSV. The first sheet is read,
  and checked exactly as the same rows in a CSV would be.
- The old .xls format is named as such, with how to save it as .xlsx or CSV.

## v177 Find people by department, and see where they sit — 14 September 2026

- Organisation's "Find a person" has a Department filter. With a name it narrows the search;
  on its own it lists everybody in the department and says who heads it.
- Each department has a "People" link that does the same.
- Every result has "Show in chart", which opens the chart down to that person — the line above
  them open and their own reports ready — and marks them.

## v176 The Directory keeps both lines, and can say what they were — 14 September 2026

- A person's Directory page has a "Dotted-line manager (optional)" field, on the Create user
  form too, saying the line gives nobody sight of their work. It is the same dotted line the
  Organisation view draws, with the same rules.
- Moving somebody's reporting line onto their dotted-line manager ends the dotted line, as it
  does everywhere; choosing the same person for both lines is refused before anything is saved.
- "Reporting history" on the same page lists every change to both lines by the date it took
  effect, who made it and why, and answers "Who did they report to on" a date you choose — saying
  when the record cannot vouch for a date before its first change.
- Saving a person whose manager or dotted-line manager has since been deactivated no longer
  clears that line: the form keeps showing who it points at.

## v175 Your team first, and nobody left off the list — 14 September 2026

- Giving work to somebody starts with your own team. "Primary owner" when assigning work, and
  "Who should carry this work?" when reassigning it, list the people who report to you under
  "Your team", then everyone else under "Everyone else". Somebody with nobody reporting to them
  sees the plain list.
- People lists no longer stop part-way through a large organisation. The assignment pickers
  stopped at 200 names and the Directory at 500, so in a company of six hundred some people
  could not be found or given work. They now read everybody.

## v174 Import the organisation from a file, checked first — 13 September 2026

- Organisation has "Import organisation": a CSV file with one row per person, found by
  employee ID, that sets department, job title, reporting manager and dotted-line manager for
  hundreds of people at once. Excel saves one with Save As → CSV UTF-8.
- Checking the file writes nothing. It says how many rows are ready to change, how many already
  match, and what is wrong with the rest — "1 unknown department, 7 missing managers, 1
  circular relationship" — then lists each problem by the row it is on.
- Loops are found across the whole file, not only row by row: two rows that each put somebody
  under the other are both refused, even though either alone would be fine.
- "Apply N changes" writes only the rows that passed, all together or not at all, into the same
  dated history as every other move. If the organisation changed after the check, it refuses,
  checks the file again, and shows the new answer.
- "Download the current organisation" gives the file to start from. Brought back unchanged, it
  changes nobody.
- It places people who already have an account; it does not create accounts. A row for
  somebody who is not in the Directory is named as a problem.

## v173 A dotted line, which grants nothing — 13 September 2026

- Organisation can record who somebody works for alongside their reporting manager: the dotted
  line. Each person's row has a "Dotted line" control, and the line is shown on the row in
  words — "Dotted line to Amer Hakim".
- A dotted line gives nobody sight of anybody's work, and the screen that draws it says so. If
  the dotted-line manager needs to see the work, that is granted on the person's Directory page,
  on purpose, where every other grant is made.
- It is written into the same dated history as reporting moves, and refused where it would say
  nothing or point at somebody who has left: the person themselves, their own reporting manager,
  or a deactivated account.
- When somebody's dotted-line manager becomes their reporting manager, the dotted line goes, and
  that is recorded too.

## v172 Every move is recorded, whichever screen made it — 13 September 2026

- Changing somebody's manager from their Directory page now goes through the same procedure as
  Organisation: it is written into the reporting history with its date, and refused for the same
  reasons — a deactivated manager, or a line that would loop back on itself.
- Before, a manager changed in the Directory was saved straight onto the profile, and the
  history v169 added never heard of it.
- A save that says nothing about the manager now leaves it alone. The procedure used to read a
  missing manager as "clear it", so an update to somebody's name or job title that did not
  resend the manager moved them to the top of the organisation. The Directory form always sent
  it, so the screen was safe; anything else calling the procedure was not.
- If a move is refused, nothing else in that save is applied.

## v171 Organisation says where it is incomplete — 13 September 2026

- Organisation opens with the gaps in the records, each stated as a sentence: people nobody
  placed, people with no department, people still reporting to an account that has been
  deactivated, and departments with no head or a head who has left.
- "Nobody placed" means no manager and nobody reporting to them. Everybody at the top of a
  reporting line has no manager, so that alone would have named the director as a problem.
- Each line opens to the people or departments concerned, and each of those carries the control
  that fixes it — Change manager, Edit, or Set department — rather than a report about it.
- When there is nothing to say, it says "No organisation issues" and nothing else.
- No migration.

## v170 Departments from the screen — 13 September 2026

- Organisation has a "+ Department" form: the name, a code, what it sits under, and who heads
  it. Departments became records in v165; until now the only way to make one was a database
  call.
- Each department has an Edit link for the same four answers, and for whether it is still in
  use.
- The rules the records already kept are now said on the screen: a code another department uses
  is refused, a department cannot end up inside itself, and one that still holds people or live
  sub-departments cannot be archived.
- No migration.

## v169 A reporting line you can change, and look back on — 12 September 2026

- An administrator can move somebody from Organisation: drag them onto their new manager, or
  use "Change manager" on their row — the same door for a keyboard, a phone, or a mouse.
- Nothing moves on the drop. Both routes end at one confirmation stating who is moving, who
  they report to now, and who they would report to instead, with Cancel beside Save.
- A move can carry a reason and the date it took effect — a transfer agreed on the 1st and
  entered on the 9th belongs to the 1st — and every move is written down, so "who did they
  report to in March?" has an answer six months later.
- Refused rather than half-done: a line that would loop back on itself, a manager who has been
  deactivated, and anybody who is not an administrator. A move that changes nothing is not
  recorded as a move.

## v168 Identity and access shows the organisation — 12 September 2026

- The administrator screen is now two halves of one job: **Directory** maintains the account —
  who somebody is, what they may do, who they can see — and **Organisation** answers where they
  sit. It was one screen doing the first and implying the second through a list of names.
- Organisation names every department with its size and who heads it, and says plainly when a
  department has no head or somebody has no department.
- The reporting line starts at the top and opens one branch at a time, because a chart that
  draws six hundred people at once is a wall nobody reads and a page nobody waits for. An open
  branch is part of the address, so a reload or a shared link shows the same thing.
- Search answers with the line above a person — Administrator → Manager → them — rather than a
  bare name, which is the half a name cannot say.
- Read-only for now. Changing a reporting line from here comes next.

## v167 A person has a job title — 12 September 2026

- The user record now holds what somebody is called — EHS Manager, Senior Executive — which the
  application role could never say: it holds three values, chosen for permissions. An
  organisation chart of bare names says very little.
- The title is descriptive and decides nothing. Authority is still the role, sight is still the
  visibility model, and management powers still follow the reporting line.
- Set it when creating somebody or on their page afterwards; emptying the box clears it, and a
  save that does not mention it leaves it alone. Every change is on the record.

## v166 Closing a goal puts the caret back on its row — 12 September 2026

- A goal opened by its address — from a notification, from a bookmark, or by any press that did
  not leave the keyboard on the row — used to drop the keyboard at the top of the document when
  it closed. The drawer gave focus back to whatever held it when the goal opened, which in that
  case was nothing at all, and handing focus to nothing reports success.
- A goal drawer now knows which row is its own, and puts the keyboard there when the row is not
  what opened it. Where the row did open it, nothing changes.

## v165 A department is a record, not a label — 12 September 2026

- A department now has a parent, a head and a status, so the organisation has a shape the
  product can read: which unit sits under which, and who heads one. It was a code and a name.
- Creating or changing one is an administrator action, validated and audited: the code must be
  unique, a department cannot end up inside itself at any depth, and archiving one that still
  holds active people or live sub-departments is refused.
- Naming somebody the head of a department grants them nothing. What a person may see is still
  the visibility model, set per person (v66, v68, v80).

## v164 A closed dialog leaves the caret alone — 12 September 2026

- Closing a dialog gives the keyboard focus back to the button that opened it only if you have not
  already moved on. It used to take focus back 200ms later regardless, so closing "Set a Goal" and
  opening a goal straight away left the caret on "+ New goal" — and closing the goal returned it
  there instead of to the goal's row.
- That is why a Goals test had failed now and then in full runs since v138: the drawer fixes in v138
  and v149 were aimed at the drawer, and the dialog was taking the caret.

## v163 A calendar that reads at a glance — 11 September 2026

- Colour now means one thing, the kind of entry: tasks neutral, routines soft green, steps soft
  lavender. Overdue and review dates are small chips rather than whole-card colours, so a late routine
  still looks like a routine.
- Each entry is its title and one short line: the type with a small mark, a chip if it is late or up
  for review, and one fact — "↘ Amer" for a step somebody owes, the work a step of yours is part of, or
  "2 steps due". The "Due:", "Shared step:" and "↳" prefixes are gone; the full sentence is on hover.
- A step past its date now says "Overdue" on the calendar.
- A shorter legend in two parts: Type, and Status.
- The chip and the line beneath each title are the entry's own size rather than a fraction of it,
  which had come out at 7.6px and 8.3px, off the type scale. The type-scale check now measures text
  kept from screen readers too — where every entry's visible label lives — so it catches this.

## v162 Completed work leaves the calendar — 11 September 2026

- The Monthly Plan no longer shows completed work, including completed routine occurrences. Completed
  steps already left it.
- Whoever assigned a piece of work is told when somebody else completes it: "Work completed", in the
  bell only, opening the work. A task's completion used to tell nobody unless a review was asked for;
  a step's has told its owner since v158.
- Not for work you completed yourself, work nobody assigned, a routine occurrence, or work you are
  asked to review — "Completion review needed" already tells you it is done.

## v161 Trackable Steps: who is told when a step is the owner's — 11 September 2026

- A manager adding a step to your work for you, or handing one back to you, now tells you: "New step
  on your work", opening your work at the step. It said nothing, because a step assigned to the
  work's owner did not count as an assignment.
- Not for a step you gave yourself, and not while the assignment of that same work is still unread —
  that notice already says so.
- A contributor is told when their step goes back to the owner or to nobody — "Contribution
  withdrawn" — as they were already told when it went to somebody else.
- `focus.notify_step_for_owner`; the two assignment triggers are replaced.

## v160 Trackable Steps: My Day knows about steps — 11 September 2026

- Needs attention counts a late step of your own — "1 step overdue" — as it has counted a late step
  somebody else owes you since v155, and a late contribution you owe on somebody else's work — "1
  contribution overdue".
- Coming up lists the steps you owe that fall due in the window beside the work that does: "Step: …"
  for yours, "Shared step: …" for a contribution, each with the work it is part of, opening at the
  step.
- "A step was handed to you" is said only when somebody else gave you the step. One you gave yourself
  on your own work ranks as the active work it is.
- No migration: My Day reads the calendar's step rows (v159).

## v159 Trackable Steps: your own steps, too — 11 September 2026

- The calendar shows a step you gave yourself, or left unassigned, when it has a date of its own:
  "Step: Prepare structure" on its day, opening the work at that step. Before, only steps handed to
  somebody else appeared. An undated one is counted on the work's own entry, as other people's are.
- A delegated step dated on work that has no date of its own now shows on the owner's calendar. There
  was no entry to count it on, so it appeared nowhere.
- The Active card says "⚠ 1 step overdue" when a step of your own is past its date, and "Next step
  due 14 Sep" when yours comes before the work — the earlier of yours and other people's.
- The Shared list says "Overdue since 10 Sep" for a contribution past its date; it used to show the
  date alone. My Team's expansion marks active work that has a late step.
- `task_overview` appends `own_step_overdue_count` and `next_own_step_due_at`; `plan_events`' step
  branch adds the owner's own dated steps and names whoever owes a step.

## v158 Trackable Steps, stage 5: who is told what about a step — 11 September 2026

- Assigned: the assignee's notice now says when the step is due — its own date, or its work's.
- Overdue: the person who owes a step is told once, the morning after it was due. The owner already
  sees it in Needs attention. A step on work that has not started, or is paused, is left alone.
- Completed: the owner is told quietly — in the bell, not by email — and the notice opens their work
  at the step.
- Small edits to a step, its wording or its date, tell nobody.
- `notifications` gains `quiet` and `dedupe_key`; `notify_overdue_contributions` runs in the daily
  scheduled job.

## v157 Trackable Steps, stage 4: My Team sees the steps people owe — 11 September 2026

- A person's row on My Team counts the steps they owe on other people's work — "4 active · 3 shared
  steps" — and says "⚠ 1 assigned step overdue" on a line of its own once one is late.
- Opening them lists those steps under **Contributions to others**: whose work, when each is due or
  how late it is, and why it is held when that is not their doing. Each opens the work at the step.
- Read from the same record the assignee's Shared list and the owner's Waiting on others read, under
  the viewer's own visibility.
- Fixed: a step on work in the Bin stayed on the assignee's Shared list, on the owner's Waiting on
  others and on My Team. `shared_contributions` now leaves binned work out, as every other list
  already did.
- Fixed: the red "N overdue" on a My Team row, and "Missed" beside it, were never red — a more
  specific grey rule had won since they were written. Only the overdue count is red, not the line.

## v156 Trackable Steps, stage 3: a calendar that knows about steps — 11 September 2026

- The Monthly Plan shows the steps people owe. Yours read "Shared step: …" on their date, with the
  work they belong to beneath, and open that work at the step. A step you are waiting on appears as
  "↳ Amer Hakim · …" only when it is due before the work itself.
- Steps due with their task are counted on the task's own entry — "3 steps due" — instead of four
  squares on one day. Step entries never drag; a step's date is changed in its step (v154).
- A manager's calendar now opens on their own commitments; **My team** is one click away and shows
  the team's early step deadlines as well.
- `plan_events` gains a step branch and seven columns; `/work?task=…&step=…` opens a task with that
  step marked and brought into view.

## v155 Trackable Steps, stage 2: waiting on others — 11 September 2026

- The Active card says whose steps are out: "1/3 steps · 2 with others", and "Next contribution due
  10 Sep" when a step is needed back before the work itself. Once one is late the line becomes
  "⚠ 1 delegated step overdue" — the work is not late yet, and the row says it is at risk anyway.
- My Day gains **Waiting on others**: each late step by name, who owes it, how late, and the work it
  belongs to, opening that work. Ordinary delegation stays quiet; only a late step appears, and it
  counts in the Needs attention banner as "N waiting on others".
- `task_overview` gains the delegated counts and the next contribution date; `shared_contributions`
  gains the assignee's name. The owner reads the same step record the assignee sees in Shared.

## v154 Trackable Steps, stage 1: a step's date holds — 11 September 2026

- A step's row in its task now says who owes it and by when — "Amer Hakim · Due 10 Sep" — using the
  task's date when the step has none of its own, and "Overdue since …" once it passes. A finished step
  says who finished it and when, and its evidence opens from the row.
- Add step asks **Due** up front and answers it: **Same as the task**, linked, so the step moves when
  the task moves. **Its own date** is for work needed back earlier, and cannot be after the task.
- The database enforces that rule for every writer, and `change_task_due_date` — the Monthly Plan's
  drag included — refuses to move a task earlier than one of its steps' own dates, naming the step.
- First of five stages delivering the Product Owner's Trackable Steps model (11 September 2026); see
  `docs/trackable-steps-impact-map.md`.

## v153 Governed calendar rescheduling — 10 September 2026

- A task's due date can be dragged to another day on the Monthly Plan, or moved with **Move
  to…** beside it, as the Product Owner asked (“move freely like Outlook”).
- Every move calls `change_task_due_date` — the task drawer's own action — so the same
  authority check, closed-work refusal, version guard and `task_due_date_changed` audit event
  apply. Undo is a second audited change back, offered for about ten seconds.
- `plan_events` gained `task_version` and `can_reschedule`, so the calendar offers a drag only
  where the server would accept it and quotes the version it was drawn with; a stale calendar
  is refused with a plain message and refreshed.
- Routine occurrences, review and selection deadlines, and meetings stay fixed. Ownership and
  task state are never changed from the calendar.
- Move to… is the keyboard and touch route (WCAG 2.5.7); on the mobile agenda it is always
  shown at a 44px target. A timed commitment keeps its time when it changes day.
- Spec §17.3 carries a dated amendment recording the approval; the original rule against
  ungoverned drag-and-drop still stands.
- Found while testing, and fixed: the calendar's owner line was faded to 3.2:1 contrast (WCAG
  1.4.3 needs 4.5:1), and its `role="grid"` had cells with no rows around them and no arrow-key
  navigation. The owner line is now full strength and the calendar is a table with week rows;
  neither change moves anything on screen.
- `scripts/run-production-smoke.mjs` takes `SMOKE_PORT` (default 3100), as the end-to-end server
  takes `E2E_PORT`, so the suite can run beside another application holding the port.

## v120 Transactional notification email — 30 August 2026

- Added one durable email-delivery record in the same transaction as every new in-app notification,
  including new work assignments, checklist collaboration handoffs, barriers, reviews, Goal actions,
  routine exceptions, and governed decisions.
- Added a restrained navy/blue/neutral transactional template with matching plain text, contextual
  action labels, and safe deep links to the exact application record.
- Added prompt post-response dispatch for Server Actions plus scheduled retry/recovery through the
  existing authenticated cron endpoint and `worker:notifications` local operation.
- Kept notification generation authoritative in PostgreSQL: email transport neither invents new
  alerts nor duplicates client-side business rules.
- Added recipient-only delivery-history visibility, service-role-only claims, bounded retries,
  generated database types, unit/integration/pgTAP coverage, and desktop/mobile email prototypes.

## v103 Reliable in-app PDF attachment reading — 29 August 2026

- Replaced the browser PDF plug-in iframe with a lazy-loaded PDF.js canvas renderer, removing the
  dependency on Chrome/Edge “download PDFs” preferences that produced the grey Open placeholder.
- Added page navigation, page count, bounded zoom, Fit width, high-density rendering, responsive
  controls, loading feedback and a readable corrupt-file fallback.
- Kept Download as an explicit separate action in the attachment header, using the original
  filename without opening a disposable browser tab; opening a PDF no longer downloads a copy.
- Preserved the authenticated private-file route, RLS decision, automatic attachment-view audit,
  image preview, safe MIME allowlist and unsupported-file download behavior.
- Added unit allowlist coverage and desktop/mobile end-to-end PDF rendering coverage.

## v85 Operational Action disclosure clarity — 28 August 2026

- Removed the duplicated expanded Steps heading, completion count, and permanent teaching copy; the
  disclosure button is now the single visible Steps title.
- Replaced the long `First: …` preview with a compact remaining count or viewer-specific action count.
- Stopped Updates from repeating the latest update body in both the disclosure summary and record;
  the summary now shows only the latest time.
- Added consistent disclosure/body inset, safe text wrapping, and desktop/mobile overflow coverage.
- Preserved all Step, update, evidence, permission, progress, audit, API, RLS and database behavior.

## v70 Team member workload details — 18 August 2026

- Replaced the Team Member drawer's count-only Other workload paragraph with named, compact lists
  of Available tasks, overdue routine occurrences, and current Goals.
- Made every workload row a native whole-row link to the exact Task, routine occurrence, or Goal
  detail, with keyboard focus, mobile-sized disclosure target, wrapping metadata, and explicit
  empty states.
- Corrected ambiguous counts: routine context now explicitly means overdue occurrences, Goal
  context excludes terminal Goals, and every displayed total is derived from its rendered list.
- Preserved the selected Team member and filter when a Goal opens by carrying a validated internal
  return path; external and protocol-relative return targets remain rejected.
- Kept the authorised Team roster, Task/Goal RLS, and existing action capabilities authoritative;
  no database, migration, permission, workflow, notification, audit, or production-data change was
  introduced.
- Added deterministic desktop/mobile Playwright coverage for exact record navigation, layered
  return, keyboard activation, responsive containment, count/list parity, and direct-URL denial.
- Corrected the CI E2E runner to build and serve an isolated production artifact; the former
  long-lived development compiler exhausted the GitHub runner heap late in the mobile suite.
- Moved Activate/Move out Undo feedback to the persistent Work-page boundary so a successful
  status change cannot unmount its own ten-second Undo control; feedback invoked in a task drawer
  remains inside that modal and returns keyboard focus to the restored action. Added isolated
  mutation fixtures and explicit Server Action completion waits so one E2E journey cannot corrupt
  the next.

## v69 Team visibility and performance repair — 17 August 2026

- Made `focus.can_view_user` the explicit boundary for Team workload and focus projections, so the
  reporting-manager profile exposed for attribution cannot leak into My Team.
- Verified that administrators receive every active user in Team, including Izzul, while manager,
  explicit-only and no-visibility scopes remain restricted.
- Intersected Team Available work with the authorised people roster. Sharing one task no longer
  promotes its otherwise-unrelated owner into My Team.
- Replaced per-person correlated workload/focus counts with set-based aggregates and changed Team
  attention derivation from repeated full-array scans to owner-indexed lookups.
- Added request-scoped memoization for roster, focus and attention reads, removed a redundant owner
  lookup and stopped loading the Available badge outside Team scope.
- Narrowed Team task projections to the fields those screens render. With a 500-row retained test
  workload, the attention query fell from roughly 2.4 seconds to roughly 0.3 seconds locally.
- Changed authoritative Team reads to fail through the route error boundary instead of presenting a
  query failure as a truthful empty state.
- Added pgTAP, real-Supabase integration and desktop/mobile Playwright coverage for the complete
  permission matrix, Izzul visibility, keyboard drawer navigation, focus restoration and
  collaboration isolation.

## v53 closed-loop execution and Goal sessions — 10 August 2026

- Closed Task completion/cancellation across focus, Barrier, notification, Meeting Queue and Shared
  projections while retaining audit history; made Mandatory cancellation manager-only.
- Kept reassignment state-stable, recalculated both owners and surfaced non-blocking workload review.
- Added the lean Major Project discussion flow with Agree, Request changes, Decline and owner
  resubmission; agreement creates Available work for owner activation.
- Added module-neutral Task source links without any ESH-specific schema or parallel execution model.
- Added performance periods, employee Goal plans, exactly-once monthly and quarterly all-Goal
  sessions, department-only self-governance and exact-100 plan finalisation.
- Reused the Barrier/request engine for Goal support and preserved Response versus Resolution.
- Split Goal completion from cancellation, required actual results and final summary for completion,
  retained cancellation reason/allocation deficit, and required audited reasons for Active revision.
- Removed fabricated overall Goal percentage presentation from Goal rows, detail and weekly summaries.
- Added RLS, integration and Playwright coverage for the new lifecycle boundaries.

### Request-engine defects found while verifying the above — 11 August 2026

- Fixed the attention read model, which resolved every request's subject through `task_id`. A
  request raised against a Goal has none, so a single one of them failed the whole lookup: every
  card on My Day and the attention list, Task requests included, lost its heading and rendered
  "Work", and the Goal request's own control pointed at `/work?task=null`. Requests are now read
  through `action_requests_overview`, which resolves either subject in one query, and a Goal request
  opens its Goal.
- Fixed Goal support notifications, which carried `entity_type = 'barrier'` with no task and so fell
  through every branch of the link resolver to My Day. The bell said somebody needed you on a Goal
  and then took you nowhere near it.
- Excluded requests whose source has gone terminal from personal attention, matching the cleanup the
  cancellation path already performs.
- Ranked a Goal support request with the other requests instead of letting it fall to `awareness`
  and sit below every notice on the list.
- Removed the `aria-label` from the Goal drawer's Sessions control, which said "Open employee-level
  Goal session history" and so did not contain its own visible word (WCAG 2.5.3). Renamed the second
  control in the check-in summary to "View sessions": two buttons reading "Sessions" in one dialog
  cannot be told apart out of context.

### Legacy cleanup — 11 August 2026

- Retired the `/team` page. It survived as "compatibility and depth", but the depth moved into the
  Team Member drawer inside Work and the page became a second implementation of the same three
  questions over its own copies of the same queries. `/team` now 308s to `/work?scope=team`, so
  every existing link, notification and bookmark still resolves.
- Removed the superseded per-Goal cadence entry points — `postGoalUpdate`,
  `postGoalMonthlyCheckin`, `saveGoalQuarterlyCheckin` and `saveGoalYearEndResult` — which each
  drove one Goal through its own month, quarter or year end. Sections 11 and 14 replaced them with
  one employee session covering every Active Goal.
- Removed `closeGoal`. One verb for two different endings left the record unable to say afterwards
  whether a Goal had run its course or stopped being relevant (section 17).
- Removed the `recordAttachmentView` action. Opening evidence is recorded by the route that serves
  the bytes; this was a second door onto the same write that no screen used.
- Dropped the superseded Goal procedures behind those actions: the v33 authoring stack
  (`create_goal`, `create_goal_v33_internal`, `create_goal_with_measures`, `propose_goal_version`,
  `agree_goal_version`, `agree_goal_version_v33_internal`), `post_goal_update`, the per-Goal cadence
  (`post_goal_monthly_checkin`, `save_goal_quarterly_checkin`, `save_goal_year_end_result`) and
  `close_goal`. Each was `security definer` and granted to `authenticated`, so each was a second
  reachable way to write into the Goal engine — one that creates monthly records the session model
  cannot see, agrees versions outside the lean flow, or ends a Goal without saying which kind of
  ending it was.
- Moved the integration suites that were their only remaining callers onto the replacements, so the
  rules survive the procedures: creation authority, the 100% allocation guard, milestone
  independence, revision rollback, session authority, risk as visibility rather than manager action,
  and cancellation still needing its reason. Four tests were retired rather than migrated, because
  what they asserted no longer exists.
- Withdrew two earlier removal candidates after re-checking: `post_task_update_v34_internal` and
  `post_goal_milestone_update` are both called from SQL, not from the application, and are alive.

The behaviour changes approved in v42, v43 and v44 are recorded in
`MASTER_PRODUCT_SPEC.md` section 33 and `PRODUCTION_LOGIC.md` section 40, which
are the authoritative account of them.

## v51 lean Goal agreement experience — 10 August 2026

- Replaced the technical Goal setup form with a two-step Expectation / Alignment agreement flow:
  plain-language success statements, one Goal date, visible allocation guidance, optional context,
  agreed approach, optional support and zero-to-five deliberately added milestones.
- Enabled employees to create and refine their own Draft / For Discussion Goal while preserving
  manager-only activation. My Team creation locks the selected subordinate and no longer asks for
  the employee a second time.
- Kept one Goal/version model. Pre-activation edits replace the pending version transactionally;
  Active structural changes use Revise goal and remain audited pending manager agreement.
- Added compatible natural success-statement and optional-date columns, lean security-definer RPCs,
  reporting-line/role/allocation checks, RLS coverage and regenerated database types. No duplicate
  Goal, measure, cadence or evidence system was introduced.
- Renamed the active reading view to Success, added cadence context, simplified monthly and
  quarterly wording, and retained exception-only manager visibility.
- Added domain, integration, RLS and end-to-end coverage for self authoring, subordinate authoring,
  zero milestones, hidden technical fields, same-record edits and manager-only activation.

## v50 Goal lifecycle — 10 August 2026

- Added version-owned structured qualitative, numeric and percentage success measures with
  deterministic measure-derived overall progress and immutable value history.
- Kept Goal setup as two logical steps while making employee, result, measures, target, weight and
  two-to-five milestones explicit; the existing formal 100% guard remains authoritative.
- Rebuilt Active Goal detail around Progress, Check-in, Milestones and History, including optional
  evidence and linked work without converting either into Goal progress.
- Added idempotent monthly owner check-ins, explicit No material change, quiet On track behavior,
  and exact manager exceptions only for risk, Off track or requested support.
- Kept manager-requested updates owner-facing: requesting one no longer overwrites employee health
  or creates a false action in the requesting manager's My Team queue.
- Added quarterly employee summary plus manager Agree & continue and a traceable, refinable,
  manager-finalized year-end Result.
- Added deterministic calendar schedules, owner My Day cadence, quarterly Coming up entries and
  genuine Goal actions in My Team.
- Added additive migrations, RLS/select-only lifecycle tables, transactional RPCs, derived views,
  generated types and unit/integration coverage. Existing non-Goal behavior is unchanged.

## My Day attention cap amendment — 10 August 2026

- Reduced the bounded Needs Attention summary from three rows to two. The total
  badge remains truthful and View all appears when additional requests are
  waiting, opening Work → My Team → Needs Attention.
- Rebuilt the summary rows with separate severity dots, request-type icons,
  requester avatars and overdue treatment; restored a 12px section gap and kept
  Start Here / Today as equal desktop columns at the approved 864px viewport.


## v49 attention UI repair — 10 August 2026

- Separated My Day's request-first attention summary from My Team's person-first
  manager rows; they share semantic action resolution but no presentation row.
- Replaced the generic task-row overlay on My Team with a dedicated five-column,
  whole-row keyboard target and independent nested action buttons.
- Removed `person` from exact task, routine and barrier action routes, preventing
  Team Member Detail from mounting before the requested action panel.
- Added one validated resolver requiring `sourceType`, `sourceId`, and `ctaType`;
  incomplete targets no longer render a dead CTA.
- Corrected overdue routines to resolve to the exact occurrence instead of being
  captured as generic overdue work or opening a routine landing page.
- Restored My Day to compact content-height rows with scoped text
  resilience and sent View all to Work → My Team → Needs Attention.
- Added action-isolation, pointer/keyboard, exact-target, viewport, zoom-pressure,
  stress-content, and resolver validation coverage.


## v49 — 10 August 2026

- Made My Day's Needs Attention a summary rather than a backlog. It shows the
  top three by priority at that revision, a real count, "N require action now · M more waiting",
  and a link to the full list. It previously grew with the count, so at twelve
  requests it pushed the rest of the day off the screen and became the thing it
  existed to prevent.
- Ranked the three deterministically instead of taking whichever arrived last,
  so a week-old blocked decision is not buried under three questions asked this
  morning. Age breaks ties within a severity band and never promotes across
  one, so nothing can sit at the bottom for ever.
- Stopped hardcoding "3 require action now". With one request it said three
  things needed you, which is a small lie that costs the whole panel its
  credibility.
- Added the full attention list under Work, with type filters, sort, and oldest
  first by default — a priority-sorted backlog quietly ages its least severe
  items into invisibility.
- Initially sent "View all" to the person's own full list. The later approved
  attention UI repair above supersedes that destination with My Team → Needs
  Attention. The later amendment above reduces the My Day bound to two rows.
- Gave nothing-to-do its own calm state: "You're all clear", no red border, no
  "View all 0".
- Separated exception from action required. An overdue routine is abnormal and
  worth seeing; it is not a question anybody asked the manager. Labelling both
  "Needs you" is how "Needs you" stops meaning anything.
- Removed "Review with them". It could have meant open the task, message the
  person, change the date, or arrange a meeting — nobody could predict which,
  so it named none of them. Every manager action now names its operation:
  Open task, Open routine, Provide decision, Review workload.
- Removed "Proposal to review", which counted rows in `work_proposals`, offered
  "Review proposal" and opened `/more/records`. There is no proposal review
  workflow — no procedure decides one, no screen shows what is proposed, no
  control approves it — so the manager arrived at a records page and had to ask
  what they were reviewing. The honest fix was to stop showing it, not to
  invent the workflow.
- Initially made the whole team row open through a stretched link. The later
  approved repair above supersedes that implementation for My Team because its
  nested action buttons require an independent non-link row target.
- Replaced "Nothing needs you" with "No action needed from you", and left rows
  in that state alone rather than inventing something to fill the column.


## v48 — 9 August 2026

- Stopped treating mandatory work as manager attention. The rule was
  `isMandatory → Needs Attention`, with the CTA "Review controlled action",
  which landed on an ordinary task where no review existed. Safety work that
  could not wait was being reported as an unanswered question, and a queue that
  cries wolf stops being read. Mandatory work running normally is now
  information, visible under Everyone.
- Made mandatory work reach the manager only when something else is also true:
  it pushed the person over their focus target, it carries a barrier addressed
  to them, or it is genuinely overdue. Each case states its own reason and
  offers its own action.
- Added the workload review the "Review workload" CTA now promises: the numbers
  that moved, the person's current commitments, and two real choices —
  accept the overload as a recorded decision, or move a non-mandatory item back
  to Available. The system does not pick, and mandatory work is never the
  candidate.
- Added a validity gate on manager attention. An item may only appear if it can
  say why it is there, what to do and where — anything else is dropped and
  logged. Every branch believed it complied; the one that did not was the one
  that shipped.
- Rebuilt the My Day attention card. It used to build its heading by joining the
  action type to the entire request, so the largest text on the screen was as
  long as whatever somebody typed — three paragraphs across the page instead of
  three scannable rows. It now leads with the action type as a small label, the
  task title as a stable heading, and a two-line preview of the request; the
  full text lives in the barrier panel, where it always did.
- Made the card resilient by construction rather than by luck: a grid where the
  text and the control own separate columns, `min-width: 0` so children may
  shrink, wrapping that breaks an unbroken 80-character reference, no fixed
  height, and a single column below the breakpoint. Tested with a 200-character
  request, an unbreakable token, a long task title, five widths and two zoom
  levels.
- Moved severity onto the item. A container that is entirely red says nothing
  about which row is worse; a request with a discussion booked is amber, not an
  emergency.
- Made team member names open a Team Member Detail drawer over My Team: focus
  capacity, what needs the manager, what the person is working on, what has
  meaningfully changed, and a collapsed count of everything else. Zero Active
  work is stated plainly — it is a fact, not a fault.
- Fixed contextual navigation. Closing the Task Detail drawer pushed a hardcoded
  `/work`, so a manager who opened a team member's task from My Team was
  returned to My Work — a different person's workspace, with the filter and the
  selected person gone. Each drawer is now a search parameter, and closing one
  removes only its own, so every layer beneath is preserved because nothing had
  to remember it.
- Fixed the manager row's default action, which pointed at `/team?view=all` — a
  page that discarded My Team entirely. It opens the person.


## v47 — 9 August 2026

- Completed the barrier workflow: a request can now be answered straight away,
  or deferred to a discussion that is queued, scheduled onto the existing
  Monthly Plan, and opened again from the calendar entry when the meeting
  happens. None of those steps answers the request; only answering does.
- Fixed "View request", which scrolled to a section the collapsed drawer hides
  with `display: none` — a visible control that did nothing at all. It now
  opens the drawer and brings the request itself into view.
- Renamed it to "View response" once an answer exists, so the control describes
  what the reader is about to see.
- Put every route to a barrier through one function. Notification, My Day, My
  Team, the task banner, the Meeting Queue and the calendar entry all build the
  same link now; previously each computed its own and they had begun to differ.
- Moved the request-type vocabulary into `src/domain/barriers.ts`. The wording
  had been copied into five places and already disagreed — "Provide approval"
  in one list, "Approve" in another.
- Extracted `BarrierDetailPanel`, so the record renders once wherever it is
  shown, and `BarrierActionPanel` remains the only place a response is written.
- Added the Meeting Queue to Monthly Plan as a drawer beside the scope filter,
  not a sidebar module: it is empty most weeks, and a permanent empty page
  teaches people to stop looking at it.
- Added scheduling. A discussion becomes a real event on the calendar the
  application already had — `plan_events` gained a `discussion` kind rather
  than a second calendar appearing beside the first — linked to both the task
  and the request, with the two people concerned invited by default.
- Kept queueing and scheduling separate. A manager usually knows a topic needs
  discussing before knowing when, and collapsing the two would force them to
  invent a date to record the need.
- Kept a scheduled request on My Day. Booking a discussion lowers the urgency
  from red to amber and says when it will be talked about; it does not clear
  the obligation, because the answer is still owed.
- Made the action cards survive content nobody has written yet: long requests,
  long names, unbroken reference strings, 150% zoom and mobile widths. The row
  wraps and the button moves below the text instead of crossing the border.
  Applied to the shared card patterns rather than the one sentence that
  exposed the problem.
- Fixed two defects in this work before they shipped: an RLS policy pair that
  referenced each other and made the calendar unreadable
  (`42P17 infinite recursion`), and a scheduling query whose local variable
  shadowed a column so `where event_id = event_id` matched every row.
- Left Outlook alone. The event table carries the columns a future sync would
  need and populates none of them; no credentials, no OAuth, no Graph calls.


## v46 — 9 August 2026

- Made a barrier request actionable where it arrives. A notification, a My Day
  row and a My Team row now open the same task with the same request expanded
  and the response box already focused. Previously all three opened an ordinary
  task drawer and left the manager to find the barrier, work out what was being
  asked, and scroll to a form.
- Kept it inside Task Detail. No barrier workspace, no fourth tab, no second
  record: most work has no barrier, and an exception that claims permanent
  navigation makes every task look like it might have one.
- Added My Day → Needs Attention, an action queue derived from the barrier
  itself. Each row states the request, who asked, the work it concerns, and the
  act — "Provide decision", never "Open".
- Held the line between Shared and Needs Attention. Shared means a checklist
  contribution somebody assigned you; Needs Attention means somebody is waiting
  on your decision. A barrier creates no Shared row and no checklist item, and
  assigning a step creates no attention request. Both directions are tested,
  because the failure mode is gradual: Shared quietly becomes "anything another
  person wants from me" and stops answering the one question it exists for.
- Made the barrier surface depend on the viewer. The owner sees who they are
  waiting for; the person asked sees that it is theirs to answer, whether they
  arrived from a notification or opened the task themselves.
- Stopped offering "Raise barrier" beside an open barrier, which invited a
  second request about the problem already on screen.
- Moved "Add to Meeting Queue" from the employee's request form to the
  manager's response panel. It had been asking the employee to predict whether
  their manager would rather handle the problem in writing or in a meeting.
  Adding twice reports the existing agenda item instead of duplicating it.
- Deleted the second barrier response form. There is now one, so the
  transaction rules cannot drift between two copies.
- Fixed idempotency keys under genuine concurrency. The mechanism read the
  operation log, ran the work, then wrote the log entry — so two requests
  arriving together both did the work and only the log was deduplicated. A
  double-clicked "Send decision" wrote two responses, two audit events and two
  notifications while reporting success. Operations now serialise on the key
  before deciding whether the work is needed; this affects every idempotent
  procedure, not only barriers.
- Fixed the drawer stealing focus from the control a person was sent to use.
  Focus is now decided in one place, and the content says where it belongs.
- Made the end-to-end gate's port configurable, so it can run beside a
  development server instead of demanding the port back.


## v45 — 9 August 2026

- Opened checklist assignment to any active team member. Eligibility was owner
  plus collaborators plus whoever the viewer could see through the reporting
  line, which meant an ordinary employee could hand a step to their manager and
  almost nobody else. Collaboration is not a hierarchy: "whose work may I read"
  and "who may I work with" are different questions, and only the first belongs
  to the reporting line.
- Added `team_directory`, a names-only projection of active colleagues. Opening
  assignment without it would have produced a picker containing two or three
  people and steps attributed to "Team member", because the underlying row
  policy on `user_profiles` is scoped to your own reporting line. The view
  carries a name and an employee ID and nothing else; every other column stays
  behind the policy, which is unchanged.
- Fixed Shared contributions disappearing across the reporting line. The
  projection inner-joined `user_profiles` for the owner's name, so when the
  policy hid the owner it did not hide the name — it removed the whole
  contribution from the assignee's list, silently. It is now a left join
  against the directory.
- Made checklist steps editable and removable, with the title, assignee, due
  date, evidence rule and prerequisite in one drawer behind a per-row overflow
  menu. Each save records only the fields that actually moved.
- Separated restructuring from contributing. A contributor may complete the
  step they were given; changing what a step *is* requires edit rights on the
  work. The rule lives in a `BEFORE UPDATE` trigger rather than the RPC,
  because the RLS policy legitimately allows a contributor to update the row
  and the RPC is not the only way in.
- Refused the removals that lose something silently: a completed step, a step
  with evidence attached, and a step another step is waiting for. Reassigning
  or removing a step tells the person who had it.
- Split "the manager has answered" from "the work is unblocked". A barrier now
  carries `action_pending` beside `status`: replying clears the obligation and
  leaves the barrier open, so a manager's queue empties when they have answered
  while the record still says the work is blocked. Nothing resumes on its own.
- Recorded which answer an approval received. "Approve" and "Request changes"
  were writing identical rows, so a week later the record could not say whether
  the work had been cleared to proceed.
- Replaced the barrier escalation field and the Meeting Queue checkbox with
  four request-type chips, and made the manager's control name the act:
  Send decision, Approve / Request changes, or Respond.
- Redirected `/team-focus` to `/work?scope=team`. The screen became a scope
  rather than a destination; old links now land on it instead of a 404.


## v41 — 8 August 2026

- Fixed the Capture title box losing every character after the first. `Modal` listed the caller's `onClose` arrow as an effect dependency, so each keystroke re-ran the effect and pulled focus back into the dialog. Covered by an acceptance test that types a full phrase and asserts the value, the focus, the caret position and the DOM identity of the input.
- Moved Primary Owner selection into Capture. An employee owns what they capture, so there is no picker; a manager gets a Primary owner selector defaulting to themselves. This replaces v40's separate assignment flow — deciding who owns a result and describing the result are one moment of thought.
- Rebuilt Shared as a projection over checklist items rather than a task list. `shared_contributions` selects the original rows, so completing a contribution updates the record the primary owner is looking at. No Shared copy exists to disagree with it.
- Added contribution readiness: Waiting for owner to start, Waiting for prerequisite, Ready, Completed. A contribution assigned to somebody else stays Waiting until the owner activates the parent, so a contributor cannot start work the owner has not committed to. Readiness recalculates from a trigger on the parent's state, which covers activate, pause, resume and conversion in one place.
- Removed fabricated Next actions. v40 wrote "Review and activate when ready" into `next_action` for everything landing in Available, which read as the owner's decision when it was interface guidance. Available now states what Available means and offers Activate; a genuine recorded Next action still shows, and an absent one says "No next action recorded".
- Exposed `+ Add step` directly in the Checklist view, asking only what needs to be done and who owes it, with evidence, a separate due date and a prerequisite behind More options. Steps can be added while the parent is still Available: planning what work involves is what you do before deciding to carry it.
- Gave Routine its own occurrence vocabulary — Upcoming, Due today, Overdue, Completed — instead of borrowing the focus-state label "Available Work" for occurrences nobody activates.
- Renamed the `backlog` display label from "Available Work" to "Available" so the state is called the same thing on every screen.



## v38 — 7 August 2026

- Replaced the task drawer's competing metadata pills with one quiet information line; detailed task ages remain available through the information control.
- Added authorised, optimistic, idempotent due-date editing with immutable previous/new/actor/time/reason history and readable Recent activity entries.
- Focused the Next Action card on the action, compact due context, Mark done, and Edit, and added a whole-row checklist preview.
- Pinned Current Next Action separately from the permanent Task checklist so it is never counted as another checklist item.
- Simplified evidence rules to No evidence required, Evidence optional, and Complete with evidence; required attachment and completion now commit atomically.
- Enforced checklist-derived task progress for existing and future checklist tasks and preserved checklist reopen history.
- Rebuilt Recent activity from immutable audit events and made the no-barrier state neutral while reserving red/pink treatment for open barriers.
- Added duration unit coverage, due/evidence integration coverage, RLS assertions, desktop/mobile E2E interactions, and the v38 impact map.


## v37 — 7 August 2026

- Synchronized the prototype and documentation to the uploaded `index(20260807-072841).html` reference.
- Preserved the same example users, tasks, goals, routines, focus counts, barriers, ageing values, wording, UI/UX, click behaviour, drawers, themes and flows.
- Retained all latest v34 Goal behaviour and v36 Next action / Team Focus behaviour.
- Reconciled older documentation conflicts so Goals are a dedicated workspace, Plan remains Calendar, task detail uses Next action, and the manager workspace is Team Focus.
- Added a forced mobile composition using the same canonical data and functions; no new business logic was introduced.

## v34 — 5 August 2026

- Added administrator-only user creation and account management.
- Added required name, unique employee ID, unique email, department, role, reporting manager, status, and weekly-summary preferences.
- Added deactivation/reactivation while preserving retained work and audit history.
- Added guarded permanent deletion for accounts without retained history, confirmed by employee ID.
- Added weekly personal email-summary preview generated from recorded task activity.
- Added manager team-change summary covering completions, progress/state changes, new barriers, newly overdue work, stale updates, and decisions required.
- Added compact Open, current-state, overdue, and stale duration indicators across My Day, Work, Team Load, routine lists, and task detail.
- Updated Master Product Specification, Production Logic, build acceptance gates, build prompt, README, desktop prototype, mobile prototype, and selector index.

## v28 — 5 August 2026

- Added a one-shot local production implementation prompt incorporating the Product Owner's complete-engineering quality standard.
- Selected a local-first Next.js and Supabase implementation baseline.
- Deferred GitHub remote, hosted Supabase, and Vercel connections to later approved stages.
- Added `AGENTS.md` and `CLAUDE.md` for repository-level coding-agent instructions.
- Added a flexible `CHANGE_INTAKE_PROTOCOL.md` so future updated Markdown and prototype files can supersede the initial build inputs.
- Added objective `BUILD_ACCEPTANCE_GATES.md`.
- Added local setup and future GitHub/Supabase/Vercel connection guidance.
- Updated Master Product Specification and Production Logic without changing current prototype behaviour.

## v27 — 5 August 2026

- Added `MASTER_PRODUCT_SPEC.md` as the authoritative product source of truth.
- Consolidated all latest approved workflow and UI/UX requirements from the prototype-design conversation.
- Updated document hierarchy and maintenance rules.
- Updated `PRODUCTION_LOGIC.md` to require synchronized Master Product Specification updates.
- Retained v26 user-facing prototype behaviour.


## v34

- Moved Goals out of the Calendar page into a dedicated primary Goals workspace.
- Added direct Goals navigation on desktop and mobile.
- Kept a compact goal exception strip in My Day for visibility without daily clutter.
- Replaced the staged milestone-only update form with a quick progress slider, short note and optional attachment flow.
- Made milestone rows directly actionable: adjust progress, mark complete, add comment and upload evidence.
- Added milestone editing, proposal, discussion and manager–employee agreement flow with version history.
- Updated the Safety Digitalisation example to five practical delivery milestones.


## v34 — Lean goal focus and milestone check-ins

- Separated goals into **Active**, **For discussion**, **Completed**, and **All** views.
- Only Active agreed goals contribute to formal weighting and weighted progress.
- Added visible 100% formal-weight control with remaining or over-allocated guidance.
- Simplified goal rows to one milestone-calculated progress value, health, target date, last-update age, and secondary weight.
- Made the full row clickable; the Update action appears only on hover/focus or when attention is required.
- Collapsed completed milestones and kept the current milestone visually prominent.
- Replaced the large milestone update modal with a desktop right-side drawer and mobile bottom sheet.
- Added slider ticks, direct percentage entry, saved-versus-new progress, one **Save update** action, optional evidence, support request, and **Mark milestone complete** control.
- Added validation that prevents an Active goal from taking the formal set above 100%; goals may still be saved for discussion.


## v36 — 7 August 2026

- Renamed **Do next** to **Next action** and replaced generic placeholder wording with a meaningful-action pattern.
- Added direct inline Set/Edit and Mark done controls for the current Next action.
- Split progress posting into **What changed?** and **What happens next?** so the latest update can refresh the task’s immediate action.
- Reused the current Next action as the actionable Checklist item.
- Moved task-age calculation guidance out of the action card and behind an accessible information control beside the age indicators.
- Preserved all v34 Goal workspace, formal weighting and milestone-update improvements.


## v36

- Renamed the manager workspace from **Team Load** to **Team Focus**.
- Replaced large repeated employee workload cards with a compact exception-first people list.
- Added Needs attention / Everyone filters and Priority / Name sorting.
- Added compact focus counts without misleading capacity progress bars.
- Added a right-side team-member detail drawer with actionable attention items, current focus, Next Actions, selective ageing, and collapsed secondary workload.
- Removed default emphasis on low-value counts and large empty category panels.
- Kept all v34 Goal and v35 Next Action behaviour unchanged.
