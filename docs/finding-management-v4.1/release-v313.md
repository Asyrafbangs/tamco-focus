# Release runbook: v307, v310, v313 (PR #80)

Written 11 November 2026. Supersedes nothing: `production-readiness-runbook.md`
is the Stage E release and stays as the record of that one. This is the runbook
for this release only, and it exists because this release has a sequencing
constraint the previous one did not.

Every command below is PowerShell, because that is the shell this machine runs.
Nothing here is destructive to Production except step 3, which is the one step
that needs an explicit approval.

---

## 1. What is being released

| Migration | File                                                 | What it changes                                                                                                                                                                   |
| --------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v307      | `20261109001000_v307_intake_takeover.sql`            | `esh_claim_report_intake` accepts a report already in triage                                                                                                                      |
| v310      | `20261109002000_v310_takeover_is_deliberate.sql`     | **replaces that function's signature**: `(uuid)` is dropped, `(uuid, boolean default false)` created. A take over must be asked for, and is recorded with the person it came from |
| v313      | `20261110001000_v313_a_decision_is_the_holder_s.sql` | `esh_decline_report_intake` and `esh_mark_report_intake_duplicate` refuse a report another coordinator is holding                                                                 |

**All three are function-only.** No table, column, index, policy or type is
created, altered or dropped — verified by grep across the three files. There is
no data migration and nothing to backfill. The only schema object that
disappears is one function signature, in v310.

Application changes in the same PR: v305-v309 lifecycle work, v311 and v312
(controls disabled until the page is interactive, and the fade between those
two states no longer passes through an illegible colour).

## 2. How deployment is triggered

**Merging to `main` deploys to Production automatically.** There is no deploy
step in `.github/workflows/verify.yml`; Vercel's own Git integration does it.

Evidence, from GitHub's deployment records rather than from settings:

| Deployment                           | Ref                                    | Environment    | Result  |
| ------------------------------------ | -------------------------------------- | -------------- | ------- |
| 7669522101                           | `10825e6` (merge of PR #82, on `main`) | **Production** | success |
| earlier                              | `45277d2` (merge of PR #81, on `main`) | **Production** | success |
| every branch commit, incl. `0610ca5` | branch                                 | Preview        | —       |

So: main's merge commits become Production; branch commits become Preview. The
merge is the deployment. Confirm the production branch once in Vercel ->
Settings -> Git before the release if you want it from the source.

## 3. The sequencing constraint, and why the order is not negotiable

v310 drops `esh_claim_report_intake(uuid)` and creates
`esh_claim_report_intake(uuid, boolean default false)`.

Measured on 10 November 2026 against a database holding exactly Production's
migration set (head `20261107001000`), over HTTP through PostgREST as a
signed-in coordinator — not through `psql`, which resolves functions
differently and would not have shown it:

| Schema                   | Old call, `p_intake_id` only (the code live in Production) | New call, with `p_take_over` (this PR)     |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------ |
| Production today         | **OK**                                                     | **PGRST202** `Could not find the function` |
| After v307 + v310 + v313 | **OK**                                                     | **OK**                                     |

The migrations are backwards compatible with the code already live: PostgREST
passes arguments by name, so a one-argument call binds to the new function and
takes the default `false`, which is the old behaviour exactly. The code is not
forwards compatible with the old schema.

> **Migrate first. Merge second.** Reversed, claiming a report is broken for the
> whole build window — both the "Keep for triage" button and the automatic claim
> inside `saveFinding`.

## 4. Rollback criteria

Roll back if **any** of these is true after deployment:

1. Claiming a report fails, or the triage queue will not open.
2. `check:deployment` reports a missing migration, or any view unreadable.
3. The scheduler's last run is older than 36 hours, or reports a failed worker.
4. A coordinator can decline or duplicate-link a report somebody else holds.
5. Any smoke check in step 9 fails and is not explained by configuration.

**How to roll back.** Vercel -> Deployments -> the previous Production
deployment -> Promote to Production. That is the code. The migrations do **not**
need reverting: v313 is a refusal, so leaving it applied under older code is
safe — the older screen simply offers a decision the database declines — and
v307 is a widening. Only if the code is rolled back _and_ stays back does
v310's dropped `(uuid)` signature need restoring, and because the new function
answers one-argument calls, even that is not urgent.

Nothing in this release destroys data, so rollback never needs the backup. The
backup in step 2 is insurance against the unrelated, not against these three
files.

---

## 5. Step 1 — Pre-deployment checks

Run both. The first proves the branch; the second proves Production.

```powershell
# The branch is green, and all three CI jobs actually ran
gh pr checks 80 --repo Asyrafbangs/tamco-focus
gh run view (gh run list --branch esh/lifecycle-v305 --limit 1 --json databaseId --jq '.[0].databaseId') --json jobs --jq '.jobs[] | "\(.conclusion)  \(.name)"'
```

Expect three jobs, all `success`: _Format, lint, types, unit, secrets_;
_Migrations, RLS and integration_; _End-to-end_. A skipped job is not a pass —
read the names, not the tick.

```powershell
# Read-only Production health. Writes nothing, prints no secret.
$env:TAMCO_ENV = "production"
$env:NEXT_PUBLIC_SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
npm run check:deployment -- --smoke
```

**`--smoke` is required, and is the whole point of the command.** Without it the
script runs the base checks and prints "Add --smoke for the read-only production
checks." — no views, no evidence states, and no scheduler history. The `--`
passes the flag through npm to the script.

The project ref is in `supabase/.temp/project-ref`. Record the output. The lines
that matter before this release:

| Line                            | Expect                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Migrations                      | head `20261107001000`; v307/v310/v313 **absent** (that is the gap this release closes) |
| `last worker run`               | within 36 hours, `ok`                                                                  |
| evidence scan states            | nothing reading `clean` while no scanner is configured                                 |
| register and distribution views | both answer                                                                            |

**Open a new shell afterwards.** `TAMCO_ENV` and `NEXT_PUBLIC_SUPABASE_URL` stay
set for the rest of the session, and `--env-file` cannot override a variable
already in the environment — which is how a local command ends up pointed at
Production.

## 6. Step 2 — Backup, and prove it restores

### Take the backup (Production, read-only)

```powershell
$env:TAMCO_ENV = "production"
$env:NEXT_PUBLIC_SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
npm run backup:database
```

Check the **first line names the Production host**, not `127.0.0.1`. Without
both variables set in the shell, the script dumps the local database instead and
says so only in that line.

Check the line `private storage objects copied: N`. **If N is 0, the evidence
bucket was not proven** — the files are what the database only points at, and a
backup taken over an empty bucket tells you nothing about that path.

### Prove the restore, in an isolated database

**What is in your hands at this point.** A Production backup is the employee
directory, every task and finding, the full audit history, and the real bytes of
every ESH evidence photograph and task attachment. Restoring it puts all of that
into a local database. Treat the drill as handling confidential records, because
it is.

The restore is destructive to whatever it points at, and its defaults used to
point somewhere you would not want:

- `assertLocal` only inspects the **URL**. It will refuse a Production URL.
- The container comes from `TAMCO_DB_CONTAINER`, whose default is
  **`supabase_db_tamco-focus` — the shared development stack**. The URL guard
  never looked at it, so a local URL was not enough protection.

**That is now enforced rather than documented.** `verify-restore.mjs` prints the
target database before it touches anything, refuses
`supabase_db_tamco-focus` outright unless `TAMCO_RESTORE_ALLOW_SHARED=1` is set
deliberately, and refuses a container that is not running instead of failing
halfway through. Set the target anyway, every time — the guard is a backstop,
not a substitute for knowing where the data is going:

```powershell
# New shell. TAMCO_ENV and the Production URL must NOT be set.
$env:TAMCO_DB_CONTAINER       = "supabase_db_tamco-lifecycle"
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:55321"
$env:SUPABASE_SERVICE_ROLE_KEY = "<isolated stack service role key>"
npm run restore:verify
```

`supabase_db_tamco-lifecycle` is the isolated stack on ports 55321/55322. It is
not the shared development database and it is not Production. The isolated
stack's key comes from
`npx supabase status --workdir "D:/AI Project/Task Management/tamco-lifecycle-db"`.

The first line must read `Target database: supabase_db_tamco-lifecycle`. If it
names anything else, stop.

Expect `Restore verified: every populated table came back with its full row
count.` and `Storage verified: N private objects uploaded to local Storage and
read back with the manifest byte sizes and SHA-256 hashes.`

Three things to know:

- **A failed restore leaves that database empty.** It truncates before loading.
  Run `npx supabase db reset --workdir "D:/AI Project/Task Management/tamco-lifecycle-db"`
  immediately, or the next test failure looks like a product bug.
- Production's data is at the v296 schema and the isolated stack is at v313.
  That is fine here precisely because these three migrations add no columns, so
  a data-only load has nowhere to go wrong. It would not be fine for a release
  that changed a table.
- Docker must be running. The stack is containers; if the engine is down the
  drill cannot start, and the guard now says so rather than failing obscurely.

### Wipe it afterwards — this is a required step, not tidying up

```powershell
npx supabase db reset --workdir "D:/AI Project/Task Management/tamco-lifecycle-db"
```

Until this runs, real employee records and real evidence sit in a local database
whose Studio is served on `127.0.0.1:55323` with no authentication, and which
the browser suite will later run against — mixing live records with test
fixtures. Reset it the moment the drill has reported.

### Where the backups live, and how long they should

Backups are written outside the repository, to
`D:\AI Project\Task Management\tamco-focus-backups`. That is deliberate — a
dump can never be committed — but it also means the files are plain,
unencrypted, and nothing expires them.

**As of 12 November that directory holds 294 MB**, including a complete 31
October Production backup with real evidence files, and **four abandoned
`.incomplete` Production runs** from failed attempts on 31 October and 3
November. Partial employee records left behind by a crash serve no purpose and
nobody is tracking them.

Rules for this release:

1. Delete the `.incomplete` directories before taking a new backup. A partial
   dump cannot be restored and cannot be verified, so it is only exposure.
2. Keep **one** verified Production backup — the newest. Remove older ones once
   a newer one has passed `restore:verify`.
3. Keep the directory off any synced or shared location, and out of anything
   that backs up to a third party.
4. The dumps carry no secrets (`check:deployment` and the backup script both
   avoid printing keys), but they do carry people. Handle them as you would the
   HR file they partly are.

## 7. Step 3 — Apply the migrations (needs approval)

This is the first Production change.

```powershell
cd "D:/AI Project/Task Management/tamco-focus"
git checkout esh/lifecycle-v305
git pull
npx supabase db push
```

`db push` sends whatever migration files are on disk, committed or not — so
check out the branch first and confirm `git status` is clean. It should report
three migrations to apply, in this order: `20261109001000`, `20261109002000`,
`20261110001000`.

**Never run the `migration repair --status reverted` list the CLI may suggest.**
It would mark every applied migration as reverted.

## 8. Step 4 — Verify the migrations before touching the code

```powershell
npx supabase migration list --linked
```

Head must read `20261110001000` under Remote. Then, in the Supabase SQL editor
(read-only):

```sql
-- One function, two arguments, the second defaulted. If two rows come back,
-- the old signature survived and every one-argument call is now ambiguous -
-- PostgREST answers an ambiguous call with null, which reads as "nothing
-- happened". Stop and drop the stray one.
select pg_get_function_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'esh_claim_report_intake';

-- v313 is in both procedures.
select p.proname,
       position('held_by_other' in pg_get_functiondef(p.oid)) > 0 as has_guard
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('esh_decline_report_intake', 'esh_mark_report_intake_duplicate');
```

Expect exactly one row from the first (`p_intake_id uuid, p_take_over boolean
DEFAULT false`) and `has_guard = true` for both rows of the second.

At this point Production is on the new schema and the old code — which is the
state proven safe in section 3. There is no time pressure to merge.

## 9. Step 5 — Merge, and watch the deployment

```powershell
gh pr merge 80 --repo Asyrafbangs/tamco-focus --squash
```

Then watch it land:

```powershell
gh api "repos/Asyrafbangs/tamco-focus/deployments?environment=Production&per_page=1" --jq '.[0] | "\(.id)  \(.sha[0:7])  \(.created_at)"'
gh api "repos/Asyrafbangs/tamco-focus/deployments/<id>/statuses?per_page=3" --jq '.[] | "\(.state)  \(.created_at)"'
```

Expect a new Production deployment on the merge commit reaching `success`
within a few minutes. **A deployment that fails in three seconds is an
environment-variable fault, not a build fault** — that is how the whitespace in
`CRON_SECRET` announced itself on 4 November. Read the Vercel build log before
assuming the code.

Also watch the post-merge run of `main`, which is the first run of the browser
suite on the merged result:

```powershell
gh run list --branch main --limit 1
```

## 10. Step 6 — Post-deployment validation

### Automatic

```powershell
# New shell, Production variables set as in step 1
npm run check:deployment -- --smoke
```

Migration head must now read `20261110001000`. Everything else must read as it
did before the release.

### By hand, specific to this release

Sign in as an ESH coordinator.

| #   | Check                                                            | Expect                                                                                                              | Proves                                                                                        |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | Open the triage queue, press **Keep for triage** on a new report | the report becomes yours, no error                                                                                  | v310's two-argument call resolves — this is the one that breaks if the migration were missing |
| 2   | Record a finding from an unclaimed report                        | saves, and the report is claimed on your behalf                                                                     | the automatic claim inside `saveFinding`                                                      |
| 3   | As a **second** coordinator, open a report the first is holding  | "<name> is holding this report", and **only** a _Take over from <name>_ button — no Decline form, no duplicate form | v313's screen                                                                                 |
| 4   | Press **Take over**, then check the finding's history            | the handover is recorded, naming who it came from                                                                   | v310's audit                                                                                  |
| 5   | Decline a report **nobody** is holding, with a reason            | declines normally                                                                                                   | v313 did not break the ordinary path                                                          |
| 6   | Reload a triage page and press a button immediately              | nothing half-happens; controls are inert until the page is ready                                                    | v311                                                                                          |
| 7   | Watch a button's first moment on load                            | no flash of unreadable grey-on-blue text                                                                            | v312                                                                                          |
| 8   | Open the register and the Patterns page                          | both render, categories present                                                                                     | nothing unrelated regressed                                                                   |
| 9   | Sign in as somebody with no Finding access, open `/findings`     | "not found", not a page                                                                                             | authorisation intact                                                                          |

A second account is needed for checks 3 and 4. Any staff account with Finding
coordination access will do.

### The scheduler — read its history first, and do not call it to find out

An HTTP status is not evidence about the scheduler. Unauthenticated, `/api/cron`
answers **401** whether the schedule has been firing daily for a month or has
never fired at all; 401 only rules out the one case of an unset `CRON_SECRET`,
which returns **503**. The history is in the database, and
`esh_worker_runs` is append-only — an `update` or `delete` on it is refused by a
trigger — so what it holds is what happened.

`check:deployment -- --smoke` prints the newest run and fails if it is over 36
hours old, but it reads only `worker, ran_at, ok`. The per-worker breakdown is
in the `detail` column, which the endpoint writes as
`{"workers": [{"worker": ..., "ok": ...}, ...]}`. Read it in the Supabase SQL
editor (read-only):

```sql
-- Every scheduled run of the last fortnight, and each worker inside it.
select r.ran_at,
       r.ok                        as run_ok,
       w ->> 'worker'              as worker,
       (w ->> 'ok')::boolean       as worker_ok
  from public.esh_worker_runs r
  cross join lateral jsonb_array_elements(
         coalesce(r.detail -> 'workers', '[]'::jsonb)) w
 where r.worker = 'cron'
   and r.ran_at > now() - interval '14 days'
 order by r.ran_at desc, worker;

-- The short version: which workers have failed, and how often.
select w ->> 'worker'                                        as worker,
       count(*)                                              as runs,
       count(*) filter (where (w ->> 'ok')::boolean is false) as failures,
       max(r.ran_at) filter (where (w ->> 'ok')::boolean is false) as last_failure
  from public.esh_worker_runs r
  cross join lateral jsonb_array_elements(
         coalesce(r.detail -> 'workers', '[]'::jsonb)) w
 where r.worker = 'cron'
   and r.ran_at > now() - interval '14 days'
 group by 1
 order by failures desc, worker;
```

Read the second result first. `failures = 0` across every worker is the pass.
`esh_effectiveness_due` and `esh_followups` are the two this release cares
about; `esh_scan` reporting "no scanner configured" is an `ok: true` and not a
failure. **No rows at all** means the scheduler has never recorded a run, which
is the symptom a missing or malformed `CRON_SECRET` produces — and is not the
same as "it ran and found nothing".

### Calling it by hand — a production change, needing approval

```powershell
curl.exe -s -o - -w "`n%{http_code}`n" -H "Authorization: Bearer $env:CRON_SECRET" https://tamco-focus.vercel.app/api/cron
```

**This writes.** It generates routine occurrences, raises overdue and
due-tomorrow notices, runs the follow-up and escalation pass, queues
effectiveness-check notifications, sweeps orphaned uploads, builds digests, and
then drains the mail outbox — which **sends email to real people**. It is a
production change and belongs with the other three, not among the read-only
checks. Do not use it to establish whether the scheduler works: read the
history above, which costs nothing and tells you more.

Use it only when the history shows the schedule is not firing and you need the
work done now, or to confirm a fix. Expect **200** and a body naming each worker
with `ok: true`. A **503** means `CRON_SECRET` is not set; a **401** means the
secret presented does not match the one deployed.

Running it twice in a day duplicates nothing: every worker keys its own work.
Proven on 10 November — a second call reported the same
check still due and `queued: 0`.

## 11. Step 7 — Escalation recipients, with rollout left restricted

Rollout stays `restricted`. That is deliberate and it is not in the way: a
contact's access can be enabled individually, and an individually enabled
contact receives escalation mail while the rollout stays exactly as it is.

Proven on 10 November against the isolated stack, rollout `restricted`
throughout: the same escalation that was `held_rollout` for a contact whose
access was off became `provider_accepted` once that one contact was enabled.

**Find out who would be missed** — read-only, Supabase SQL editor:

```sql
select
  f.reference                                as finding,
  a.state                                    as action_state,
  a.due_at::date                             as due,
  greatest(current_date - a.due_at::date, 0) as days_overdue,
  r.level                                    as escalation_level,
  p.display_email                            as recipient,
  p.status                                   as contact_status,
  p.access_enabled,
  (p.status = 'active'
   and (p.access_enabled
        or (ro.mode = 'live' and p.access_disabled_by is null))) as would_receive
from public.esh_action_escalation_recipients r
join public.esh_finding_actions a   on a.id = r.action_id
join public.esh_findings f          on f.id = a.finding_id
join public.esh_email_principals p  on p.id = r.principal_id
join public.esh_rollout_settings ro on ro.organization_id = r.organization_id
where r.removed_at is null
  and f.status = 'open'
  and a.state in ('assigned', 'in_progress', 'awaiting_verification')
order by would_receive, days_overdue desc, f.reference, r.level;
```

`would_receive` is the dispatcher's own condition (`focus.esh_contact_usable`).
Rows sort so that anybody who would be **missed** comes first. An empty result
means no open, live corrective action currently names an escalation recipient —
which is a fact about the data, not a pass.

**Enable the ones who should receive it** at **More -> Administration -> Users**,
in Contact administration. It takes a reason, which is kept, and refuses more
than fifty at a time. No SQL, and no change to the rollout mode.

Deciding _who_ is a business decision, not a technical one. The query says who
is currently named; whether each of them should be reachable is the owner's
call.

---

## 12. The controlled sequence, in order

| #   | Step                                                             | Touches Production        | Needs approval |
| --- | ---------------------------------------------------------------- | ------------------------- | -------------- |
| 1   | Branch checks green, all three jobs ran                          | no                        | no             |
| 2   | `check:deployment -- --smoke` against Production                 | read only                 | no             |
| 3   | The two scheduler-history queries                                | read only                 | no             |
| 4   | `backup:database` against Production                             | read only                 | no             |
| 5   | `restore:verify` into the isolated stack, then wipe it           | no                        | no             |
| 6   | `supabase db push`                                               | **yes**                   | **yes**        |
| 7   | `migration list` + the two SQL checks                            | read only                 | no             |
| 8   | `gh pr merge 80`                                                 | **yes, deploys**          | **yes**        |
| 9   | Watch the Production deployment reach success                    | no                        | no             |
| 10  | `check:deployment -- --smoke` again, then the nine manual checks | read only                 | no             |
| 11  | Enable escalation recipients                                     | **yes**                   | **yes**        |
| 12  | Call `/api/cron` by hand — **only if step 3 showed a problem**   | **yes, sends real email** | **yes**        |

Steps 6, 8, 11 and 12 are the only ones that change Production. Each is
reversible or bounded: 6 by re-applying the previous definitions, 8 by promoting
the previous deployment, 11 by revoking the access in the same screen. 12 is not
reversible — mail that has left has left — which is why it sits last, needs
approval, and is skipped entirely when the scheduler's own history is clean.
