# Backup and recovery

Supabase's free plan has no scheduled backups and no point-in-time recovery. On
the pilot, backup is entirely our responsibility, and a backup nobody has
restored is a hope rather than a backup.

## Backup

```bash
npm run backup:database
```

For the user-run hosted backup, configure the matching Supabase URL and service
role key in the local environment without committing or sharing them. Then run
from PowerShell in this repository:

```powershell
$env:TAMCO_ENV = 'production'
npm run backup:database
```

The linked project's database is used by default. `SUPABASE_DB_URL` is an
optional connection route for an unlinked project; avoid putting a password in
shell history. Set `TAMCO_ENV` in the shell because Node's `--env-file` does not
override an existing variable. The agent cannot run or inspect Production
directly; the operator must run this step, then make the resulting local backup
artifacts available for review without pasting secrets or evidence into chat.

Each successful run creates a dated directory in `../tamco-focus-backups/`,
outside the repository. An unfinished run retains `.incomplete` in its name and
must never be treated as a backup. The directory contains:

| File                    | Contents                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `*-schema.sql`          | Tables, functions, policies, triggers, views                                                                                             |
| `*-data.sql`            | Every row of `auth` and `public` — this is the file that is proven                                                                       |
| `*-storage.sql`         | The `storage` schema's own rows, kept apart on purpose                                                                                   |
| `storage-manifest.json` | Exact bucket and object key, downloaded byte size, SHA-256, content type and source metadata for every private object                    |
| `objects/`              | The actual bytes from `task-attachments` and `finding-evidence`, in separate bucket trees with nested key segments hashed safely on disk |

The command requires the matching Supabase URL and service role key in its
environment. For a hosted run, set `TAMCO_ENV=production` in the shell; the URL
must name that project and, when using the linked database, must match its
project reference. Keep the service role key out of command history, logs and
the repository. The backup directory must resolve outside the repository. The
backup refuses a public/missing bucket, unsafe key, listing error, failed
download or changed bucket inventory. It writes the manifest only after all
bytes arrive and renames the run directory only after every step succeeds. It
does not remove earlier backups.

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

The run covers the database and the actual bytes in the two named private
buckets. It does not cover other Storage buckets, external email-provider data,
hosted configuration or secrets. `storage.objects` rows remain in the separate
SQL file and are not loaded into local: Supabase owns that schema and its hosted
version can differ from the local stack. The restore procedure uploads the
bytes through Storage instead, creating local metadata.

The SQL dumps and Storage downloads are not a single atomic snapshot. An object
created, changed or deleted between the database dump and the two bucket walks
can leave a row and byte set from different moments. The script compares each
bucket inventory before and after downloading, but cannot prevent all concurrent
writes across the database and Storage services. For a recovery-grade snapshot,
pause writes during the backup or reconcile database references with the
manifest and restored files before relying on the recovered system.

## Restore

```bash
npm run restore:verify                     # newest complete run
npm run restore:verify -- path/to/run-dir  # a specific complete run
```

Local only. `assertLocal` checks the local Supabase URL and refuses Staging as
well as Production. The local stack is an isolated test target: this command
overwrites its application data and uploads the saved objects to its private
buckets. Never point it at Production. A failed restore leaves local data
partial or empty; run `npm run db:reset` before further tests.

The script does the whole loop, because no step alone proves anything:

1. count every table — what should come back
2. empty every application table, plus every `auth` table the dump writes to —
   a real restore target. `storage` is left alone, for the reasons above
3. confirm it is empty — the emptying actually happened
4. load the data dump
5. count again and compare
6. upload every saved object to local Storage, download it again and compare
   actual byte size and SHA-256 with the manifest

Before truncating the database, the script verifies that the manifest and all
saved object bytes exist and match. A missing or corrupted byte fails early.
Restore verification is complete only when the database checks and every
restored-byte comparison pass. The `*-storage.sql` rows are retained for
inspection, not replayed into the local Storage schema.
Older SQL-only backups are intentionally excluded from automatic selection:
they cannot prove recovery of private file bytes.

Emptying runs as `postgres` inside the database container rather than through
the data API, because `audit_events` revokes DELETE from every role. TRUNCATE by
the owner is not blocked by those grants and does not fire the immutability
trigger.

### What counts as proved depends on where the dump came from

A local dump restored into local has a baseline: the counts this database held a
moment ago, every one of which must come back. A Production dump restored into
local has none — the two hold different data. Comparing against the previous
contents reported twelve tables "short" on a Production restore that had loaded
perfectly, because the fixtures populate `goal_milestones` and `esh_import_rows`
and Production does not use them.

So a cross-environment run is checked against the dump instead: it must load
without a single error, every table it carries an INSERT for must hold rows
afterwards, and `auth.users` must not be empty — a restore nobody can sign in to
is not a restore. The counts are printed for a human to read as _is this what
Production looks like?_, which is a judgement no script can make.

## Proven against Production, 30 October 2026

The first real Production backup. Everything below was found by running the loop
rather than assuming it, and each one would have reported a perfectly good
backup as unprovable:

1. `storage.buckets` had three columns the local stack did not — split out, as
   above.
2. The baseline was the restore target's old contents rather than the dump —
   fixed, as above.
3. The truncate list named `auth.users` and trusted the cascade.
   `auth.flow_state`, `auth.sessions` and `auth.mfa_amr_claims` are not all its
   children, so a second run collided on `flow_state_pkey`. The list is now read
   off the dump: whatever it writes, the loop empties.

Proved afterwards, both ways round: the Production dump loaded without a single
error with all 69 tables it carries holding rows and 8 identities, and a local
dump still returns every one of its 40 populated tables at full count.

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
