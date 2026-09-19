# Finding Management — Screenshot Reference Pack

These are rendered UI design references, not screenshots of a deployed application. Illustrative names, dates, email addresses and attachment filenames are not production records. No email is sent by these images.

Use the accompanying agent specification as the authority for behavior, security, data and acceptance criteria. These PNGs clarify layout and navigation. Each screen is separate; the overview is only an index.

## Locked design rules

- ESH Home opens two separate modules; switching modules replaces local navigation.
- Retain the actual TAMCO Focus menu. Its screenshot demonstrates placement, not a required redesign.
- The Action Owner uses one conversation and one composer. No separate corrective-action form or completion checkbox.
- Send update and Submit for review are distinct actions. Only ESH can accept and close.
- Owner emails contain both an action link and View All My Actions. They confer different access scopes.
- Owner and escalation recipient access requires no standard application account or password.
- My Actions contains only open actions belonging to the verified email, including pending ESH review.
- Escalation recipients can support/respond but cannot impersonate the owner or close findings.
- Photos shown as attachment tiles represent where real authorized previews belong; no site-condition photograph was invented.

## Screen index

### 01. ESH Home
File: `screenshots/01-esh-home.png`
Resolution: 2880 × 1960 px
Homepage has two live modules and no sidebar. No future-module clutter.

### 02. TAMCO Focus — module boundary
File: `screenshots/02-tamco-focus-navigation.png`
Resolution: 2880 × 1960 px
Only Focus navigation is visible. Menu labels illustrate placement; preserve the actual current Focus menu and workflows.

### 03. Finding Register
File: `screenshots/03-finding-register.png`
Resolution: 2880 × 1960 px
Finding Management has its own menu. Last update means meaningful activity, not a reminder email.

### 04. New finding — email-only assignment
File: `screenshots/04-new-finding-email-assignment.png`
Resolution: 2880 × 2480 px
ESH enters owner and escalation emails. Advanced escalation is expanded here for illustration; it can be collapsed in daily use.

### 05. Action Owner conversation
File: `screenshots/05-action-owner-chat-desktop.png`
Resolution: 2880 × 2140 px
Single conversation, one composer, no duplicate corrective-action form. Send update and Submit for review remain distinct.

### 06. Action Owner conversation
File: `screenshots/06-action-owner-chat-mobile.png`
Resolution: 880 × 2200 px
Single conversation, one composer, no duplicate corrective-action form. Send update and Submit for review remain distinct.

### 07. My Actions
File: `screenshots/07-my-actions-desktop.png`
Resolution: 2880 × 1960 px
Email-scoped open action list. Awaiting-review actions remain visible; there is no main platform menu.

### 08. My Actions — mobile
File: `screenshots/08-my-actions-mobile.png`
Resolution: 880 × 1860 px
Email-scoped open action list. Awaiting-review actions remain visible; there is no main platform menu.

### 09. Action Owner conversation — awaiting review
File: `screenshots/09-action-owner-awaiting-review.png`
Resolution: 2880 × 2140 px
Single conversation, one composer, no duplicate corrective-action form. Pending review permits chat but no duplicate submission.

### 10. ESH verification and closure
File: `screenshots/10-esh-verification.png`
Resolution: 2880 × 2200 px
Original and submitted evidence are compared in one review view. Only authorized ESH can accept/close; this form never appears for owners.

### 11. Escalation response
File: `screenshots/11-escalation-recipient-response.png`
Resolution: 2880 × 2140 px
Single conversation, one composer, no duplicate corrective-action form. Escalation recipient can respond but cannot submit as owner or close.

### 12. Action Owner assignment email
File: `screenshots/12-owner-email-two-secure-links.png`
Resolution: 2200 × 2000 px
Personalized recipient email. Two distinct links: one action scope and one email-owner inbox scope.

### 13. Escalation email
File: `screenshots/13-escalation-email.png`
Resolution: 2200 × 2000 px
Personalized recipient email. Escalation link does not expose the owner inbox.

### 14. Closed finding register
File: `screenshots/14-closed-finding-register.png`
Resolution: 2880 × 1960 px
Recent verified closures; all evidence and verification history remain accessible to authorized ESH.

### 15. Follow-up policy settings
File: `screenshots/15-follow-up-policy.png`
Resolution: 2880 × 2240 px
Timing values are configurable example defaults, not approved company policy. Recipient emails are set on the action.

### 16. Expired secure-link recovery
File: `screenshots/16-secure-link-recovery.png`
Resolution: 2000 × 1600 px
Expired/used-link recovery stays outside normal application login. Do not reveal finding data or account existence before verification.

## Agent use

Implement responsive equivalents of these reference layouts. Do not bake screenshots into the application. Keep buttons, conversations, file previews, secure access and status transitions fully functional. Follow the specification where behavior cannot be inferred from an image.
