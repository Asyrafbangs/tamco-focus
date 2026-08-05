#!/usr/bin/env node
/**
 * Diagnostic helper: parses one migration statement by statement, printing each
 * before it is attempted, so a parser crash can be attributed to a specific
 * statement rather than a whole file.
 *
 * Usage: node scripts/isolate-sql.mjs supabase/migrations/<file>.sql
 */
import { readFileSync, writeSync } from 'node:fs';
import PgQuery from 'pg-query-emscripten';
import { splitStatements } from './sql-split.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/isolate-sql.mjs <path-to-sql>');
  process.exit(2);
}

const statements = splitStatements(readFileSync(file, 'utf8'));
const parser = await new PgQuery();

for (const [index, statement] of statements.entries()) {
  const preview = statement.text.trim().slice(0, 70).replace(/\s+/g, ' ');
  writeSync(1, `-> [${index}] line ${statement.line}: ${preview}\n`);

  try {
    const parsed = parser.parse(statement.text);
    if (parsed?.error) writeSync(1, `   ERROR ${parsed.error.message}\n`);
  } catch (cause) {
    writeSync(1, `   THROW ${cause.message}\n`);
  }
}

writeSync(1, 'done\n');
