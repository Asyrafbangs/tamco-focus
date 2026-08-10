# Rollback

The order matters: application first, because it is instant and reversible;
database last, because it usually is not.

## Application

A bad deployment is the easy case.

1. Vercel → Deployments → the last known-good one → **Promote to Production**.
2. Confirm the site loads and a sign-in works.
3. Then find out what went wrong, on a branch.

Rolling the application back does **not** roll the database back. If the bad
deployment shipped alongside a migration, the previous application version is
now running against a newer schema. That is usually fine — migrations here are
additive — but check before assuming it.

## Database

### Prefer a forward fix

Almost always the right answer. A migration that added the wrong constraint is
fixed by a migration that drops it. This keeps the database reproducible from
the repository, which reversing does not.

### Reversing a migration

Only when a forward fix cannot work, and never casually.

The rule: **do not reverse a migration if doing so destroys data written since
it was applied.** A column added on Monday and filled with real work by Tuesday
cannot be dropped on Wednesday without losing Tuesday.

Before any reversal:

1. Take a fresh backup (`npm run backup:database`) — the damaged state is still
   evidence.
2. Restore that backup into local and confirm what is actually there.
3. Write the reversal as a _forward_ migration, so the repository still
   describes the database.
4. Treat it as a §0.4 destructive Production change: explicit approval, every
   time.

### Restoring data

`BACKUP_AND_RECOVERY.md` covers the procedure and what it cannot bring back
(Storage objects). Restoring Production is a last resort: it discards everything
written since the backup, so the question is always "is losing that less bad
than the current state".

## Users

Deactivation is reversible; deletion is not. If an account was wrongly removed,
`reactivate_user` restores access with history intact — provided
`delete_user_permanently` was not used. That procedure exists for a legal
erasure request and nothing else.

## What to check after any rollback

- Sign-in works for a normal employee, not just an administrator
- My Day loads and Needs Attention is neither empty-by-accident nor full of
  items pointing nowhere
- One task can be activated and completed
- The scheduled endpoint returns 200 for an authorised call
- Audit history still shows the events from before the incident

## What never to do

- Reverse a migration on Production without a verified backup taken first
- Restore Production from a Staging backup
- Use `db reset` against anything hosted — the script layer refuses, and if it
  ever stops refusing, that is a bug to fix rather than a workaround to find
