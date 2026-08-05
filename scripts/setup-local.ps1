<#
    TAMCO Focus — local setup (Windows PowerShell).

    Brings a clean checkout to a running application: dependencies, the local
    Supabase stack, the database schema and fixtures, generated types, and a
    populated .env.local.

    Safe to re-run.
#>

$ErrorActionPreference = 'Stop'

Set-Location (Join-Path $PSScriptRoot '..')

Write-Host 'TAMCO Focus — local setup'
Write-Host ''

# ---------------------------------------------------------------------------
# 1. Dependencies
# ---------------------------------------------------------------------------
Write-Host '==> Installing dependencies'
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }

# ---------------------------------------------------------------------------
# 2. Prerequisites
#
# Checked after install so the Supabase CLI (a dev dependency) exists to be
# checked. A failure here stops setup with a specific remedy rather than a
# confusing error from deeper in the stack.
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '==> Checking prerequisites'
node scripts/preflight.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Error 'Setup stopped: a prerequisite above is missing.'
    exit 1
}

# ---------------------------------------------------------------------------
# 3. Supabase stack
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '==> Starting the local Supabase stack'
npx supabase start
if ($LASTEXITCODE -ne 0) { throw 'Could not start the local Supabase stack.' }

# ---------------------------------------------------------------------------
# 4. Environment file
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '==> Writing Supabase keys into .env.local'
node scripts/write-env.mjs
if ($LASTEXITCODE -ne 0) { throw 'Could not write .env.local.' }

# ---------------------------------------------------------------------------
# 5. Schema and fixtures
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '==> Applying migrations and local fixtures'
npx supabase db reset
if ($LASTEXITCODE -ne 0) { throw 'Database reset failed.' }

Write-Host ''
Write-Host '==> Generating database types'
npm run db:types
if ($LASTEXITCODE -ne 0) { throw 'Type generation failed.' }

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'Setup complete.'
Write-Host ''
Write-Host '  npm run dev       start the development server at http://localhost:3000'
Write-Host '  npm run verify    run every verification gate'
Write-Host ''
Write-Host 'Local sign-in accounts (LOCAL FIXTURES ONLY — never real credentials):'
Write-Host ''
Write-Host '  admin@tamco.local   System Administrator'
Write-Host '  izzul@tamco.local   Manager'
Write-Host '  amer@tamco.local    Team member (can view Izzah and Ajmal)'
Write-Host '  izzah@tamco.local   Team member'
Write-Host '  ajmal@tamco.local   Team member'
Write-Host '  lim@tamco.local     Team member (no team visibility)'
Write-Host ''
Write-Host '  Password for all of them: the SEED_USER_PASSWORD value in .env.local'
Write-Host '  (default: LocalFocus123!)'
Write-Host ''
