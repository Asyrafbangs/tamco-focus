# Stage D — readiness, and what is still somebody else's to do

Stage D is the stage with the least code in it and the most that cannot be
closed from a session. Everything below separates three things that get
confused when somebody asks "are we ready?": what has been **proven**, what
only the account owner can **establish**, and what nobody has **decided**.

The rule this document follows: an agent in this environment cannot read
Production. The permission classifier blocks it, and rightly — so every claim
about Production here is either a command for the owner to run or an explicit
"not known".

## `npm run check:deployment`

The question "are v279–v288 applied, and is the configuration right?" has been
asked at every stage and answered from documents, which is how
`EMAIL_TRANSPORT` sat on `log` in Production for weeks while every cron run
returned 200. This script asks the deployment instead.

```bash
TAMCO_ENV=production \
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<key> \
npm run check:deployment
```

It prints:

- **The service-role key's own claims** — role, project ref and issued date,
  decoded from the token. After a rotation, that date is how you tell the new
  key from the old one. It never prints the key.
- **The migrations**, by running `supabase migration list --linked` and showing
  its Local/Remote columns verbatim. Not a summary: `db push` reporting "Remote
  database is up to date" has misled twice, and the two columns are the answer.
- **The configuration whose absence is silent**: `EMAIL_TRANSPORT`,
  `CRON_SECRET`, `ATTACHMENT_ALLOWED_MIME`, the scanner pair (a remote
  `ESH_SCANNER_URL` with an empty `ESH_SCANNER_TOKEN` makes the worker refuse
  to send evidence, by design), and `PUBLIC_REPORT_SALT`.

It writes nothing, and there is no flag that makes it write. `--no-migrations`
skips the one step that reaches the linked project, which is how the
configuration half was verified from here.

## Migrations this package introduced

| Version | What it does                                    | Applied to Production |
| ------- | ----------------------------------------------- | --------------------- |
| v279    | related findings (Stage 3a, merged earlier)     | **No**                |
| v280    | the connections view (Stage 4a, merged earlier) | **No**                |
| v286    | the evidence orphan sweep (Stage A)             | **No**                |
| v287    | hazard classification (Stage B)                 | **No**                |
| v288    | public QR reporting (Stage C)                   | **No**                |

All five need `npx supabase db push --linked`, run by the owner, once the
branch carrying them is merged and green. Two standing rules apply:

- **`db push` sends whatever migration files are on disk**, committed or not.
  Run it from a clean checkout of `main`, not from a working tree with a later
  stage in it.
- **Never run the `migration repair --status reverted` list the CLI suggests.**
  It would mark every applied migration as reverted.

Nothing in v286–v288 drops or rewrites an existing object. v287 and v288 both
use `create or replace view` with columns appended at the end rather than
`drop view`, because a dropped view comes back without `security_invoker` —
which is the whole of its row-level security, and is how v280 nearly leaked
the register.

## The exposed service-role key

The key was exposed earlier in this project's history. It has not been rotated,
and rotation is the owner's act in the Supabase dashboard — a session cannot
do it and should not hold the new value.

**What the key can do if somebody has it:** everything. It bypasses row-level
security on every table, reads and writes the private evidence bucket, and can
read every finding, every contact and every photograph in the system. There is
no partial exposure to reason about.

### Rotation, in order

1. **Pick the window.** Rotation invalidates the old key the moment the new one
   is issued. Anything still holding the old value stops working: Vercel's
   server runtime, the cron endpoint's workers, any local `.env.local` used
   against Production, and the scanner host if one is configured.
2. **Take a backup first.** `npm run backup:database` with `TAMCO_ENV=production`
   set in the shell. It needs the _current_ key, so this is before rotation,
   not after.
3. **Rotate** in the Supabase dashboard: Project Settings → API → the
   `service_role` key → Generate new key (or Roll). Copy the new value once.
4. **Update Vercel** — Project Settings → Environment Variables →
   `SUPABASE_SERVICE_ROLE_KEY`, for Production. Then **redeploy**: Vercel
   injects environment variables at build and boot, so a saved variable that
   has not been redeployed is not in use.
5. **Prove which key is live.** Run `npm run check:deployment` against
   Production; the `issued` line must show today's date. A secret in Vercel
   cannot be read back, so this is the only honest check, and it is the gap
   that let the log transport survive for weeks.
6. **Prove the application still works.** `/api/cron` with the current
   `CRON_SECRET` must answer 200 and name its workers; one evidence upload must
   reach the private bucket.
7. **Update any local file** that holds the old value, and nothing else.
8. **Afterwards:** the old key appears in whatever exposed it. Rotating stops
   it working; it does not unpublish it. If the exposure was a commit, the
   commit still contains it, and the value is harmless once rotated — do not
   rewrite history to hide a dead key.

**What rotation does not fix:** if the key was used while exposed, rotation
does not tell you so. The audit trail (`esh_audit_events`) records application
actions, not service-role reads. If that matters, the question to ask Supabase
support is whether API logs for the period are retained.

## Backups, and the three traps in them

Each of these has already produced a wrong conclusion here:

- **`npm run backup:database` defaults to LOCAL.** Without `TAMCO_ENV=production`
  **in the shell** you will back up the development stack and believe you have
  a production backup. Node's `--env-file` never overrides an existing
  variable.
- **A failed `npm run restore:verify` leaves the local database empty**, because
  it truncates before loading. Run `npm run db:reset` immediately afterwards,
  or the next test failure looks like a product bug.
- **The bucket files are not in the database dump.** Storage is backed up
  separately by the same script; a database-only backup restores findings whose
  evidence is gone.

Restore is proven into a scratch target. **Never into Production.**

## The rollout plan

Public reporting is built and closed. Opening it is one procedure call behind an
administrator's reason, and these are the steps between here and that call.

**Before the pilot**

1. Merge Stages A–D, each green on a dispatched run that includes the browser
   job. A green pull request has run no browser test in this repository.
2. `npx supabase db push --linked` from a clean `main`, then
   `npm run check:deployment` to see v286–v288 under Remote.
3. Rotate the service-role key (above), and redeploy.
4. Set `PUBLIC_REPORT_SALT` in Vercel and redeploy. Without it the rate-limit
   buckets fall back to a constant salt — still a working limit, but one that
   does not resist somebody holding both the database and the repository.
5. Decide the scanner: host one and set `ESH_SCANNER_URL` with a token, or run
   the pilot text-only and accept that every file reads "Not scanned", which
   the application says out loud. Both are defensible; what is not defensible
   is a remote scanner with no token, which the worker refuses anyway.
6. Create the QR locations — one row per sticker, with a code that is not
   guessable from the area's name — and print the stickers. A retired sticker
   resolves to the same "this link does not report anything" page as a code
   nobody issued.

**The pilot**

7. One area. One administrator opens reporting with a reason naming the area
   and the date, and the queue is watched daily by the ESH coordinator who
   covers it.
8. Watch three things: reports that arrive uncategorised and stay that way
   (the register's **Not categorised** filter is the working list), photographs
   that could not be sent, and anything in the cron run's `esh_public_intake`
   or `esh_orphans` output that is not zero.
9. Close it again with a reason if anything surprises you. Closing stops new
   reports; the ones already received stay in the queue, because a report
   somebody took the trouble to send does not stop being true.

**Before the whole site**

10. Confirm with real employees that the form takes 30–60 seconds for a
    straightforward observation. This has **not** been measured — it cannot be
    measured from here, and quoting the package's figure as though it had been
    would be exactly the kind of claim this document exists to avoid.
11. Confirm the emergency arrangement: the form says "follow your site's
    emergency procedure" and names no number, on purpose. Somebody has to
    confirm that the sticker sits beside something that does.

## The §10 report: implemented, tested, merged, deployed, approved

| Stage                                                     | Implemented                             | Tested                                                                                       | Merged | Deployed | Operationally approved         |
| --------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------- | ------ | -------- | ------------------------------ |
| A — scanner verdict, pixel limits, PNG rule, orphan sweep | Yes                                     | unit, pgTAP, integration, browser; every guard broken individually                           | PR #56 | No       | n/a                            |
| B — hazard classification                                 | Yes                                     | 22 pgTAP, 12 unit, 2 browser                                                                 | PR #57 | No       | n/a                            |
| C — public QR reporting                                   | Yes                                     | 32 pgTAP, 4 integration, 18 unit, 2 browser                                                  | PR #58 | No       | **No — the channel is closed** |
| D — readiness                                             | Yes (`check:deployment`, this document) | the script's configuration half was run from here; its migration half needs a linked project | PR #59 | No       | n/a                            |

**Not measured, and not claimed:**

- Compression against **real photographs**. The numbers in Stage A's
  configuration are the package's, and the only measurements taken here are
  against synthetic fixtures — a 1.8 MB noise PNG becoming a ~400 KB JPEG, and
  a flat-toned PNG staying a PNG. Real phone photographs, Android and iPhone,
  are needed to report an honest table, and a synthetic figure dressed up as a
  measurement would be worse than none.
- Mobile upload speed on the plant's own signal.
- The 30–60 second form target.
- Whether v279–v288 are applied to Production, and what `EMAIL_TRANSPORT`,
  `ATTACHMENT_ALLOWED_MIME` and `CRON_SECRET` are set to there.
- Whether the exposed service-role key was used while it was exposed.

## The honest summary

The private staff workflow is built, gated and merged. The public half is
built, closed, and reversible by one administrator's sentence. Every security
control the package asked for exists and has a test that fails when the control
is removed.

What is not ready is everything that depends on a deployment nobody in this
session can read, a key only the owner can rotate, photographs only the plant
can take, and an approval only a person can give. **This is not
production-ready, and it should not be described as such until the rollout plan
above has been walked through with its boxes actually ticked.**
