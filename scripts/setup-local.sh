#!/usr/bin/env bash
#
# TAMCO Focus — local setup (Unix shells).
#
# Brings a clean checkout to a running application: dependencies, the local
# Supabase stack, the database schema and fixtures, generated types, and a
# populated .env.local.
#
# Safe to re-run.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "TAMCO Focus — local setup"
echo

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------
echo "==> Installing dependencies"
npm install --no-audit --no-fund

# ---------------------------------------------------------------------------
# 2. Prerequisites
#
# Checked after install so the Supabase CLI (a dev dependency) is present to be
# checked. A failure here stops setup with a specific remedy rather than a
# confusing error from deeper in the stack.
# ---------------------------------------------------------------------------
echo
echo "==> Checking prerequisites"
if ! node scripts/preflight.mjs; then
  echo
  echo "Setup stopped: a prerequisite above is missing." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 3. Supabase stack
# ---------------------------------------------------------------------------
echo
echo "==> Starting the local Supabase stack"
npx supabase start

# ---------------------------------------------------------------------------
# 4. Environment file
#
# Keys are read from the running stack by a shared Node script, so this and
# setup-local.ps1 cannot drift.
# ---------------------------------------------------------------------------
echo
echo "==> Writing Supabase keys into .env.local"
node scripts/write-env.mjs

# ---------------------------------------------------------------------------
# 5. Schema and fixtures
# ---------------------------------------------------------------------------
echo
echo "==> Applying migrations and local fixtures"
npx supabase db reset

echo
echo "==> Generating database types"
npm run db:types

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
cat <<'DONE'

Setup complete.

  npm run dev       start the development server at http://localhost:3000
  npm run verify    run every verification gate

Local sign-in accounts (LOCAL FIXTURES ONLY — never real credentials):

  admin@tamco.local   System Administrator
  izzul@tamco.local   Manager
  amer@tamco.local    Team member (can view Izzah and Ajmal)
  izzah@tamco.local   Team member
  ajmal@tamco.local   Team member
  lim@tamco.local     Team member (no team visibility)

  Password for all of them: the SEED_USER_PASSWORD value in .env.local
  (default: LocalFocus123!)

DONE
