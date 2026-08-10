# Deployment — required inputs

What this migration still needs from the owner, and what each thing unblocks.

**No secret values belong in this file.** It records what is needed and where it
goes, never the value itself.

Statuses: `NOT_REQUIRED` · `PENDING` · `CONFIGURED` · `VERIFIED`

---

## Decisions

| Input                             | Purpose                                                           | Where it is set | Blocks                       | Status  |
| --------------------------------- | ----------------------------------------------------------------- | --------------- | ---------------------------- | ------- |
| **Hosting plan decision**         | Vercel Hobby forbids commercial use; this pilot is a company tool | Owner decision  | Phases 9, 13–15              | PENDING |
| **System Administrator identity** | Display name, company email, intended scope                       | Owner decision  | Admin account creation (§18) | PENDING |
| **Manager/Admin overlap**         | Whether Izzul also holds System Admin, or a separate person does  | Owner decision  | Production user setup        | PENDING |

The hosting decision is the one that gates go-live. Options are set out in
`CLOUD_MIGRATION_ASSESSMENT.md`; nothing else in this migration depends on which
is chosen, so everything else proceeds meanwhile.

---

## Accounts and authorisations

| Input                                       | Purpose                        | Where it is set           | Blocks           | Status  |
| ------------------------------------------- | ------------------------------ | ------------------------- | ---------------- | ------- |
| GitHub account + private repo               | Remote for the codebase        | `git remote add origin …` | Phase 7 onward   | PENDING |
| Supabase organisation access                | Creating the two projects      | supabase.com              | Phases 8, 11     | PENDING |
| `tamco-focus-staging` project               | Preview database               | Supabase dashboard        | Phases 8–10      | PENDING |
| `tamco-focus-production` project, Singapore | Production database            | Supabase dashboard        | Phases 11–15     | PENDING |
| Vercel account + project                    | Hosting                        | vercel.com                | Phases 9, 13     | PENDING |
| SMTP provider                               | Password reset and invitations | Supabase Auth → SMTP      | Account recovery | PENDING |

---

## Environment variables, per environment

Names only. Values go into the platform's own secret store, never here and never
into Git.

| Variable                        | Local               | Staging (Vercel Preview) | Production         | Notes                                         |
| ------------------------------- | ------------------- | ------------------------ | ------------------ | --------------------------------------------- |
| `TAMCO_ENV`                     | `local`             | `staging`                | `production`       | Must match the Supabase URL or scripts refuse |
| `NEXT_PUBLIC_SUPABASE_URL`      | loopback            | Staging project          | Production project | Browser-visible                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | local key           | Staging key              | Production key     | Browser-visible; constrained by RLS           |
| `SUPABASE_SERVICE_ROLE_KEY`     | local key           | Staging key              | Production key     | **Server only.** Never `NEXT_PUBLIC_`         |
| `CRON_SECRET`                   | —                   | generate                 | generate           | Distinct per environment                      |
| `APP_BASE_URL`                  | localhost           | Preview URL              | Production URL     | Absolute links in email                       |
| `ORG_TIMEZONE`                  | `Asia/Kuala_Lumpur` | same                     | same               |                                               |
| `EMAIL_TRANSPORT`               | `log`               | `log`                    | `log` until SMTP   | Honest default; nothing is faked              |
| `SEED_USER_PASSWORD`            | generated           | generated                | **never set**      | Fixture accounts only                         |
| `SUPABASE_DB_URL`               | optional            | for backups              | for backups        | Pass per command; never store                 |

**Production values must never be inherited by Preview.** In Vercel, set each
variable with the environment checkbox for that environment only.

---

## Supabase Auth settings, per hosted project

| Setting                  | Value                                            |
| ------------------------ | ------------------------------------------------ |
| Site URL                 | The environment's own URL. **Never localhost.**  |
| Additional redirect URLs | `<site>/auth/callback`                           |
| Enable signup            | **Off.** Administrators provision every account. |
| Anonymous sign-ins       | Off                                              |
| Email confirmations      | On for hosted (off locally so tests can sign in) |
| Refresh token rotation   | On                                               |

---

## Vercel Cron

`vercel.json` declares one daily job against `/api/cron`. It must be able to
present `Authorization: Bearer $CRON_SECRET`; Vercel does this automatically
from the project's `CRON_SECRET` variable. Without it the endpoint returns 503
and logs that it is unconfigured — it does not run unauthenticated.
