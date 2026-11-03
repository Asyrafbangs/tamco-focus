# Deployment record — 4 November 2026

The state of the production readiness work, as evidenced rather than as
intended. Steps are the ones in `production-readiness-runbook.md`.

Everything marked PASS below was verified by the account owner running a
command on their own machine, or by me reading the resulting local backup
artefacts. Nothing in this session reached Production directly; that boundary
held throughout, and three attempts to cross it were refused by the permission
classifier.

## PASS — Step 1: backup, restored and verified

|                         |                                                                       |
| ----------------------- | --------------------------------------------------------------------- |
| Run                     | `tamco-focus-production-2026-11-03T16-33-32-380Z-5a8322`              |
| Private storage objects | **413**, each read back matching the manifest's byte size and SHA-256 |
| Database restore        | **71 tables**, loaded into local with no errors, 8 identities         |

The first proven, restorable production backup this project has taken against
the current schema. Notable row counts, as a picture of what Production holds:
295 tasks, 2,313 audit events, 760 notifications, 407 attachments, 6 ESH
findings with 9 evidence assets, 12 goals, 8 user profiles.

Two obstacles were real and are recorded so the next run does not meet them:

- **The direct database host would not answer.** `db dump --linked` hung
  without output; the session pooler
  (`aws-0-ap-southeast-1.pooler.supabase.com:5432`) worked immediately. Newer
  projects answer IPv6 only on `db.<ref>.supabase.co`, and this network is
  IPv4. The pooler is this project's route, not a fallback.
- **The storage half failed once with no cause given.** The local stack answers
  `database error, code: 42P10` after a bulk object load; a clean
  `npx supabase stop --no-backup` and `start` cleared it, and the retry
  verified all 413 objects. The error is now reported rather than swallowed.

## PASS — Step 2: five migrations applied

v279, v280, v286, v287 and v288 are all present in Production. They were
applied at **2026-11-03 14:51 UTC**, about 100 minutes before the backup was
taken — the reverse of the runbook's order, which exists precisely to avoid
that. Benign in this case: every one of the five only adds objects, and the
backup that now exists was taken after them, so it is a valid recovery point
for the schema that is actually live.

Verified by grepping the fresh schema dump, which is the only way to answer
this question honestly — `db push` reporting "up to date" has misled twice
before:

| Check                                                                                                                              | Result                                     |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `security_invoker='true'` on `esh_register_rows`, `esh_action_register_rows`, `esh_finding_connections`, `esh_hazard_distribution` | PASS — the `drop view` trap did not happen |
| The three hazard columns reached both register views                                                                               | PASS                                       |
| Nine hazard categories seeded, `other` last                                                                                        | PASS                                       |
| `esh_qr_intake_settings`: one row, `enabled = false`                                                                               | PASS — **public reporting is closed**      |
| v272's `check (enabled = false)` removed, so the switch can be moved                                                               | PASS                                       |
| `esh_public_report_submit` granted to `service_role` only                                                                          | PASS                                       |
| Nothing granted to `anon`: not the submit function, not the photos table                                                           | PASS                                       |

## PENDING — Steps 3 to 7

None of these can be closed from a session that cannot reach Production.

| Step                     | What it needs                                                      |
| ------------------------ | ------------------------------------------------------------------ |
| 3 — configuration        | `npm run check:deployment` against Production, and its output read |
| 4 — key rotation         | The Supabase dashboard, the Vercel variable, **and a redeploy**    |
| 5 — `PUBLIC_REPORT_SALT` | Generated locally, set in Vercel, redeployed                       |
| 6 — smoke test           | Nine checks, signed in to the deployed site                        |
| 7 — report               | Assembled from 3 to 6                                              |

### The one thing that is time-sensitive

The service-role key powers **evidence uploads and downloads, the ESH owner
email-link sessions, outgoing notification email, the cron workers and the
settings writes**. The browser's own session uses the anon key instead, so
signing in and reading pages survives a service-role change; the five things
above do not.

So if the key has been rotated in Supabase and Vercel has not been updated
**and redeployed**, those five are broken in Production right now, silently —
a cron run returns 500, an owner's email link stops working, an evidence
upload fails. If the project's JWT secret was reset rather than the single
key, the anon key changes too and the whole site is down until Vercel is
updated.

That is why step 4 ends with proving which key is live: `check:deployment`
prints the key's issued date, and a Vercel secret cannot be read back.

## Outstanding risks

Unchanged from `stageD-readiness-and-rollout.md`, with one addition:

1. **The old key's exposure window is unaudited.** Rotation closes the future,
   not the past; `esh_audit_events` records application actions, not
   service-role reads.
2. **Migrations preceded the verified backup.** Mitigated, not undone: the
   five are additive and the backup is newer than they are.
3. Compression has never been measured against a real photograph.
4. The 30–60 second form target is untimed.
5. No scanner is hosted, so every file reads "Not scanned" — honest, and the
   signature, dimension and rebuild checks are what actually protect the
   bucket.
6. Email is proven only by a smoke test; there is no synthetic monitor on
   delivery.
7. The administrator role still carries business-manager authority, deferred
   by the package's own instruction.

## Not production-ready yet

Steps 1 and 2 are done and evidenced. Until 3 to 6 are, this deployment is
unverified in the places that have misled before: the mail transport, the cron
secret, and which key the running application is actually using. Public QR
reporting is closed and stays closed.
