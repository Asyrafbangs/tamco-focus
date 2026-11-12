# Stage 6 — pilot and rollout readiness

Stage 6 is the only stage whose work is a decision rather than a change. Nothing
here deploys anything, opens the rollout or touches Production: those are gated
on explicit human approval, and an agent in this environment cannot read
Production at all.

What this document does is separate three things that get confused when
somebody asks "are we ready?": what has been **proven**, what only the account
owner can **establish**, and what nobody has **decided**.

> **Reconciled 12 November 2026.** This document began as the original S6
> assessment. Later merged work supplies v287 classification, readiness tooling
> and QR-location administration; later owner evidence records the relevant
> migrations as applied. The original assessment remains useful rationale, but
> its taxonomy and administrator-role items are not current implementation
> blockers. This reconciliation is not a new Production read and does not
> authorize any activation.

## The rollout machinery is sound, and that was worth checking

Audited rather than assumed:

- **The mode cannot be flipped through the API.** `authenticated` holds only
  `select` on `esh_rollout_settings`; the single `update` lives inside
  `public.esh_set_rollout_mode`, which is `security definer`, refuses anybody
  who is not `focus.is_admin()`, rejects a mode outside
  `('restricted', 'live')`, demands a reason of at least ten characters, locks
  the row `for update`, and fails closed with `rollout_not_configured` if there
  is not exactly one settings row.
- **Going live is actually possible.** v197 created the table with
  `check (mode = 'restricted')` — only one legal value — while v224's procedure
  accepts `'live'`. v224 drops and re-adds the constraint as
  `check (mode in ('restricted', 'live'))`, so the pair is consistent. Had it
  not, the first attempt to open the rollout would have failed with a check
  violation at the worst possible moment.
- **Opening the rollout is not sending.** `esh-rollout-v224.spec.ts` drives the
  real screen: it asserts held mail stays `held_rollout` after the mode goes
  live, that a _new_ assignment is then `queued` rather than held, that
  releasing is ESH's act and is not offered to an administrator who holds no
  Finding access, and that a one-word reason leaves the button disabled. Its
  `finally` resets the mode and throws if it was left live, so a later spec
  cannot inherit an open rollout.
- **Going back to restricted revokes what the mode granted.** The procedure
  ends sessions and grants and bumps `authorization_version` on the way down.

A pilot can therefore be run in `restricted` mode without any risk of mail
reaching the whole company, which is the property a pilot needs.

## Governance note, verified rather than quoted

`MIGRATION_STATUS.md` records a Phase 5 blocker: the `administrator` role still
carries business-manager authority, and it "must be split before a real System
Admin account exists". That is still true, and it is not a documentation
artefact:

`focus.can_agree_goal()` (v53, `20260810016000_v53_goal_lifecycle_operations.sql:106`)
returns true when `focus.is_admin()`, with no further test — so an
administrator can agree **any** employee's Goal in the organisation, not only
those they manage. The same equivalence appears across Goal create and
lifecycle paths (`goal_security_v33`, `lean_goal_v51`, `v34`), each written as
`not focus.is_admin() and not focus.is_manager_of(p_owner_id)`.

This remains a real governance risk, but the approved lean package explicitly
defers the role split and says it does not block this workstream. Splitting the
role still needs a policy decision, a migration and a separate stage; it is not
a reason to report S6 implementation as incomplete.

## What only the account owner can establish

None of these can be read from this environment. The later deployment record
is dated evidence, not a substitute for fresh checks before a future change:

| Question                                                           | How to settle it                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Are the current migrations applied to Production?                  | Historical evidence records v279, v280 and v286–v290 as applied. Before a change, take a fresh owner-run backup and inspect the resulting schema; `db push` output and an old dump are not proof. |
| Is `EMAIL_TRANSPORT` really smtp in Production?                    | Vercel secrets cannot be read back. Production once ran for weeks on `log` with every cron run returning 200.                                                                                     |
| Is `ATTACHMENT_ALLOWED_MIME` current?                              | Same: a stale list silently refuses HEIC and PowerPoint that the file chooser offers.                                                                                                             |
| Is `CRON_SECRET` set?                                              | Without it the endpoint returns 503 and no scheduled work runs at all.                                                                                                                            |
| Is a restore from the latest backup proven, into a scratch target? | Never into Production. `restore:verify` truncates before loading, so a failed run leaves the local database empty.                                                                                |
| Is an upload scanner hosted?                                       | Until `ESH_SCANNER_URL` is set every file stays `not_scanned`, and the application says so rather than implying it is clean.                                                                      |

## What nobody has decided

Carried forward unchanged, and none of it is mine to choose:

- The four public-QR calls: anonymous reporting and its notice;
  immediate-hazard routing in and out of hours and by what route; photograph
  originals, EXIF and retention; and whether a scanner is hosted or the pilot
  goes text-only.
- Who owns an unrouted report in Production.
- Pilot representatives and testers, the feedback owner, and a go/no-go date.

The hazard taxonomy is no longer an open decision for this delivery: the
approved lean package supplied the nine v287 categories. The administrator-role
split remains a separate governance decision, deferred by that package.

## The honest summary

The S2–S6 implementation is complete and the rollout switch is safe. What is
not ready for an agent to do is activation: present Production state, public
privacy/safety arrangements, queue ownership, pilot participants and a go/no-go
decision all belong to the owner. Until those decisions are explicitly made,
public QR, public uploads, emergency delivery, scanner hosting and rollout stay
disabled.
