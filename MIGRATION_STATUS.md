# Cloud migration — status

Last updated: 11 August 2026

`NOT_STARTED` · `IN_PROGRESS` · `BLOCKED_PENDING_CONFIGURATION` · `COMPLETE` · `VERIFIED`

A phase is `VERIFIED` only when something was run and passed, not when it was
written.

| Phase | Work                                    | Status                        | Evidence / what is missing                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----- | --------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Audit                                   | VERIFIED                      | `CLOUD_MIGRATION_ASSESSMENT.md`, taken from the live local stack                                                                                                                                                                                                                                                                                                                                                                         |
| 2     | Repository and secret hygiene           | VERIFIED                      | Secret scan clean over 301 tracked files; full history scan found no credential-shaped addition; `.gitignore` and `.env.example` corrected                                                                                                                                                                                                                                                                                               |
| 3     | Migration reconciliation                | VERIFIED                      | `db:reset` rebuilds the database from migrations alone; `db:types:check` and `check:schema` pass                                                                                                                                                                                                                                                                                                                                         |
| 4     | Production data separation              | VERIFIED                      | `supabase/seeds/reference.sql` split out; development seed guarded in SQL and in the script layer; guard behaviour tested in four cases                                                                                                                                                                                                                                                                                                  |
| 5     | RLS / authorisation review              | VERIFIED                      | `SECURITY_ACCEPTANCE_REPORT.md`. The administrator/manager blocker is closed on Local and Production, with `admin-authority-v54.test.ts` proving both the refusals and the retained powers                                                                                                                                                                                                                                               |
| 6     | CI and local acceptance                 | COMPLETE                      | `.github/workflows/verify.yml`. Unverified until it runs on a real remote                                                                                                                                                                                                                                                                                                                                                                |
| —     | Backup and restore                      | VERIFIED                      | Backup taken and restored into an emptied local database; all 31 populated tables came back complete, audit history included                                                                                                                                                                                                                                                                                                             |
| —     | Hosted scheduling                       | COMPLETE                      | `/api/cron` + `vercel.json`. Unverified until deployed                                                                                                                                                                                                                                                                                                                                                                                   |
| 7     | GitHub remote                           | VERIFIED                      | `Asyrafbangs/tamco-focus`, **Private**, `main` at `e22c0df`, 408 files. Verified after the push: only `.env.example` is tracked, no `.env.local`, no dumps, no vendored skill packages                                                                                                                                                                                                                                                   |
| 8     | Supabase Staging                        | BLOCKED_PENDING_CONFIGURATION | Project does not exist                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 9     | Vercel Preview                          | COMPLETE                      | Deploys from feature branches. Unverified against Staging, which does not exist                                                                                                                                                                                                                                                                                                                                                          |
| 10    | Staging functional and security testing | NOT_STARTED                   | Needs Phases 8–9                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 11    | Supabase Production                     | VERIFIED                      | `tamco-focus-production`, ref `ypxbykvyjjtroyftzemi`, **ap-southeast-1 (Singapore)**, TAMCO's Org, Free plan. 78 migrations applied; 51 tables, **0 without RLS**, 83 policies, 64 RPCs, 85 `focus` helpers, 12 views, 1 private bucket. Reference departments applied. Verified empty: 0 users, 0 auth users, 0 tasks, 0 goals, 0 barriers, 0 notifications, 0 audit events. Retired procedures confirmed absent. Baseline backup taken |
| 12    | Production user setup                   | BLOCKED_PENDING_CONFIGURATION | Needs Phase 11 and the §0.5 approval                                                                                                                                                                                                                                                                                                                                                                                                     |
| 13    | Vercel Production                       | VERIFIED                      | Live at `tamco-focus.vercel.app`, deploying from `main`. Functions pinned to `sin1` so they sit beside the Singapore database rather than defaulting to `iad1` — see below                                                                                                                                                                                                                                                               |
| 14    | Production smoke and security testing   | NOT_STARTED                   | Needs Phase 13                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 15    | Pilot go-live                           | NOT_STARTED                   | Needs Phase 14 and the Phase 5 blocker closed                                                                                                                                                                                                                                                                                                                                                                                            |
| 16    | Documentation finalisation              | IN_PROGRESS                   | Every required document exists; hosted sections fill in as phases complete                                                                                                                                                                                                                                                                                                                                                               |

## Function region

`vercel.json` pins functions to `sin1`. Without it Vercel defaults to `iad1`
(Washington DC) while the database is `ap-southeast-1` (Singapore), so every
query crossed the Pacific — roughly 220ms each, ten or more times per page.
That is invisible locally, where the app and the database share a machine, and
it was the reported cause of sluggish navigation in Production.

`sin1` is also the closest region to the pilot users in Malaysia, so it is the
right answer for both legs rather than a trade between them. If the database is
ever moved, this must move with it; the two belong together.

## Where this stands

GitHub and Supabase Production are live. No user account exists yet, and that is
the next gate rather than the next task.

Staging is not hosted: TAMCO's Org has two free project slots and one is taken by
an unrelated project, so the single remaining slot went to Production. Local
Supabase is the test environment, which is §8's own fallback and keeps the rule
that matters — Preview never touches Production.

## What to do next, in order

1. **Close the Phase 5 blocker.** The `administrator` role still carries
   business-manager authority. It must be split before a real System Admin
   account exists, or the first administrator can agree and cancel employees'
   Goals.
2. Decide the hosting plan, which gates Vercel (Phases 9 and 13).
3. Then the §0.5 user-onboarding gate: six operational users plus the System
   Admin (`izzulasyraf1@gmail.com`).
