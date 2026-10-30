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

Three files land in `../tamco-focus-backups/`, outside the repository so one can
never be committed:

| File            | Contents                                                           |
| --------------- | ------------------------------------------------------------------ |
| `*-schema.sql`  | Tables, functions, policies, triggers, views                       |
| `*-data.sql`    | Every row of `auth` and `public` — this is the file that is proven |
| `*-storage.sql` | The `storage` schema's own rows, kept apart on purpose             |

`supabase/migrations` remains authoritative for schema; the schema dump is a
convenience for reading, not the rebuild path.

### Why not the data API

The first implementation read rows through PostgREST and could not work.
`audit_events` revokes INSERT from every role because history is append-only, so
that backup would have silently dropped the audit trail on restore. The fix was
to use a mechanism that can carry it, not to weaken the table.

### Why `storage` is a separate file

Supabase owns that schema, and a hosted project runs a newer Storage than the
local CLI bundles. On 30 October 2026 production's `storage.buckets` carried
three columns the local stack had never heard of (`versioning_status` and two
`lifecycle_configuration` columns), so one INSERT in the middle of a single
combined dump failed under `ON_ERROR_STOP` and took the entire restore proof
down with it:

```
ERROR:  column "versioning_status" of relation "buckets" does not exist
Error: The data dump did not load. RESTORE NOT PROVEN.
```

Nothing was wrong with the data. A backup was reported unprovable because of a
version skew in a schema we do not own and do not need to restore — which is the
worst possible moment to discover a proof loop is brittle. It is now split, so a
skew there cannot stop us proving the data that is ours.

### What is not in the backup

**The files themselves.** Evidence photographs and attachments live in the
`finding-evidence` and `task-attachments` buckets and are not copied by
`db dump`. `storage.objects` is a row per file, not the file — which is why
those rows are kept out of the proven dump and out of the restore: putting them
back would produce a database that claims evidence it does not have.

This is the real gap, and v271 makes it sharper rather than smaller: the whole
point of preserving a full-size original is that somebody can produce it years
later, and right now losing the project would lose every photograph while the
rows naming them came back intact. A bucket sync is the fix. Until there is one,
the honest statement is that the **database** is backed up and the **evidence is
not**.

## Restore

```bash
npm run restore:verify              # newest backup
npm run restore:verify -- path.sql  # a specific one
```

Local only. `assertLocal` refuses Staging as well as Production: a restore
overwrites, and Staging may be mid-verification for somebody else.

The script does the whole loop, because no step alone proves anything:

1. count every table — what should come back
2. empty every application table, plus `auth.users` — a real restore target.
   `storage` is left alone, for the reasons above
3. confirm it is empty — the emptying actually happened
4. load the data dump
5. count again and compare — the proof

Emptying runs as `postgres` inside the database container rather than through
the data API, because `audit_events` revokes DELETE from every role. TRUNCATE by
the owner is not blocked by those grants and does not fire the immutability
trigger.

## Proven again, 30 October 2026

The split above was found by running the loop against Production rather than
assuming it. Re-proved afterwards: all 40 populated tables returned their full
row counts, and the script now says in as many words what it has and has not
proved.

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
