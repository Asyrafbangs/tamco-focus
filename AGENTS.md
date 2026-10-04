# AGENTS.md — TAMCO Focus Repository Instructions

This file is the canonical repository instruction for all coding agents.

The objective is:

**maximum engineering quality + maximum execution efficiency.**

Do not trade correctness, security, completeness or maintainability for speed.

Do not waste time, CI cycles, tool calls or context on work that does not increase confidence or progress.

---

## 1. Mandatory reading order

Before significant implementation work, read only the material relevant to the task, beginning with:

1. `MASTER_PRODUCT_SPEC.md`
2. `PRODUCTION_LOGIC.md`
3. `ONE_SHOT_LOCAL_BUILD_PROMPT.md`
4. `CHANGE_INTAKE_PROTOCOL.md`
5. `BUILD_ACCEPTANCE_GATES.md`
6. `MIGRATION_STATUS.md` where deployment/cloud state matters
7. `DEPLOYMENT.md` where deployment/cloud state matters
8. latest approved desktop/mobile prototypes relevant to the feature
9. `PROJECT_PROGRESS.md` for current verified project state, if present

Do not repeatedly reread all documents during the same task.

After the requirements relevant to the task are established, use targeted searches and relevant sections instead of reloading entire documents.

---

## 2. Source of truth

Product requirements can evolve.

Always prefer the newest approved requirement, prototype, migration decision or explicit user decision over an older conflicting instruction.

When a newer approved file changes behaviour, follow `CHANGE_INTAKE_PROTOCOL.md`:

**diff → impact map → implement → migrate → targeted verify → regression verify → document**

Do not preserve an older interpretation merely because it existed when the repository was first generated.

If two repository instructions conflict and recency/authority does not resolve the conflict, stop only if the difference can materially alter production behaviour or data. Otherwise choose the safest reversible interpretation and record it.

---

## 3. Current development/deployment stage

The previous local-only deployment prohibition is obsolete.

The cloud migration approved on 11 August 2026 supersedes the former prohibition on:

- linking hosted Supabase;
- adding/pushing the approved GitHub remote;
- connecting/deploying through Vercel.

Cloud work is permitted subject to the gates and current status defined in:

- `MIGRATION_STATUS.md`
- `DEPLOYMENT.md`

Local development remains the primary environment for:

- development;
- fixtures;
- destructive testing;
- database resets;
- stress testing;
- experimentation;
- targeted debugging.

Production must contain real operational data only.

Never use production as a test fixture environment.

Never commit or expose secrets.

---

## 4. Engineering standard

Deliver complete production-quality implementation.

Required principles:

- no demo-only substitutes;
- no TODO/FIXME placeholders for required work;
- strict TypeScript;
- maintainable domain modules;
- server-side authorization;
- SQL migrations and RLS remain authoritative;
- do not duplicate permission or state-transition logic in clients;
- preserve auditability;
- preserve desktop/mobile behaviour where both are supported;
- update tests when behaviour changes;
- update durable documentation when architecture or business rules change;
- preserve unrelated approved behaviour.

Do not weaken a security rule, test, RLS policy or acceptance gate merely to obtain a green result.

---

# 5. Engineering execution workflow

Do not use this pattern:

**change → run everything → fail → investigate → change → run everything again**

Use:

**Preflight → Reproduce → Classify → Root Cause → Fix → Targeted Validate → Broader Validate → Full Regression Once → Diff Review → Push → CI Confirmation**

Expensive validation comes after cheaper relevant validation succeeds.

CI is primarily confirmation, not the normal debugging environment, whenever equivalent validation can run locally.

---

## 6. Preflight once

Before significant work, establish the relevant environment state once.

Check as applicable:

- current branch and HEAD;
- git status;
- uncommitted user changes;
- current project checkpoint;
- relevant migration state;
- required local services;
- Docker/Supabase health;
- expected seed/fixture state;
- required ports;
- environment/configuration;
- obvious resource constraints capable of invalidating tests.

Batch independent checks when safe.

Do not narrate every command.

Report only meaningful exceptions or blockers.

Example:

`Preflight: PASS — repository and required local services are ready.`

Do not repeatedly rerun preflight checks unless something relevant changes.

---

# 7. Reproduce the smallest failure first

For bugs and failed gates, reproduce the smallest exact failure possible before changing code.

Prefer:

- one failing test;
- one SQL/RLS assertion;
- one function;
- one API route;
- one component;
- one user flow.

Do not immediately run the complete acceptance suite merely to reproduce a narrow failure.

---

# 8. Classify failures before editing

Internally classify meaningful failures as:

- `CODE_DEFECT`
- `TEST_DEFECT`
- `FIXTURE_DEFECT`
- `DATA_STATE`
- `ENVIRONMENT`
- `INFRASTRUCTURE`
- `CONFIGURATION`
- `DEPENDENCY`
- `FLAKY_TEST`
- `UNKNOWN`

Determine whether the implementation, test, fixture, environment or infrastructure is actually wrong before editing application code.

Do not change correct production behaviour merely to satisfy a bad test.

---

# 9. Establish root cause before broad changes

Determine:

- what failed;
- why it failed;
- whether it is deterministic;
- what requirement or invariant is involved;
- whether the same defect pattern is reasonably likely elsewhere.

Use evidence.

Once the root cause is established, stop exploring unrelated hypotheses unless new evidence requires it.

Fix the underlying rule rather than only the visible symptom.

---

# 10. Behavioural test quality

Tests should validate behaviour and invariants, not incidental fixture structure.

Avoid unnecessary dependence on:

- global row counts;
- total seeded account count;
- unrelated fixture records;
- generated IDs;
- timestamps;
- execution ordering;
- row ordering;
- unrelated implementation details.

Prefer:

- explicit membership;
- explicit permitted identities;
- explicit forbidden identities;
- existence/non-existence;
- before/after delta;
- authorization boundaries;
- state transitions;
- expected side effects;
- absence of prohibited side effects.

Example:

If the requirement is:

`assigning an unknown email must not create an authentication account`

do not primarily assert:

`auth.users count = 7`

Prefer:

- capture relevant state before;
- execute the operation;
- verify no additional authentication account was created;
- verify the unknown email does not exist.

Literal fixture counts are appropriate only when fixture cardinality itself is the requirement.

---

# 11. Never use vacuous assertions

Expected and actual results must have independent meaning.

Do not derive the expected value through the same:

- RLS policy;
- filtered source;
- query path;
- transformation;
- implementation

that is being tested.

For authorization tests, verify both sides when applicable:

- permitted behaviour succeeds;
- forbidden behaviour is blocked or invisible.

A test that effectively compares an implementation to itself is not meaningful validation.

---

# 12. Progressive validation ladder

Use the cheapest relevant validation first.

### L0 — Immediate/static validation

Run relevant syntax, formatting, static analysis or type validation for changed code where practical.

### L1 — Exact failing test

Run the exact test proving the fix.

If L1 fails:

**STOP.**

Do not proceed to broader gates.

### L2 — Related module tests

Run tests for the directly affected domain/module.

### L3 — Related database/integration/security tests

Run applicable:

- database;
- RLS;
- integration;
- API;
- migration;
- security

tests affected by the change.

### L4 — Targeted E2E

Run the affected browser/user workflow where end-to-end behaviour can be affected.

Do not run hundreds of unrelated browser tests during every debugging iteration.

### L5 — Full repository verification

Once targeted validation is green, run the complete required verification defined in `BUILD_ACCEPTANCE_GATES.md`.

Run this full gate once per stable candidate unless subsequent changes invalidate it.

### L6 — CI

Push locally validated work and use CI as final independent confirmation.

Do not deliberately use repeated remote CI runs to discover failures that can be reproduced locally.

---

# 13. Stop at the first relevant failed layer

If a cheaper relevant validation layer fails, do not continue into more expensive layers merely to collect more failures.

Example:

If an affected pgTAP/RLS test fails, do not proceed automatically to hundreds of E2E tests.

Fix or understand the first relevant failure first.

Exception: continue only when additional evidence is specifically necessary to diagnose the root cause.

---

# 14. Select tests from the impact surface

Use the actual diff and dependency surface to choose iterative validation.

A SQL test-only change normally does not require every frontend viewport test after every edit.

A UI-only presentation change normally does not require a database reset after every edit unless it changes persistence/security behaviour.

A migration/RLS change does require appropriate real PostgreSQL/database security validation.

Final acceptance coverage remains governed by `BUILD_ACCEPTANCE_GATES.md`.

Do not confuse:

**iterative debugging coverage**

with:

**final regression coverage**.

---

# 15. Gate expensive operations

Before a costly operation such as:

- complete database reset;
- full production build;
- entire integration suite;
- hundreds of E2E tests;
- remote CI run;

determine internally:

1. What question will this answer?
2. Has a cheaper test already answered it?
3. Have cheaper relevant checks passed?
4. Is this operation necessary now?
5. Will its result change the next action?

If not, defer it until the appropriate validation stage.

---

# 16. Context and token efficiency

Treat context-window capacity as an engineering resource.

Prefer:

- `git diff` over rereading entire modified files;
- targeted symbol/text search over directory-wide reading;
- relevant line ranges over full logs;
- specific failing output over entire CI logs;
- current project documentation over reconstructing architecture;
- established conclusions over rediscovering them.

Do not repeatedly load information already established in the current work session.

Do not retain or repeat raw diagnostic detail after its conclusion is known unless it remains relevant.

Temporary information such as:

- process memory;
- raw command output;
- failed hypotheses;
- one-off Docker state;
- intermediate logs

should not become durable project documentation unless it exposes a durable constraint.

---

# 17. Batch independent diagnostics

When safe, collect independent diagnostic information together.

For example:

- git status;
- recent HEAD;
- service health;
- Supabase status;
- relevant process/port state

can often be gathered in one diagnostic phase.

Do not serialize independent commands merely to narrate each one.

Do not batch operations where later actions depend on earlier results.

---

# 18. Check defect patterns, not the whole universe

When a real defect pattern is identified, search the reasonable nearby scope for the same class of defect.

Examples:

- one behavioural test hardcodes global fixture cardinality → inspect relevant tests for similar brittle counts;
- one authorization assertion is vacuous → inspect nearby authorization tests for the same pattern;
- one shared helper contains a state bug → inspect its relevant callers.

Do not perform unrelated repository-wide refactoring without evidence.

Prevent predictable recurrence without expanding scope unnecessarily.

---

19. Persistent project state

If PROJECT_PROGRESS.md already exists, use it as the primary persistent implementation checkpoint.

If PROJECT_PROGRESS.md does not already exist, do not create it solely because this instruction references it.

Use the repository's existing persistent state mechanism.

Never maintain PROJECT_PROGRESS.md and handoff.md as duplicate continuously updated checkpoints. There must be one canonical current-state document.

If handoff.md is already the repository's established current-state checkpoint, continue using it unless there is a clear reason to migrate the state into PROJECT_PROGRESS.md.

Use handoff.md primarily for explicit session transfer unless it is already serving as the established canonical checkpoint.

Whichever single checkpoint is canonical, keep it factual and based on the actual repository, not conversation claims.

Update it after meaningful verified work batches, important blockers, major validation changes, or before handoff/context loss.

It should capture relevant items such as:

current objective;

current verified state;

completed work;

partial work;

remaining work;

important migrations/changes;

meaningful validation results;

blocker;

exact next action.

Do not turn it into a raw command log.

Do not duplicate the same current-state information across multiple state files.

When duplicate state documents exist, first identify whether either contains unique durable information.

Consolidate unique useful information into the canonical checkpoint.

Do not delete a user-authored, tracked, historically important, or potentially unique state document merely to reduce duplication.

A redundant agent-generated untracked handoff may be removed after its useful durable information has been preserved and the canonical checkpoint has been verified.

The goal is one actively maintained checkpoint, not deletion for its own sake.

---

# 20. Communication efficiency

Do the engineering work thoroughly.

Report it concisely.

Do not narrate routine commands.

Do not describe every successful intermediate check.

Do not repeat previously established facts.

Do not repeatedly reassure the user about already resolved conditions.

Send a progress update primarily when:

1. root cause is established;
2. an unexpected condition materially changes the plan;
3. user action is genuinely required;
4. an important validation milestone completes;
5. final completion is reached.

Normal progress reports should be concise.

Large raw logs belong in logs, not in conversational updates.

Do not report transient implementation details, command syntax mistakes, temporary IDs, formatting corrections, intermediate failed hypotheses, or self-corrected tool errors unless they:

leave a residual risk;

alter the final implementation;

require user action;

expose a recurring engineering problem.

Perform detailed reasoning internally.

Progress reports should communicate decisions, outcomes, blockers and next actions — not the path of every command used to reach them.

Prefer one consolidated STATUS update after a meaningful work batch rather than multiple narrative updates during routine implementation.

---

# 21. Compact status format

For meaningful progress, prefer:

```text
STATUS
Classification: <type>
Root cause: <one sentence>
Fix: <pending / in progress / complete>
Targeted validation: <status>
Related validation: <status>
Full regression: <status>
Blocker: <none or exact blocker>
Next: <single next action>
```

Example:

```text
STATUS
Classification: TEST_DEFECT
Root cause: RLS test depended on global fixture cardinality.
Fix: Complete
Targeted validation: PASS
Related DB/RLS: PASS
Full regression: Pending
Blocker: None
Next: Run final regression once.
```

At completion prefer:

```text
DONE
Root cause: <concise cause>
Fix: <concise change>
Targeted validation: PASS
Full regression: PASS
CI: PASS
Merged: <commit/PR if applicable>
Residual risk: <none or concise risk>
```

Do not turn the status block into another long narrative.

---

# 22. User intervention

Do not ask the user to perform an action the agent can safely perform itself.

Request user input only when genuinely required, such as:

- credentials or authentication unavailable to the agent;
- destructive action requiring explicit approval;
- infrastructure physically controlled by the user is unavailable;
- an external authorization is required;
- a genuine business/product decision has multiple valid outcomes.

For ordinary reversible engineering decisions, use evidence and proceed.

---

# 23. Final diff review

Before declaring completion, inspect the final diff.

Confirm:

- only intended files changed;
- user work was not overwritten;
- no debug instrumentation remains;
- no temporary files remain;
- no accidental formatting churn;
- no secrets;
- no weakened authorization;
- naming remains consistent;
- documentation matches behaviour;
- tests actually prove the requirement.

---

# 24. Required final verification

Before declaring a stable work item complete, execute every applicable final gate defined by `BUILD_ACCEPTANCE_GATES.md`, including repository-defined checks for:

- formatting;
- lint;
- TypeScript;
- unit tests;
- integration tests;
- RLS/database tests;
- generated database types;
- database reset/seed integrity where required;
- E2E;
- accessibility;
- production build;
- production smoke testing.

A missing, skipped, silently disabled or failing required gate is not a pass.

The progressive validation rules above control **when** these tests run during development.

This section controls **what must ultimately pass before completion**.

Do not repeatedly execute the complete suite during iterative debugging unless a change genuinely invalidates the previous full result.

---

# 25. Definition of done

Work is complete only when all applicable conditions are satisfied:

1. The requested objective is implemented.
2. Root cause is understood where the task involved a defect.
3. Required behaviour is complete.
4. Security and authorization remain correct.
5. Same-pattern defects were reasonably checked.
6. Targeted validation passes.
7. Relevant database/integration/security validation passes.
8. Relevant targeted E2E passes.
9. The required full acceptance suite passes.
10. Final diff has been reviewed.
11. No unintended changes remain.
12. Durable documentation is updated where behaviour or architecture changed.
13. `PROJECT_PROGRESS.md` reflects material current state where applicable.
14. CI passes where required by the workflow.
15. Remaining risks/blockers are explicitly reported.

Once these conditions are satisfied, stop.

Do not continue investigating hypothetical unrelated improvements without evidence.

---

# 26. Optimization principle

Do not optimize for:

- number of commands;
- number of tests repeatedly executed;
- amount of written analysis;
- amount of conversation;
- appearing busy.

Optimize for:

**verified progress per unit of execution time, CI usage and context.**

Be rigorous without being wasteful.

Be concise without skipping engineering work.

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos, the `next` package may not be visible from the repo root) before writing code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->