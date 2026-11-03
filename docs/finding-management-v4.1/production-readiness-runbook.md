# Production readiness runbook

Seven steps, in order, with what each one should print and what should make you
stop. Everything here runs on your machine, against Production, in a shell you
control.

**Why you and not me.** An agent in this session cannot reach Production: the
permission classifier blocks it, and it blocked two attempts during this work —
including `supabase migration list --linked`, which is why `check:deployment`
grew a `--no-migrations` flag. That boundary is worth keeping: the same rule
that stops me reading Production stops me changing it by accident.

**What I did verify, today, so you are not discovering tooling bugs against
Production:** the backup and restore path end to end against the local stack.
`npm run backup:database` wrote a complete run with 8 private storage objects;
`npm run restore:verify` restored it and reported **every populated table back
with its full row count — 94 tables** — and all 8 objects read back matching
the manifest's byte sizes and SHA-256 hashes. The tooling works. What it has
not been pointed at today is Production.

Before you start: `git checkout main && git pull`. `main` is at `840b965`, and
run `41645233359` was green on all three jobs including the browser suite.

---

## Step 1 — Back up Production, and verify the backup

```powershell
$env:TAMCO_ENV = 'production'
npm run backup:database
```

`TAMCO_ENV` must be set **in the shell**, not in a file: Node's `--env-file`
never overrides an existing variable, and without it the script backs up the
**local** stack and tells you it succeeded. The run directory lands beside the
repository, never inside it.

**Expect:** `complete run: …tamco-focus-production-<timestamp>-<hash>`, a
non-zero `private storage objects copied`, and the reminder that nothing is
proven until a restore.

**Then verify it — into local, never into Production:**

```powershell
Remove-Item Env:\TAMCO_ENV
npm run restore:verify -- <path to the production run directory>
npm run db:reset
```

**Expect:** a table of row counts with `restored` equal to `backed up` for
every populated table, then _"Restore verified"_ and _"Storage verified"_.

**Stop if:** any row count differs, or the storage comparison reports a hash
mismatch. A failed `restore:verify` **truncates the local database before it
loads**, so run `npm run db:reset` immediately whatever happens — otherwise the
next local test failure looks like a product bug.

| Result                   |               |
| ------------------------ | ------------- |
| Backup written           | ☐ PASS ☐ FAIL |
| Restore verified         | ☐ PASS ☐ FAIL |
| Storage objects verified | ☐ PASS ☐ FAIL |

---

## Step 2 — Apply the five migrations

From a **clean** `main`, with nothing uncommitted:

```powershell
git status --short
npx supabase db push --linked
```

`db push` sends whatever migration files are on disk, committed or not. A
working tree with a later stage in it would send that too, which is why the
`git status` line is part of the step.

**Expect** these five, and nothing else:

| Version | File                                            |
| ------- | ----------------------------------------------- |
| v279    | `20261103001000_v279_related_findings.sql`      |
| v280    | `20261103002000_v280_finding_connections.sql`   |
| v286    | `20261103003000_v286_evidence_orphan_sweep.sql` |
| v287    | `20261103004000_v287_hazard_classification.sql` |
| v288    | `20261103005000_v288_public_qr_reporting.sql`   |

**Stop if** the CLI offers to repair migration history. **Never run the
`migration repair --status reverted` list it suggests** — it would mark every
applied migration as reverted.

What these do to existing data: nothing is dropped or rewritten. v286 and v288
add tables and procedures; v287 adds a table, four nullable columns and a
`create or replace view` on each register view, with the new columns appended
at the end — never `drop view`, because a dropped view returns without
`security_invoker`, which is the whole of its row-level security. v288 inserts
one **closed** public-reporting settings row per organisation.

| Result                                    |               |
| ----------------------------------------- | ------------- |
| Five migrations applied, no repair prompt | ☐ PASS ☐ FAIL |

---

## Step 3 — `npm run check:deployment`

```powershell
$env:TAMCO_ENV = 'production'
$env:NEXT_PUBLIC_SUPABASE_URL = 'https://<ref>.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY = '<the current key>'
npm run check:deployment
```

It writes nothing and prints no secret. Paste the output here as it stands —
it contains the key's _claims_ (role, project, issued date) but not the key.

**Expect:** the five versions above under both Local and Remote;
`EMAIL_TRANSPORT: smtp`; `CRON_SECRET` present; the scanner either unset (every
file reads "Not scanned", which the application says out loud) or set with a
token.

**A remote `ESH_SCANNER_URL` with an empty `ESH_SCANNER_TOKEN` is reported as a
miss and the worker refuses to send evidence** — that is deliberate, not a bug.

| Result                         |               |
| ------------------------------ | ------------- |
| Five migrations under Remote   | ☐ PASS ☐ FAIL |
| `EMAIL_TRANSPORT` is `smtp`    | ☐ PASS ☐ FAIL |
| `CRON_SECRET` set              | ☐ PASS ☐ FAIL |
| Scanner configuration coherent | ☐ PASS ☐ FAIL |

---

## Step 4 — Rotate the service-role key

The order matters: the backup in step 1 needed the **old** key, which is why
it came first.

1. **Supabase dashboard** → Project Settings → API → `service_role` → generate
   a new key. Copy it once; the dashboard will not show it again in full.
2. **Vercel** → Project → Settings → Environment Variables →
   `SUPABASE_SERVICE_ROLE_KEY`, scope **Production**, replace the value.
3. **Redeploy.** Vercel injects environment variables at build and boot, so a
   saved variable that has not been redeployed **is not in use**. Deployments →
   the current Production deployment → Redeploy.
4. **Prove which key is live.** Re-run step 3 with the new key in your shell.
   The `issued:` line must show today's date. A Vercel secret cannot be read
   back, so this is the only honest check — and that gap is exactly what let
   Production run on the `log` mail transport for weeks while every cron run
   returned 200.
5. **Update your own local file** if it held the old value, and nothing else.

**What rotation does not fix:** it stops the old key working; it does not tell
you whether it was used while exposed. `esh_audit_events` records application
actions, not service-role reads. If that matters, ask Supabase support whether
API logs for the exposure window are retained. And if the exposure was a
commit, the commit still contains the value — it is harmless once rotated, so
do not rewrite history to hide a dead key.

**Anything still holding the old key stops working at step 1 of this list:** the
Vercel runtime until you redeploy, any local shell, and a scanner host if one
is configured. Expect a few minutes where cron runs would fail; that is why
this is a quiet-hours job.

| Result                            |               |
| --------------------------------- | ------------- |
| New key issued                    | ☐ PASS ☐ FAIL |
| Vercel updated **and redeployed** | ☐ PASS ☐ FAIL |
| `issued:` shows today             | ☐ PASS ☐ FAIL |

---

## Step 5 — `PUBLIC_REPORT_SALT`

Generate it on your machine and paste it only into Vercel:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Vercel → Environment Variables → new variable `PUBLIC_REPORT_SALT`, scope
**Production**, mark it sensitive, then **redeploy**. Add the same name to your
own `.env.local` with a different value if you want local parity; it is already
in `.env.example` as an empty line, which is what CI uses.

What it is for: the public reporting rate limit keys its counters on
`sha256(address + today + salt)`. Without the salt the code falls back to a
constant — the limit still works, but it stops resisting somebody who holds
both the database and the repository. Changing the salt later only resets that
day's counters.

**Do not** put it in a commit, and do not paste it in chat. I do not need it
and cannot use it.

| Result                    |               |
| ------------------------- | ------------- |
| Set in Vercel, redeployed | ☐ PASS ☐ FAIL |

---

## Step 6 — Production smoke test

Against the deployed site, signed in as yourself. Nine checks, each chosen
because something real has broken in it before.

1. **An existing finding still opens.** `/findings/register?filter=all`, open
   any finding. Its history, evidence and conversation are intact. _(v287 added
   columns to the register views; this is the check that they still serve the
   same rows.)_
2. **The new classification appears and saves.** On that finding, "What kind of
   hazard" is visible without opening anything. Choose a category, save, reload
   — it is still there. Then set it back to "Not categorised" if the finding
   was not yours to classify.
3. **The register shows and filters it.** The row carries the category, and
   `Hazard → Not categorised` lists the open findings nobody has classified.
4. **Patterns counts it.** `/findings/patterns` shows the distribution table
   with every category as a row, and the uncategorised count underneath.
5. **An upload still works.** Attach a photograph to a finding's action. It
   appears, and its label reads "Not scanned" unless a scanner is configured —
   never "Clean".
6. **Permissions still hold.** Sign in as somebody without Finding access and
   open `/findings`. Expect "not found", not a page. _(Since v282 a database
   error no longer produces that same 404, so if you see one it means access,
   not an outage.)_
7. **Public reporting is closed.** `/report/<any code>` says the link does not
   report anything, and offers no form. `/report` says to scan the sticker.
   The administrator screen shows **Public QR reporting: Closed**.
8. **The cron endpoint runs.** With the current secret, in your shell:

   ```powershell
   curl -s -o - -w "`n%{http_code}`n" -H "Authorization: Bearer $env:CRON_SECRET" https://<your-domain>/api/cron
   ```

   Expect **200** and a body naming each worker with `ok: true`. The new ones
   are `esh_orphans` and `esh_public_intake`; both should report zeros on a
   first run. A **503** means `CRON_SECRET` is not set in the deployment.

9. **Email delivery.** Assign a finding to an address you own, or use
   `npm run mail:test-notification` pointed at Production. The mail arrives.
   `EMAIL_TRANSPORT=log` sends nothing while returning success everywhere —
   step 3 is what catches that, and this is what confirms it.

| #   | Check                                        | Result        |
| --- | -------------------------------------------- | ------------- |
| 1   | Existing finding opens, history intact       | ☐ PASS ☐ FAIL |
| 2   | Hazard classification visible and saves      | ☐ PASS ☐ FAIL |
| 3   | Register shows and filters by category       | ☐ PASS ☐ FAIL |
| 4   | Patterns distribution renders                | ☐ PASS ☐ FAIL |
| 5   | Evidence upload works, reads "Not scanned"   | ☐ PASS ☐ FAIL |
| 6   | No-access reader gets 404, not a page        | ☐ PASS ☐ FAIL |
| 7   | Public reporting closed on all three screens | ☐ PASS ☐ FAIL |
| 8   | `/api/cron` returns 200, workers ok          | ☐ PASS ☐ FAIL |
| 9   | Email actually arrives                       | ☐ PASS ☐ FAIL |

---

## Step 7 — The deployment report

Fill the tables above and the summary below. Paste the whole thing back and I
will record it in `PROJECT_PROGRESS.md` as the deployment of record, with
whatever failed and what was done about it.

```text
DEPLOYMENT REPORT — <date>

Backup               PASS / FAIL   run directory: <name>
Restore verified     PASS / FAIL   tables: <n>, storage objects: <n>
Migrations applied   PASS / FAIL   v279 v280 v286 v287 v288
check:deployment     PASS / FAIL   (output pasted separately)
Key rotated          PASS / FAIL   issued: <date from the check>
PUBLIC_REPORT_SALT   PASS / FAIL
Smoke 1-9            <n> PASS / <n> FAIL
Public QR reporting  CLOSED (expected)

Outstanding risks:
  <one line each>
```

---

## Outstanding risks, as they stand before you begin

These are mine to state, not yours to discover:

1. **The old service-role key's exposure window is unaudited.** Rotation closes
   the future, not the past, and `esh_audit_events` does not record
   service-role reads. Unknown, and only Supabase's own logs could narrow it.
2. **Compression has never been measured against a real photograph.** Every
   figure in Stage A is either the approved package's or from a synthetic
   fixture. The pipeline is proven — a 1.8 MB noise PNG became a ~400 KB JPEG,
   a flat-toned PNG stayed a PNG, and the stored bytes carry no EXIF — but the
   numbers a report would quote have not been taken.
3. **The 30–60 second form target is untimed.** It needs an employee and a
   stopwatch, not a test.
4. **No scanner is hosted.** Until `ESH_SCANNER_URL` is set, every file is
   `not_scanned`, and the application says so rather than implying clean. That
   is honest, not safe: the signature, dimension and rebuild checks are what is
   actually protecting the bucket.
5. **`layout-invariants-v244` fails locally on this machine** and passes on CI,
   deterministically, for a reason traced to a hard navigation inside the
   crawl's measuring window rather than to the product. It is not a deployment
   risk; it is a reason not to trust a local-only gate run.
6. **Email has only ever been proven by a smoke test.** There is no synthetic
   monitor on delivery, so the next transport regression will be found by
   somebody not receiving a notification.
7. **The administrator role still carries business-manager authority.**
   Deferred by the package's own instruction, so it is out of scope here — but
   it remains true that the account that will open the pilot can agree any
   employee's goal.
