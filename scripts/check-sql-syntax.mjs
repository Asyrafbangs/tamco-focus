#!/usr/bin/env node
/**
 * Parses every migration with the real PostgreSQL grammar (libpg_query compiled
 * to WebAssembly) and reports syntax errors with file and line.
 *
 * This is a syntax gate, not a semantic one. It cannot know whether a column
 * exists or a policy expression type-checks — only `supabase db reset` against
 * a running stack proves that. It exists so a syntax error is never discovered
 * late, by a database reset, when a parser could have caught it in a second.
 *
 * Two implementation notes, both worked out the hard way:
 *
 *  * Statements are parsed one at a time. It localises an error to a single
 *    statement, and it avoids a serialisation limit in the WASM build that
 *    trips on very large parse trees.
 *
 *  * A parser instance is replaced before its heap fills. The WASM heap is
 *    never reclaimed between calls, so a single instance aborts fatally
 *    partway through a schema this size. Once per file was enough until one
 *    migration (v198, 63 KB) overflowed on its own: the instance threw on one
 *    statement and then hung for good on the next, so the verify stalled with
 *    no error at all. Now an instance is also replaced after a set amount of
 *    SQL, and after any statement it failed to handle.
 */

/** SQL characters one parser instance is trusted with. */
const PARSER_BUDGET = 24_000;

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import PgQuery from 'pg-query-emscripten';
import { splitStatements } from './sql-split.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const directories = [
  join(repoRoot, 'supabase', 'migrations'),
  join(repoRoot, 'supabase', 'tests'),
  join(repoRoot, 'supabase'),
];

const seen = new Set();
let filesChecked = 0;
let filesFailed = 0;
let statementsChecked = 0;

for (const directory of directories) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    continue;
  }

  for (const name of entries) {
    const path = join(directory, name);
    if (seen.has(path)) continue;
    seen.add(path);

    const statements = splitStatements(readFileSync(path, 'utf8'));
    filesChecked += 1;

    let parser = await new PgQuery();
    let spent = 0;
    const errors = [];

    for (const statement of statements) {
      statementsChecked += 1;
      if (spent + statement.text.length > PARSER_BUDGET && spent > 0) {
        parser = await new PgQuery();
        spent = 0;
      }
      spent += statement.text.length;
      try {
        const parsed = parser.parse(statement.text);
        if (parsed?.error) {
          errors.push({ line: statement.line, message: parsed.error.message });
        }
      } catch (cause) {
        errors.push({
          line: statement.line,
          message: `parser could not serialise this statement (${cause.message}) — not checked`,
          inconclusive: true,
        });
        // An instance that has thrown is not trusted with another statement.
        parser = await new PgQuery();
        spent = 0;
      }
    }

    const hard = errors.filter((error) => !error.inconclusive);
    const soft = errors.filter((error) => error.inconclusive);

    if (hard.length > 0) {
      filesFailed += 1;
      console.error(`FAIL  ${name}  (${statements.length} statements)`);
      for (const error of hard) console.error(`      line ~${error.line}: ${error.message}`);
    } else {
      const note = soft.length > 0 ? `, ${soft.length} not checked` : '';
      console.log(`ok    ${name}  (${statements.length} statements${note})`);
    }
  }
}

console.log(
  `\n${filesChecked - filesFailed}/${filesChecked} files parsed cleanly ` +
    `(${statementsChecked} statements).`,
);

if (filesFailed > 0) {
  console.error('\nFix the syntax errors above before resetting the database.');
  process.exit(1);
}
