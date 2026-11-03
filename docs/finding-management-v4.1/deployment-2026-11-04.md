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

## PASS — Step 5: the salt, and the name that had to change

`PUBLIC_REPORT_SALT` could not be stored as a secret at all: `PUBLIC_` is a
public framework prefix on Vercel, and the platform refuses — rightly, since
the name announces as public a value that is read on the server. Renamed to
`ESH_REPORT_SALT` (`57ae8b2`), set in Production, and a redeploy of the
current commit made it live. Nothing had the old name set in any environment,
so there was nothing to migrate.

## PASS — Step 6: the write half, done by the owner

| Check                                  | Evidence                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Classify a finding                     | F-005 saved as **Machinery and equipment**; "hazard classified" in its activity at 06:40                                               |
| The register follows                   | The row reads "Fabrication · High risk · Machinery and equipment", and `?hazard=machinery` returns exactly that finding                |
| Upload a photograph                    | `1761304409926.jpg` attached to a message, "JPG · 6 KB · **Not scanned**"                                                              |
| Email actually leaves                  | A reply to the owner recorded as **"Accepted by the mail server"** — which `EMAIL_TRANSPORT=log` cannot produce. The transport is smtp |
| Public reporting closed, fourth screen | The module's own Today page: "Public QR reporting is not enabled"                                                                      |

## The one check still open

**`/api/cron` returning 200.** It sends real notification email, so it is a
decision rather than a status check, and it was left for the owner:

```powershell
curl.exe -s -o - -w "`n%{http_code}`n" -H "Authorization: Bearer $env:CRON_SECRET" https://tamco-focus.vercel.app/api/cron
```

`CRON_SECRET` is set in Production, so a 503 would mean the variable is not
reaching the running deployment. Until it is run, nothing proves the scheduled
work — digests, follow-up reminders, the scan worker, the orphan sweep, the
mail retry — is executing in Production.

## The report

| Step                                 | Result                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| 1 — backup taken, restored, verified | **PASS** — 413 objects, 71 tables, byte for byte                                  |
| 2 — five migrations applied          | **PASS** — verified from the schema dump                                          |
| 3 — configuration                    | **PASS** — read from Vercel; `ESH_REPORT_SALT` was the only gap and is now closed |
| 4 — key rotated and live             | **PASS** — proven by a signed evidence download, not by the variable              |
| 5 — `ESH_REPORT_SALT`                | **PASS** — set, renamed to a name the platform will protect, redeployed           |
| 6 — smoke                            | **PASS on 8 of 9**; `/api/cron` not run                                           |
| 7 — this report                      | written                                                                           |

Public QR reporting: **CLOSED**, confirmed on four screens — the sticker page,
the administrator switch, the Patterns page and the module's own Today page.

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

## Where this leaves the pilot

Everything the deployment can be asked for has been asked and answered, with
one exception: **nothing has yet proved the scheduler runs in Production**. The
secret is set, but a set variable and a working endpoint are different facts —
which is the lesson this whole document keeps repeating.

Run the cron once, and this is a PASS across the board for a restricted,
staff-only deployment. The one-area pilot then needs the operational decisions
rather than any further engineering: who watches the queue, which area, which
date, and whether a scanner is hosted before photographs start arriving from
the floor.

Public QR reporting stays closed until an administrator opens it with a
reason, and nothing in this deployment moved it.
