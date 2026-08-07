# Local operations

## First setup

Use PowerShell on Windows:

```powershell
npm.cmd install
npm.cmd run supabase:start
powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1
npm.cmd run db:reset
npm.cmd run dev
```

Use `scripts/setup-local.sh` on Unix-like systems. Both populate `.env.local` from the local stack; the populated file is ignored by Git.

Seeded accounts use the local password in `SEED_USER_PASSWORD`. Public signup remains closed; administrators create accounts from More → Users.

## Routine operations

```powershell
npm.cmd run supabase:status
npm.cmd run worker:routines
npm.cmd run worker:weekly
npm.cmd run worker:tick
```

Run `worker:tick` at least daily through Windows Task Scheduler or an equivalent local scheduler. The routine procedure and email period key are idempotent, so additional invocations are safe. Weekly delivery occurs only after the configured local day and hour; `npm.cmd run worker:weekly -- --force` is for local verification.

## Database changes

Add a forward-only timestamped migration, then run:

```powershell
npm.cmd run db:reset
npm.cmd run db:types
npm.cmd run db:types:check
```

Never edit generated types by hand. Never link this stage to hosted Supabase.

## Verification and production-mode smoke

```powershell
npm.cmd run preflight
npm.cmd run verify
$env:NEXT_DIST_DIR='.next-smoke'
npm.cmd run build
npm.cmd run start
```

Open `http://localhost:3000/sign-in`, sign in, and verify Today, Work, Plan, Team where authorised, More, an attachment, and a task update. Stop the foreground server with Ctrl+C. The acceptance command is `npm run verify`; it must report zero failed and zero skipped gates.

## Recovery

- If the stack is unavailable, start Docker Desktop and run `npm.cmd run supabase:start`.
- If migrations drift, run `npm.cmd run db:reset`; local fixture data is intentionally recreated.
- If an email delivery fails, retain its `failed` row. A later worker run retries after `next_retry_at` with bounded backoff.
- If a user has retained history, deactivate rather than trying to remove records.
