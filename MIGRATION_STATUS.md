# Cloud migration — status

Last updated: 11 August 2026

`NOT_STARTED` · `IN_PROGRESS` · `BLOCKED_PENDING_CONFIGURATION` · `COMPLETE` · `VERIFIED`

A phase is `VERIFIED` only when something was run and passed, not when it was
written.

| Phase | Work                                    | Status                        | Evidence / what is missing                                                                                                                 |
| ----- | --------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | Audit                                   | VERIFIED                      | `CLOUD_MIGRATION_ASSESSMENT.md`, taken from the live local stack                                                                           |
| 2     | Repository and secret hygiene           | VERIFIED                      | Secret scan clean over 301 tracked files; full history scan found no credential-shaped addition; `.gitignore` and `.env.example` corrected |
| 3     | Migration reconciliation                | VERIFIED                      | `db:reset` rebuilds the database from migrations alone; `db:types:check` and `check:schema` pass                                           |
| 4     | Production data separation              | VERIFIED                      | `supabase/seeds/reference.sql` split out; development seed guarded in SQL and in the script layer; guard behaviour tested in four cases    |
| 5     | RLS / authorisation review              | IN_PROGRESS                   | `SECURITY_ACCEPTANCE_REPORT.md`. **One finding is a go-live blocker** — administrator carries business-manager authority                   |
| 6     | CI and local acceptance                 | COMPLETE                      | `.github/workflows/verify.yml`. Unverified until it runs on a real remote                                                                  |
| —     | Backup and restore                      | VERIFIED                      | Backup taken and restored into an emptied local database; all 31 populated tables came back complete, audit history included               |
| —     | Hosted scheduling                       | COMPLETE                      | `/api/cron` + `vercel.json`. Unverified until deployed                                                                                     |
| 7     | GitHub remote                           | BLOCKED_PENDING_CONFIGURATION | Awaiting owner approval for the first push, then a private repository                                                                      |
| 8     | Supabase Staging                        | BLOCKED_PENDING_CONFIGURATION | Project does not exist                                                                                                                     |
| 9     | Vercel Preview                          | BLOCKED_PENDING_CONFIGURATION | Hosting plan decision                                                                                                                      |
| 10    | Staging functional and security testing | NOT_STARTED                   | Needs Phases 8–9                                                                                                                           |
| 11    | Supabase Production                     | BLOCKED_PENDING_CONFIGURATION | Project does not exist                                                                                                                     |
| 12    | Production user setup                   | BLOCKED_PENDING_CONFIGURATION | Needs Phase 11 and the §0.5 approval                                                                                                       |
| 13    | Vercel Production                       | BLOCKED_PENDING_CONFIGURATION | Hosting plan decision                                                                                                                      |
| 14    | Production smoke and security testing   | NOT_STARTED                   | Needs Phase 13                                                                                                                             |
| 15    | Pilot go-live                           | NOT_STARTED                   | Needs Phase 14 and the Phase 5 blocker closed                                                                                              |
| 16    | Documentation finalisation              | IN_PROGRESS                   | Every required document exists; hosted sections fill in as phases complete                                                                 |

## What can proceed without any further input

Nothing. Every remaining phase needs either the hosting decision, an account, or
an approval. Phases 1–6 and the backup/scheduling work are done.

## What to do next, in order

1. Decide the hosting plan (`CLOUD_MIGRATION_ASSESSMENT.md`, finding 1).
2. Approve the first GitHub push, and create the private repository.
3. Close the Phase 5 blocker before any Production user exists.
4. Create the two Supabase projects and supply their settings.
