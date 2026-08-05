# TAMCO Focus — Change Intake Protocol

## Purpose

This protocol ensures that future Product Owner changes can be delivered as updated Markdown files and/or updated desktop/mobile prototypes without making the original implementation prompt rigid or obsolete.

## Trigger

Run this protocol whenever any of the following is added or changed:

- `MASTER_PRODUCT_SPEC.md`
- `PRODUCTION_LOGIC.md`
- another approved requirement `.md`
- `desktop/index.html`
- `mobile/index.html`
- `CHANGELOG.md`
- an approved design image or interaction note

## Source precedence

1. Latest approved `MASTER_PRODUCT_SPEC.md`
2. Latest approved `PRODUCTION_LOGIC.md`
3. Later approved requirement files that clearly state their scope
4. Desktop/mobile prototypes for visual and interaction intent
5. Changelog and README

A newer prototype does not silently override a documented security or workflow rule unless the Product Owner explicitly approves that change.

## Required process

### 1. Discover

- inventory changed/new files
- read revision headers and document status
- identify the previous implemented baseline
- do not begin coding from a single screenshot or isolated paragraph

### 2. Diff

Create an impact report with:

- changed requirement
- previous behaviour
- new approved behaviour
- affected UI modules
- desktop impact
- mobile impact
- domain/state impact
- data-model impact
- migration requirement
- permission/RLS impact
- notification/audit impact
- test impact

### 3. Resolve conflicts

- Follow the source precedence.
- Prefer the latest explicit approved statement over older implicit behaviour.
- Preserve unrelated approved functionality.
- Ask only when two current authoritative requirements genuinely conflict or a security-critical decision is absent.

### 4. Implement safely

- update shared domain logic first
- use forward-only migrations
- keep old audit history readable
- preserve existing user data
- update desktop and mobile in the same revision
- avoid duplicating business rules in multiple UI components

### 5. Verify

- run focused tests for the change
- run the full regression suite
- reset the local database from migrations and seed
- run production build
- verify RLS denial and allow cases
- verify desktop/mobile parity

### 6. Update documentation

In the same revision, update:

- `MASTER_PRODUCT_SPEC.md`
- `PRODUCTION_LOGIC.md` when logic changes
- relevant architecture/data/RLS documents
- `CHANGELOG.md`
- traceability matrix
- `README.md` when setup or review behaviour changes

### 7. Record migration and compatibility impact

Document:

- whether a migration was added
- whether existing data is transformed
- rollback or remediation strategy
- whether users need communication or retraining

## Prohibited behaviour

Do not:

- ignore updated files because the original prompt said something older
- edit already-applied migration files to hide a change
- silently remove a feature to simplify implementation
- treat visual sample data as a new business rule
- implement desktop only
- update code without tests and documentation
- declare the change complete while the repository is inconsistent

## Output of each change cycle

Produce:

- impact summary
- implemented files
- migrations
- tests
- updated docs
- validation results
- unresolved decisions, if any
