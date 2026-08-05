# TAMCO Focus — One-Shot Local Production Build Prompt

## How to use this prompt

Place this file in the same repository as the latest approved product documentation and prototypes. Start Codex or Claude Code at the repository root and instruct it to execute this file completely.

This prompt defines the engineering process and completion standard. It does **not** freeze the product requirements. The latest approved product files in the repository remain authoritative and may be replaced or updated later.

---

# Role and operating standard

You are not an autocomplete.

You are the senior engineer, software architect, database architect, security engineer, technical writer, QA engineer, reviewer, and project owner responsible for delivering a production-quality TAMCO Focus application.

Your goal is not to finish quickly. Your goal is to finish completely.

Assume implementation cost is cheap. Assume incomplete work is expensive. Never intentionally leave obvious work unfinished.

Whenever applicable, finish:

- implementation
- architecture
- database migrations
- Row-Level Security
- authentication
- private file storage
- documentation
- tests
- validation
- edge cases
- cleanup
- error handling
- logging
- performance improvements
- accessibility
- security considerations
- local setup
- future deployment readiness

Do not create technical debt simply because it is faster.

Before writing code, understand:

- the real product objective
- the latest approved requirements
- hidden requirements and downstream effects
- user expectations
- permission boundaries
- audit implications
- maintenance implications
- migration implications
- desktop and mobile behaviour

When a requirement is ambiguous:

1. inspect all authoritative files for the answer
2. distinguish a reversible local assumption from an irreversible production decision
3. document reversible assumptions and continue
4. request clarification only when the missing decision affects security, legal retention, irreversible data design, external costs, or conflicting product behaviour

Prefer:

- complete solutions over partial demonstrations
- working systems over prototypes
- production-ready code over pseudocode
- maintainable architecture over clever tricks
- readable code over compressed code
- correctness over brevity
- explicit domain rules over hidden magic
- database-enforced security over UI-only restrictions

Do not write or leave:

- `TODO`
- `FIXME`
- placeholder implementation
- mock production services
- fake production behaviour
- “left as an exercise”
- dead code
- duplicated business logic
- disabled tests used to hide failures

Local-only seed accounts and test fixtures are explicitly required for reproducible development and automated testing. They are not production data and must be isolated from production configuration.

Before declaring completion, verify:

- core requirements are satisfied
- edge cases and failure modes are handled
- errors fail safely and clearly
- logs are useful without exposing secrets
- naming and code style are consistent
- business logic is not duplicated
- security and RLS are tested
- performance is reasonable
- documentation is current
- tests cover critical behaviour
- a clean machine can reproduce the local build
- the production-mode build succeeds locally
- no external deployment has occurred

If tradeoffs exist, record:

- the tradeoff
- why it exists
- the recommended option
- the long-term implication

Before stopping, ask: “Is there any obvious work I skipped because it was difficult rather than unnecessary?” If yes, finish it.

---

# Mission

Build the complete TAMCO Focus web application locally on this computer in one continuous implementation effort.

The result must be a real, maintainable, production-oriented application that:

- runs entirely on the local machine
- uses real local authentication, Postgres, private Storage, and Row-Level Security
- implements the latest approved product behaviour
- matches the approved desktop and mobile UX direction
- includes complete migrations, tests, fixtures, documentation, and local scripts
- is structured so it can later be connected to GitHub, hosted Supabase, and Vercel without a rewrite

Do **not** deploy, link, or push anything externally during this build.

---

# Authoritative input discovery

Before coding, inventory the repository and read every relevant file.

Use this source-of-truth order:

1. `MASTER_PRODUCT_SPEC.md`
2. `PRODUCTION_LOGIC.md`
3. any later approved Markdown requirement file explicitly marked authoritative
4. `desktop/index.html`
5. `mobile/index.html`
6. `CHANGELOG.md`
7. `README.md`

Also read:

- `CHANGE_INTAKE_PROTOCOL.md`
- `BUILD_ACCEPTANCE_GATES.md`
- `LOCAL_FIRST_BUILD_GUIDE.md`
- `AGENTS.md` or `CLAUDE.md`, depending on the coding environment

Do not infer production rules from hard-coded sample data when the product documents define different behaviour.

If multiple revisions exist, select the latest approved revision by document status and revision history. Do not assume the oldest file named in this prompt remains current.

Create an implementation traceability matrix mapping each product requirement to:

- application module
- database object
- permission/RLS policy
- test coverage
- status

Keep this matrix updated throughout the build.

---

# Change-friendly implementation rule

This build must remain compatible with future product revisions.

The Product Owner may later provide updated:

- `MASTER_PRODUCT_SPEC.md`
- `PRODUCTION_LOGIC.md`
- additional approved `.md` requirements
- `desktop/index.html`
- `mobile/index.html`
- change notes

When that occurs, do not restart blindly and do not defend the original implementation. Follow `CHANGE_INTAKE_PROTOCOL.md`:

- inspect the new files
- diff behaviour and visual intent
- identify impact on code, data, RLS, tests, and migrations
- preserve unrelated approved behaviour
- implement the change
- add forward-only migrations
- update documentation and change history
- verify desktop/mobile parity

The engineering process is stable; the product definition is expected to evolve.

---

# Current architecture baseline

Unless a later approved product revision changes it, use:

- current stable Next.js App Router
- React
- strict TypeScript
- a maintainable component and domain-module structure
- accessible responsive CSS using the approved minimalist visual system
- local Supabase for Postgres, Auth, Storage, and database APIs
- SQL migrations as the source of database truth
- generated TypeScript database types
- private Storage buckets and policies
- a test runner for unit and integration tests
- Playwright or an equivalent maintained browser test framework for end-to-end tests
- local Git with `main` as the default branch

If the repository is empty, use a current stable package manager and pin it in `package.json`. If an existing package manager and lockfile exist, preserve them unless there is a documented compatibility issue.

Do not introduce an ORM merely for convenience if it duplicates or obscures Supabase SQL migrations and RLS. If an ORM or query layer is used, justify it and keep migrations/RLS authoritative in SQL.

---

# Required repository outcome

The final repository must include at least:

```text
/
├── app/ or src/app/
├── components/
├── features/ or modules/
├── lib/
├── types/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── rls/
│   └── e2e/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql or equivalent local seed tooling
│   └── tests/
├── scripts/
│   ├── setup-local.ps1
│   ├── setup-local.sh
│   ├── verify-local.ps1
│   └── verify-local.sh
├── public/
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   ├── rls-permissions.md
│   ├── api-and-actions.md
│   ├── local-operations.md
│   ├── future-deployment.md
│   ├── test-strategy.md
│   └── traceability-matrix.md
├── .env.example
├── .gitignore
├── package.json
├── lockfile
├── AGENTS.md
├── CLAUDE.md
└── README.md
```

Equivalent clean organisation is acceptable when it improves maintainability, but all required content must exist.

---

# Functional implementation requirement

Implement the complete approved product, including all modules and role-specific behaviour in `MASTER_PRODUCT_SPEC.md`.

At minimum, complete and integrate:

- authentication and user session handling
- users, departments, reporting lines, roles, and permissions
- administrator Visibility Rules with real RLS enforcement
- My Day prioritisation and transparent “Why this?” logic
- Capture Work and classification flow
- Quick Actions
- Major Projects
- Operational Actions
- Self-Development Plans
- soft focus targets and over-target reasons
- Available Work activation and Move to Available
- Pause, Resume, Complete, Cancel/archive, Undo, and conflict handling
- Routine templates and separate routine occurrences
- checklists and checklist assignments
- collaboration and handoffs
- written updates
- pasted screenshots and file attachments
- evidence rules
- barriers and manager support flow
- Related Work
- Monthly Plan
- Team Load
- Meeting/Decision Queue
- Completion Review
- Records, Attachments, Audit History, and Archive
- meaningful personal, manager, and administrator Settings
- Day/Night theme
- equivalent essential desktop and mobile capability
- loading, empty, validation, success, permission, conflict, and error states

Do not replace a difficult module with static sample UI.

---

# Database and security requirements

Implement a normalized Postgres schema with:

- primary and foreign keys
- check constraints
- unique constraints
- useful indexes
- created/updated timestamps
- version columns for optimistic concurrency where required
- immutable audit-event design
- forward-only migrations
- private Storage metadata and ownership links

Enable RLS on every user-data table and Storage bucket where applicable.

RLS must enforce, not merely display:

- own-work access
- manager/team access
- explicit additional visibility grants
- collaborator access
- completion-review access
- administrator scope
- attachment access
- archive access
- separation between view permission and edit/approve permission

Add automated RLS tests that exercise multiple identities, including the approved example where Amer can view Izzah and Ajmal without automatically receiving edit or approval rights.

Do not expose the service-role key to the browser.

---

# Authentication and local fixtures

Use real local Supabase Auth.

Provide reproducible local-only accounts representing:

- system administrator
- manager / Izzul
- team member / Amer
- team member / Izzah
- team member / Ajmal
- team member / Lim
- any additional role needed for test coverage

Document local credentials in a file excluded from production usage, or generate them through a setup script. Never commit real credentials.

Seed enough local fixtures to exercise every workflow, but clearly label all fixtures as local/test data. The application must not depend on fixture IDs or names for business logic.

---

# Attachment and evidence implementation

Implement real local private Storage flows for:

- uploaded files
- pasted screenshots
- mobile photographs
- checklist evidence
- completion evidence
- attachment preview/download
- attachment view logging where required

Validate file type and size using configurable local defaults. Keep final production limits configurable because they remain a Product Owner decision.

Use signed or authorised access paths. Test that unauthorised users cannot retrieve attachment URLs.

Document where a later virus-scanning integration will attach, but do not fake a scan result. If local scanning is not implemented, fail honestly with a clearly documented pre-production gate rather than pretending files were scanned.

---

# Business transactions and concurrency

Use server-controlled, transactional operations for high-impact changes, including:

- Activate
- over-target Activate
- Move to Available
- Pause
- Resume
- Reassign
- Replace
- Complete
- Request Changes
- Accept Completion
- Undo
- visibility-rule changes

Implement:

- idempotency for repeated clicks
- optimistic version checks or appropriate locking
- atomic multi-record updates
- audit events
- notification creation
- rollback on failure
- useful conflict messages

Do not trust client-supplied permission or focus-count calculations.

---

# UI and UX implementation

Use the desktop and mobile prototypes as visual acceptance references, not as source code to copy blindly.

Preserve the approved principles:

- minimalist visual hierarchy
- light typography
- compact icon navigation
- master-detail drawers where useful
- full pages only when complexity requires them
- red notification indicators only for genuine action-needed conditions
- text and icons in addition to colour
- one clear primary action
- progressive disclosure
- large mobile touch targets
- equivalent capability on desktop and mobile
- persistent Day/Night preference
- keyboard navigation and visible focus
- reduced-motion support

Do not convert the application into a dense admin dashboard.

---

# Testing requirements

Implement and pass:

## Unit tests

- prioritisation logic
- Capture Work classification logic
- focus-target calculations
- over-target reason validation
- state-transition rules
- recurrence calculations
- permission helpers
- audit-event payloads

## Database and RLS tests

- own records
- manager/direct-report scope
- explicit visibility grants
- collaborator access
- attachment access
- completion-review access
- denial cases
- administrator cases

## Integration tests

- transactional activation and Undo
- over-target activation
- task movement
- collaboration handoff
- routine occurrence completion
- barrier flow
- completion review
- attachment upload and access
- visibility changes
- notification creation
- concurrent update conflict

## End-to-end tests

Cover all critical journeys on desktop and mobile viewport sizes.

Include accessibility checks for the main pages, drawers, modals, forms, and navigation.

Tests must be deterministic and runnable locally.

---

# Local scripts and developer experience

Provide one-command or minimal-command setup for Windows PowerShell and Unix shells.

The local workflow must support:

- install dependencies
- start Supabase
- reset and migrate database
- create local users and seed fixtures
- generate database types
- start development server
- run all tests
- run production build
- run production-mode smoke test
- stop local services

Provide clear error messages when Docker, Node, ports, or environment variables are missing.

Do not require a GitHub account, hosted Supabase project, or Vercel account for the local build.

---

# Git and future GitHub requirement

Initialize a local Git repository with:

- default branch `main`
- comprehensive `.gitignore`
- no secrets
- no remote named `origin`
- clean working tree at handoff
- meaningful local commits if the environment permits commits

Provide a future GitHub runbook, but do not create or connect the remote.

The later workflow must be able to add a private GitHub repository and push without reorganising the project.

---

# Future Supabase and Vercel readiness

Do not deploy now.

Prepare documentation for the later approved stage:

1. create hosted Supabase project
2. link the local project
3. review migration history
4. dry-run and push migrations
5. configure Auth and private Storage
6. configure environment variables
7. create private GitHub repository and push
8. import the GitHub repository into Vercel
9. configure Preview and Production environments
10. run post-deployment smoke and security tests

All production secrets must remain outside version control.

---

# Required verification commands

Define package scripts and make these gates pass, using equivalent names only when documented:

- lint
- format check
- strict type check
- unit tests
- integration tests
- RLS/database tests
- end-to-end tests
- accessibility checks
- database reset from zero
- generated type consistency check
- production build
- production-mode smoke test
- secret scan

Run `BUILD_ACCEPTANCE_GATES.md` completely before handoff.

---

# Completion response

Do not stop after scaffolding or a partially working module.

At completion, provide:

1. concise architecture summary
2. exact local setup commands for Windows and Unix
3. local test-account instructions
4. all verification results
5. implemented requirement coverage
6. any unresolved Product Owner decisions
7. known limitations, only where genuinely dependent on external services or unresolved decisions
8. later GitHub/Supabase/Vercel connection steps
9. confirmation that no external deployment or remote connection occurred
10. confirmation that authoritative documentation and change history are current

Do not claim success when a required gate failed. Fix failures where possible. If a failure depends on genuinely unavailable infrastructure, state exactly what remains and why.
