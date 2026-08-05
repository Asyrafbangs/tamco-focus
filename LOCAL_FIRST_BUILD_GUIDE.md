# TAMCO Focus — Local-First Build and Future Connection Guide

## 1. Current stage

Build and validate TAMCO Focus entirely on the local computer.

Current external connections must remain absent:

- no GitHub remote
- no hosted Supabase link
- no Vercel project link
- no production deployment

## 2. Expected local prerequisites

The implementation agent must document and verify:

- a current supported Node.js version compatible with the selected dependencies
- a package manager pinned in `package.json`
- Git
- Docker Desktop or another Docker-compatible container runtime
- enough local resources to run Supabase and browser tests

## 3. Expected local commands

The final implementation must provide equivalent scripts for:

```bash
# Install
pnpm install

# Start local Supabase
pnpm supabase:start

# Rebuild database from migrations and seed
pnpm db:reset

# Generate TypeScript database types
pnpm db:types

# Start application
pnpm dev

# Full verification
pnpm verify

# Production-like local run
pnpm build
pnpm start
```

If a different package manager is selected, document equivalent commands.

## 4. Local Git setup

The implementation should initialize:

```bash
git init -b main
git status
```

There must be no remote during this stage:

```bash
git remote -v
# expected: no output
```

## 5. Later GitHub connection

When the Product Owner approves GitHub connection:

1. create a private empty GitHub repository
2. do not pre-populate it with conflicting files
3. add the remote:

```bash
git remote add origin <PRIVATE_REPOSITORY_URL>
git remote -v
git push -u origin main
```

4. enable branch protection and required checks after CI is configured
5. keep all secrets in GitHub/Vercel/Supabase secret stores, never in commits

## 6. Later hosted Supabase connection

When approved:

1. create a hosted Supabase project
2. authenticate the CLI
3. link the project
4. compare migration history
5. run a dry-run before applying migrations
6. apply migrations
7. configure Auth redirect URLs and private Storage
8. configure production environment variables
9. execute RLS and smoke tests against a non-production environment first

Never push local seed users or local fixtures to production.

## 7. Later Vercel connection

When GitHub and hosted Supabase are ready:

1. import the private GitHub repository into Vercel
2. configure Preview and Production environment variables separately
3. confirm build/runtime compatibility
4. deploy to Preview first
5. run end-to-end, permission, attachment, and RLS smoke tests
6. approve Production deployment only after Preview passes

## 8. Updating the product later

When the Product Owner supplies newer `.md` files or prototype `index.html` files, follow `CHANGE_INTAKE_PROTOCOL.md`. The repository is expected to evolve without being rebuilt from scratch.
