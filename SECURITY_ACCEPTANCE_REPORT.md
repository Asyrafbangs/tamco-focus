# Security acceptance report

Date: 11 August 2026
Scope: the boundaries that must hold before real people use this.

Results below are from the local stack. Boundaries marked **NOT YET TESTED**
need separate authenticated accounts on a hosted environment and are Phase 10
work; nothing here claims to have tested them.

---

## Go-live blocker

### The `administrator` role carries business-manager authority — FAIL

Sections 17 and 52 require account administration and business management to be
separate: a System Admin may onboard and offboard people, and must not thereby
gain the ability to agree an employee's Goal or decide their Barrier.

Today they are the same thing. `focus.is_admin()` appears inside the business
authority predicates, so an administrator can:

| Capability                | Where                                                     |
| ------------------------- | --------------------------------------------------------- |
| Reassign anyone's work    | `get_task_capabilities` → `can_reassign`, `reassign_task` |
| Cancel anyone's work      | `get_task_capabilities` → `can_cancel`, `cancel_task`     |
| Agree and activate a Goal | `focus.can_agree_goal` (20260806000400, 20260810003000)   |
| Cancel a Goal             | `get_goal_capabilities` → `can_cancel_goal`               |
| Update any Goal           | `focus.can_update_goal`                                   |

This was coherent when the only administrator was a local fixture. It is not
coherent once a real person holds the role, because it makes the person who
resets passwords also the person who can close somebody's performance Goal.

**Remediation.** Split the predicate rather than the role: keep `focus.is_admin()`
for account administration, and introduce `focus.has_business_authority_over(user)`
— manager-of, or the owner themselves — for the Goal and Task authority
predicates above. An administrator who is _also_ a manager keeps their manager
authority through the reporting line, which is where it should come from.

This is a forward migration plus its tests, and it must land before Phase 12
creates a Production administrator. It is not done in this change because it
alters authorisation semantics and deserves its own reviewed commit rather than
being folded into an infrastructure migration.

**Until it is done, §52 cannot pass and go-live cannot be recommended.**

---

## Boundaries that hold

| Boundary                                                             | Result | Evidence                                                                                                                   |
| -------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| Every application table has RLS enabled                              | PASS   | `check:schema` gate                                                                                                        |
| Direct table writes are refused for lifecycle state                  | PASS   | `lean-goal-v51.test.ts`, `goal-lifecycle-v50.test.ts`, pgTAP `throws_ok`                                                   |
| A view-only participant cannot write against another employee's Goal | PASS   | `rls_visibility.test.sql`                                                                                                  |
| A Goal owner may act on their own Goal                               | PASS   | `rls_visibility.test.sql`                                                                                                  |
| An unrelated employee cannot author a Goal for someone else          | PASS   | `lean-goal-v51.test.ts`, `rls_visibility.test.sql`                                                                         |
| An employee cannot activate their own Goal                           | PASS   | `lean-goal-v51.test.ts`                                                                                                    |
| A manager cannot author their employee's monthly session             | PASS   | `goal-lifecycle-v50.test.ts`                                                                                               |
| Mandatory work can only be cancelled by an authorised manager        | PASS   | `execution-goal-v53.test.ts`                                                                                               |
| Privileged RPCs are revoked from `public` and `anon`                 | PASS   | every migration's `revoke … from public, anon`                                                                             |
| Audit history cannot be edited or deleted by any role                | PASS   | append-only trigger; proved incidentally when a test cleanup was refused                                                   |
| The service-role key cannot reach the browser                        | PASS   | `src/lib/env.ts` splits public from server env behind `server-only`; no `NEXT_PUBLIC_` variable carries a privileged value |
| Attachments are private                                              | PASS   | `task-attachments` bucket is `public = false`; access is by short-lived signed URL                                         |
| A retired procedure is genuinely unreachable                         | PASS   | `v52-lifecycles.test.ts` calls `close_goal` and expects the error                                                          |
| Development fixtures cannot reach a database holding real accounts   | PASS   | SQL guard in `supabase/seed.sql`; four-case script guard tested                                                            |
| `db reset` cannot run against anything but local                     | PASS   | Verified against the real Production project on 11 August: refused by name and host                                        |
| A destructive script cannot run against an unidentified target       | PASS   | `scripts/lib/environment.mjs`; refuses remote-without-declaration and declaration-contradicting-URL, in both directions    |
| The scheduled-work endpoint refuses unauthenticated callers          | PASS   | `/api/cron` requires `Authorization: Bearer $CRON_SECRET`; 401 otherwise, 503 when unconfigured                            |

---

## A guard that was too broad

The first version of the CLI guard refused any Supabase command carrying
`--linked` or `--db-url`, on the theory that aiming at a remote project was
itself the danger. Taking the first Production backup exposed the mistake: it
blocked `db dump`. Refusing to _back up_ Production is precisely backwards, and
on a free plan with no managed backups it would have removed the only protection
there is.

The guard is now narrow and matches what it claims: `db reset` is the only
Supabase subcommand that destroys without being asked to, so it is the only one
gated. `db push`, `db dump` and `db query` are deliberate operations invoked
against a named environment, and they sit behind the approval gates in
`MIGRATION_STATUS.md` rather than behind a script check that people would learn
to route around.

Worth recording because the earlier version of this report claimed the guard
refused "Production outright". It did not, and now it does not claim to.

## Not yet tested

These need two authenticated accounts on a hosted environment and are Phase 10.

| Boundary                                                             | Status         |
| -------------------------------------------------------------------- | -------------- |
| Employee cannot become manager by editing browser state              | NOT YET TESTED |
| Employee calling a manager-only RPC directly with a forged id        | NOT YET TESTED |
| Manager reaching outside their reporting line by changing a route id | NOT YET TESTED |
| Unauthorised user requesting another person's attachment signed URL  | NOT YET TESTED |
| One employee's cached page being served to another                   | NOT YET TESTED |
| Preview refusing to start if pointed at the Production database      | NOT YET TESTED |

The last one deserves a note: the script layer refuses destructive work against
Production, but a _running application_ pointed at the wrong database would
serve it happily. Adding a startup assertion that `TAMCO_ENV` matches the
Supabase host is the honest fix and is listed for Phase 9.

---

## Logging and confidentiality

`console.error` is used for failures throughout the server layer. Spot-checking
the paths that carry work content — attention queries, goal queries, the cron
endpoint — messages are logged, payloads are not. The cron endpoint logs the
error message only, never the row it failed on.

Not audited: whether any third-party platform log captures request bodies. That
is a hosted-configuration question for Phase 14.
