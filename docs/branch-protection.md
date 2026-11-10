# Branch protection for `main`

One-time configuration, to be applied by the repository owner. An agent token
cannot do it: branch protection needs `administration:write`, and the token in
use here carries `gist, read:org, repo` — asking for more scope than that is
not warranted for a setting changed once.

## What it is for

Without it, every gate in this repository is advisory. `main` carried a red
end-to-end run from 8 to 9 November 2026 and accepted pushes throughout,
because nothing was required to pass before a branch could land.

The goal is narrow: **work cannot reach `main` unless the three jobs in
`.github/workflows/verify.yml` have actually run and actually passed on the
commit being merged.**

## The three required checks

The names must match the job `name:` values exactly. They are:

| Check                                | Job in `verify.yml` | Covers                                                                           |
| ------------------------------------ | ------------------- | -------------------------------------------------------------------------------- |
| `Format, lint, types, unit, secrets` | `static`            | Prettier, ESLint, TypeScript, unit tests, secret scan, SQL                       |
| `Migrations, RLS and integration`    | `database`          | Migrations, schema, generated types, pgTAP, integration, build, production smoke |
| `End-to-end`                         | `end-to-end`        | The browser suite, five viewport projects                                        |

If a job is ever renamed, the required check must be renamed with it, or
protection silently stops requiring the thing it names.

## Two properties that are easy to get wrong

**A skipped check counts as a successful one.** GitHub treats a required check
with a `skipped` conclusion as satisfied. Any `if:` on a required job, and any
`paths-ignore` that stops the workflow triggering, therefore becomes a way to
merge with nothing verified. v326 removed both for this reason: all three jobs
run unconditionally, and the only way `end-to-end` is skipped is a failed
`needs: database`, which fails the run regardless.

**A check that never reports blocks the merge forever.** This is the other half
of the same trap, and it is why `paths-ignore` had to go rather than be
narrowed: a documentation-only pull request would not trigger the workflow, the
three required checks would never arrive, and the pull request could not be
merged at all.

## Apply it

Either the UI, Settings → Branches → Add branch ruleset / protection rule for
`main`, ticking:

- Require a pull request before merging — required approvals **0**
- Require status checks to pass before merging
  - Require branches to be up to date before merging
  - add the three checks named above
- Do not allow bypassing the above settings
- Block force pushes
- Restrict deletions

Or the API, in one call:

```sh
gh api -X PUT repos/Asyrafbangs/tamco-focus/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Format, lint, types, unit, secrets",
      "Migrations, RLS and integration",
      "End-to-end"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
JSON
```

`required_approving_review_count: 0` keeps a solo maintainer from having to
find a second pair of eyes, while still forcing the work through a pull
request — which is what makes the status checks binding. Requiring the checks
without requiring a pull request leaves direct pushes to `main` as an open
question; this configuration does not depend on the answer.

`"strict": true` means a branch must be rebased or merged up to date with
`main` before it can land, so the checks that passed are the checks for the
code that will exist afterwards.

## What it costs

Every pull request now runs the browser suite, which is roughly 45 minutes.
The repository is public, where GitHub's standard runners are unlimited, so
this costs waiting rather than money. If that ever becomes the constraint,
narrow by path inside the job — a change under `supabase/` has no browser
surface — rather than by reintroducing a filter that can skip a required check.

## Verify it took

```sh
gh api repos/Asyrafbangs/tamco-focus/branches/main/protection \
  --jq '{checks: .required_status_checks.contexts, strict: .required_status_checks.strict, admins: .enforce_admins.enabled}'
```

Then open a pull request that deliberately breaks one gate — a stray
`test.only`, which `tests/scripts/no-focused-tests.test.mjs` fails on — and
confirm the merge button is blocked rather than green.
