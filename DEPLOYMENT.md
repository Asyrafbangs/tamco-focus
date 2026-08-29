# Deployment

How TAMCO Focus goes from a branch to the people using it.

Related: `MIGRATION_STATUS.md` (where we are), `DEPLOYMENT_REQUIRED_INPUTS.md`
(what is still needed), `ROLLBACK.md` (when it goes wrong).

## Environments

| Environment | Application       | Database                 | Who sees it         |
| ----------- | ----------------- | ------------------------ | ------------------- |
| Local       | `npm run dev`     | Local Supabase in Docker | The developer       |
| Staging     | Vercel Preview    | `tamco-focus-staging`    | Whoever has the URL |
| Production  | Vercel Production | `tamco-focus-production` | The pilot team      |

**Preview never connects to Production.** In Vercel, every variable is set for
one environment only; nothing is left to inheritance. `TAMCO_ENV` states which
environment a process believes it is in, and every destructive script refuses
when that declaration and the Supabase URL disagree.

## Branches

```
feature/… or fix/… or chore/…
      ↓  push
   CI: format, lint, types, unit, SQL, migrations, RLS, integration, build
      ↓  green
   Vercel Preview → Supabase Staging → verify by hand
      ↓  merge
   main → Vercel Production → Supabase Production
```

`main` is Production. Do not push to it directly.

GitHub Free does not offer branch protection on private repositories, so that
last sentence is a rule rather than a mechanism. CI still runs on `main`, and
the end-to-end job runs there specifically because it is the last chance.

## Releasing a database change

1. Write a **forward** migration. Never edit one that has been applied.
2. `npm run db:reset` locally — it rebuilds from migrations alone, so if the
   change is not in a migration it does not exist.
3. `npm run verify` — all 16 gates.
4. Push; CI applies the migrations to a fresh Postgres and runs RLS and
   integration against them.
5. Apply to Staging: `supabase db push` against the Staging project. Verify.
6. Merge to `main`.
7. **Back up Production** (`npm run backup:database`), then apply to Production.
8. Deploy the application.

Database before application, so the application never runs against a schema
that lacks what it expects.

A migration that drops, truncates or rewrites data is a §0.4 destructive change:
explicit approval, every time, no matter how routine it looks.

## First Production cutover

In order, stopping at each approval gate:

1. Create `tamco-focus-production` in Singapore.
2. Configure Auth: site URL, redirect URLs, signup **off**, confirmations on.
3. Apply migrations. Confirm the schema matches.
4. Apply `supabase/seeds/reference.sql`. Nothing else.
5. Confirm the development seed cannot run — it refuses in two independent
   places, and both should be seen refusing.
6. Set environment variables in Vercel for Production only.
7. Take a baseline backup and restore it locally. A backup nobody has restored
   is not a backup.
8. Deploy.
9. Verify the database is clean: no tasks, no goals, no barriers, no
   notifications, no fixtures.
10. **Approval gate.** Then create the six approved users.
11. Smoke test, then the go-live decision.
12. Switch off the development PC and confirm the site still works. This is the
    test that says Production is genuinely independent.

## Scheduled work

`/api/cron` runs the routine generator and the weekly summary. It is declared in
`vercel.json` as one daily job, and requires `Authorization: Bearer $CRON_SECRET`
— an unauthenticated caller gets 401, and a misconfigured deployment gets 503
rather than running unprotected.

One endpoint rather than two because free scheduling is measured in jobs per
day, and the weekly worker already decides for itself whether today is its day.

Routine generation is idempotent per date, so a missed day catches up and a
double run is harmless.

## Mail credentials

Two things send mail, and they hold their credentials in different places.
Knowing which is which is the difference between rotating one secret and
hunting for three.

| What sends it    | Where the credential lives                         | Used for                        |
| ---------------- | -------------------------------------------------- | ------------------------------- |
| Supabase Auth    | Supabase → Authentication → Emails → SMTP Settings | Password resets, invites        |
| This application | Vercel → Environment Variables, Production only    | Weekly summaries, notifications |

**Never both.** A credential in two places is two things to rotate and twice the
chance one is forgotten.

### Adding an application mail credential

`EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`,
`EMAIL_FROM`. Set `EMAIL_TRANSPORT=smtp` last: the transport refuses to start
when it is set without the rest, rather than falling back to the log transport
and reporting success while discarding mail.

```bash
vercel env add EMAIL_SMTP_PASSWORD production
```

Three rules, and they are not stylistic:

- **Production scope only.** A variable added to Preview is handed to every
  branch deployment, and preview URLs are guessable.
- **Sensitive/Secret type**, so it cannot be read back afterwards - only
  overwritten. Every variable on this project is already Secret; keep it that
  way.
- **Never `NEXT_PUBLIC_`.** That prefix ships the value to the browser.

`vercel env pull` writes real values to a local file. Use it sparingly and
delete the file afterwards.

### Company mail (Microsoft 365 / Outlook)

Ask for a credential that can only send, from one mailbox:

1. **Microsoft Graph `Mail.Send`, application permission, scoped with
   `New-ApplicationAccessPolicy` to a single mailbox.** The policy is the part
   that matters - `Mail.Send` on its own permits sending as anybody in the
   tenant. Microsoft has been retiring basic-auth SMTP AUTH in Exchange Online,
   so this is also the option that keeps working.
2. **A dedicated no-reply service mailbox** with SMTP AUTH. A leak then costs
   one sending mailbox rather than somebody's inbox.
3. A person's mailbox credential. Only if the first two are refused, and only
   with a rotation route that takes minutes rather than days.

Before accepting any of them, ask how to rotate it. If the answer is a
multi-day ticket, that is an argument for option 1 or 2, not a detail.

### If one leaks

Rotate first, investigate second - a credential in a commit is in every clone,
so removing the commit does not un-leak it. `email_deliveries` records every
send this application makes, and an unusual volume is what a stolen relay
credential looks like from the inside.

## After go-live

```
Claude/Codex → branch → local test → push → CI → Preview → verify → main → Production
```

Never: an AI agent writing to Production. Never: Preview against the Production
database. Never: a development seed anywhere but Local or Staging.
