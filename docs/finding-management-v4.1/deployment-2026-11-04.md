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

## PASS — Step 4: the rotated key is live

Verified in the Vercel dashboard and then against the running site:

|                             |                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_SERVICE_ROLE_KEY` | updated in Production, and the Production deployment was **redeployed after** the update                                                                                             |
| Proof it is the live one    | `/findings/files/<asset>` signed a URL and served the real 960x1280 photograph. That route builds a service-role client and calls `createSignedUrl`; with a stale key it returns 404 |

The variable alone proves nothing — Vercel injects at build and boot — so the
ordering is what matters: key updated, then redeployed, then the signed
download works.

## Production configuration, read from Vercel

Present for Production: `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `TAMCO_ENV`, `APP_BASE_URL`, `CRON_SECRET`,
`EMAIL_FROM`, `EMAIL_TRANSPORT`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_USER`,
`EMAIL_SMTP_PASSWORD`, `EMAIL_SMTP_PORT`, `ORG_TIMEZONE`,
`WEEKLY_SUMMARY_DAY`, `WEEKLY_SUMMARY_HOUR`, `ATTACHMENT_MAX_BYTES`,
`ATTACHMENT_SIGNED_URL_TTL_SECONDS`, `ATTACHMENT_VIRUS_SCAN_ENABLED`.

Absent, each deliberately or still to do:

- **`ESH_REPORT_SALT` — missing.** The only configuration item still
  outstanding. Rate-limit buckets fall back to a constant salt until it is set.
- `ESH_SCANNER_URL` / `ESH_SCANNER_TOKEN` — no scanner is hosted, which is why
  every file reads "Not scanned".
- `ATTACHMENT_ALLOWED_MIME` — unset, so the built-in list applies.

`EMAIL_TRANSPORT`'s **value** was not read: the dashboard hides it and
revealing a stored value is not something to do casually. Sending one real
email proves it better than reading it, and that is the check still open.

## PASS — Step 6: the read-only half, against the live site

Done in the owner's own browser, signed in as them. Nothing was written, sent
or deleted.

| Check                                                                                  | Result                                                           |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Public dashboard renders real figures (`/safety-performance`)                          | PASS — 6 findings recorded, 1 open, 1 closed                     |
| Register renders with the Hazard filter and all nine categories plus "Not categorised" | PASS — the view v287 replaced still serves all 6 findings        |
| A finding's page shows **"What kind of hazard"** outside the folded full record        | PASS — chooser and Save present on F-005                         |
| Evidence label                                                                         | PASS — "JPEG · 271 KB · **Not scanned**", never "Clean"          |
| Evidence download through the signed route                                             | PASS — the photograph served                                     |
| Patterns distribution                                                                  | PASS — renders, and says "1 open finding is not categorised yet" |
| `/report/<code>` without signing in                                                    | PASS — "this link does not report anything", no form             |
| Administrator screen                                                                   | PASS — **Public QR reporting: Closed**                           |

## PENDING — what still needs a person

Four of these write or send, which is why they were not done for you:

1. **`ESH_REPORT_SALT`** in Vercel, then redeploy. A secret has to be typed
   by its owner.
2. **Classify one finding** and save, to prove the write path end to end.
3. **Upload one photograph** to a finding's action.
4. **Receive one email** — the only honest proof that `EMAIL_TRANSPORT` is
   `smtp` rather than `log`.
5. **`/api/cron` returns 200** with the current secret. It sends real mail, so
   it is a decision rather than a check.

## PENDING — Steps 3 to 7

None of these can be closed from a session that cannot reach Production.

| Step                  | What it needs                                                      |
| --------------------- | ------------------------------------------------------------------ |
| 3 — configuration     | `npm run check:deployment` against Production, and its output read |
| 4 — key rotation      | The Supabase dashboard, the Vercel variable, **and a redeploy**    |
| 5 — `ESH_REPORT_SALT` | Generated locally, set in Vercel, redeployed                       |
| 6 — smoke test        | Nine checks, signed in to the deployed site                        |
| 7 — report            | Assembled from 3 to 6                                              |

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
