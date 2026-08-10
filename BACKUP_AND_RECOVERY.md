# Backup and recovery

Supabase's free plan has no scheduled backups and no point-in-time recovery. On
the pilot, backup is entirely our responsibility, and a backup nobody has
restored is a hope rather than a backup.

## Backup

```bash
npm run backup:database
```

Against a hosted project, supply that project's connection string for the one
command and declare the environment:

```bash
TAMCO_ENV=production SUPABASE_DB_URL='postgresql://…' npm run backup:database
```

Two files land in `../tamco-focus-backups/`, outside the repository so one can
never be committed:

| File           | Contents                                               |
| -------------- | ------------------------------------------------------ |
| `*-schema.sql` | Tables, functions, policies, triggers, views           |
| `*-data.sql`   | Every row, in dependency order, including `auth.users` |

`supabase/migrations` remains authoritative for schema; the schema dump is a
convenience for reading, not the rebuild path.

### Why not the data API

The first implementation read rows through PostgREST and could not work.
`audit_events` revokes INSERT from every role because history is append-only, so
that backup would have silently dropped the audit trail on restore. The fix was
to use a mechanism that can carry it, not to weaken the table.

### What is not in the backup

**Storage objects.** Attachments live in the `task-attachments` bucket and are
not copied by `db dump`. The database rows that describe them _are_ backed up,
so a restore knows exactly which files are missing. For the pilot, attachment
volume is small; if that changes, add a bucket sync before this becomes the gap
that matters.

## Restore

```bash
npm run restore:verify              # newest backup
npm run restore:verify -- path.sql  # a specific one
```

Local only. `assertLocal` refuses Staging as well as Production: a restore
overwrites, and Staging may be mid-verification for somebody else.

The script does the whole loop, because no step alone proves anything:

1. count every table — what should come back
2. empty every application table, plus `auth.users`, `storage.objects` and
   `storage.buckets` — a real restore target
3. confirm it is empty — the emptying actually happened
4. load the data dump
5. count again and compare — the proof

Emptying runs as `postgres` inside the database container rather than through
the data API, because `audit_events` revokes DELETE from every role. TRUNCATE by
the owner is not blocked by those grants and does not fire the immutability
trigger.

## Proven, 11 August 2026

Local backup taken, local database emptied to zero rows across 51 tables, dump
reloaded. All 31 populated tables returned their full row counts — `tasks` 28,
`task_checklist_items` 46, `audit_events` 26, `org_settings` 21, `goals` 4, and
the rest. Verified by the script's own comparison, which exits non-zero if any
table comes back short.

Three defects were found and fixed by running it rather than assuming it:
restoring onto a seeded database collided on unique constraints; `auth.users`
and `storage.buckets` were not being emptied, so identities and the bucket row
collided; and `RESTART IDENTITY` failed because the auth sequences belong to
`supabase_auth_admin`.

## Recovering Production

1. **Do not** reverse migrations. Prefer a forward fix.
2. If data must be restored, take a fresh backup of the damaged state first —
   the damaged state is still evidence.
3. Restore into local and confirm the data is what you expect.
4. Only then plan the Production write, and treat it as a §0.4 destructive
   change requiring explicit approval.

## Cadence

Free-plan Production has no automatic protection, so:

- before any Production migration — always
- before any destructive Production change — always
- weekly during the pilot — a calendar reminder, until this is automated
- a restore proof monthly, into local

Backups accumulate in `../tamco-focus-backups/`. Nothing prunes them; the folder
is small and losing an old backup costs more than storing it.
