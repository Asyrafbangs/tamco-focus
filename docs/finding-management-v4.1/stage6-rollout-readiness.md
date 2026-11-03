# Stage 6 — pilot and rollout readiness

Stage 6 is the only stage whose work is a decision rather than a change. Nothing
here deploys anything, opens the rollout or touches Production: those are gated
on explicit human approval, and an agent in this environment cannot read
Production at all.

What this document does is separate three things that get confused when
somebody asks "are we ready?": what has been **proven**, what only the account
owner can **establish**, and what nobody has **decided**.

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

## One blocker, verified rather than quoted

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

This matters for Stage 6 specifically because the rollout gate and the System
Admin account arrive together: the account that opens the rollout is the account
that would hold this authority.

**Not fixed here, deliberately.** Splitting the role is a policy decision with
several valid shapes — a System Admin with no business authority, an
administrator who may read but not agree, or an explicit break-glass that is
audited — and inventing one is exactly what this project's rules forbid. It
needs a decision, then a migration, then its own stage.

## What only the account owner can establish

None of these can be read from this environment, and no repository file is
evidence of them:

| Question                                                           | How to settle it                                                                                                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Are v272–v281 applied to Production?                               | `npm run backup:database` with `TAMCO_ENV=production` set **in the shell**, then grep the resulting `*-schema.sql`. Take a fresh dump: `db push` reporting "up to date" and an hour-old dump have both misled before. |
| Is `EMAIL_TRANSPORT` really smtp in Production?                    | Vercel secrets cannot be read back. Production once ran for weeks on `log` with every cron run returning 200.                                                                                                         |
| Is `ATTACHMENT_ALLOWED_MIME` current?                              | Same: a stale list silently refuses HEIC and PowerPoint that the file chooser offers.                                                                                                                                 |
| Is `CRON_SECRET` set?                                              | Without it the endpoint returns 503 and no scheduled work runs at all.                                                                                                                                                |
| Is a restore from the latest backup proven, into a scratch target? | Never into Production. `restore:verify` truncates before loading, so a failed run leaves the local database empty.                                                                                                    |
| Is an upload scanner hosted?                                       | Until `ESH_SCANNER_URL` is set every file stays `not_scanned`, and the application says so rather than implying it is clean.                                                                                          |

## What nobody has decided

Carried forward unchanged, and none of it is mine to choose:

- The four public-QR calls: anonymous reporting and its notice;
  immediate-hazard routing in and out of hours and by what route; photograph
  originals, EXIF and retention; and whether a scanner is hosted or the pilot
  goes text-only.
- The hazard taxonomy, which blocks S3b and any grouping of patterns by
  category.
- Who owns an unrouted report in Production.
- Pilot representatives and testers, the feedback owner, and a go/no-go date.
- The administrator role split above.

## The honest summary

The private staff workflow is built and gated. The rollout switch is safe, and
a restricted-mode pilot is technically ready. What is not ready is everything
that depends on a decision or on Production state nobody in this session can
see — and the administrator-authority blocker should be closed before an account
exists that would hold it.
