import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * A focused test turns a suite into one test and still reports success.
 *
 * `test.only` and `describe.only` are the sharpest version of the silent skip:
 * Playwright and Vitest both honour them, both print a pass, and neither exit
 * code says that nine hundred other cases did not run. One committed by
 * accident during debugging would leave every gate green and every guard in
 * this repository switched off, which is the single failure this project can
 * least afford to discover late.
 *
 * `test.skip` is deliberately not caught here. A suite full of
 * `test.skip(info.project.name !== 'desktop', 'The mutation runs once')` is
 * this repository working as designed — the five viewport projects share one
 * database, so a mutation belongs to one of them. The difference is that a
 * skip states a condition and a reason, and `.only` states that nothing else
 * matters.
 */

/** Everywhere a test can live. */
const ROOTS = ['tests', 'supabase/tests'];

/** `.only` as a call, however it is reached: test, it, describe, suite. */
const FOCUSED = /(^|[^\w.])(test|it|describe|suite)\s*\.\s*only\s*\(/;

/**
 * And the Vitest/Playwright `.each` and `.failing` chains that can carry it,
 * which read as `test.describe.only(` or `test.only.each(`.
 */
const CHAINED = /(^|[^\w.])(test|it|describe|suite)\s*\.\s*\w+\s*\.\s*only\s*\(/;

function walk(directory) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path));
      continue;
    }
    if (/\.(test|spec)\.(ts|tsx|mts|mjs|js)$/.test(entry)) found.push(path);
  }
  return found;
}

test('no test or suite is focused with .only', () => {
  const files = ROOTS.flatMap((root) => walk(root));
  /*
   * Asserted, because a walk that finds nothing would pass this silently —
   * which is the same fault it exists to catch, one level up.
   */
  assert.ok(
    files.length > 100,
    `expected the test tree to hold hundreds of files, walked ${files.length}`,
  );

  const offenders = [];
  for (const file of files) {
    /*
     * Split on either ending. `autocrlf=true` is on in this repository, so a
     * checkout on Windows gives every line a trailing `\r`, and splitting on
     * '\n' alone leaves it there. That breaks the comment strip below, whose
     * `.*$` cannot reach past a `\r` — `.` matches it, but `$` without the `m`
     * flag anchors to the end of the string. The guard's own line 32, which
     * names `.only` chains in prose, then reads as code and the guard reports
     * itself. It fails that way on every Windows checkout of `main`, and
     * passes in CI, where Linux checks out LF.
     */
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      // A line that is only a comment is describing the rule, not breaking it.
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
      if (FOCUSED.test(code) || CHAINED.test(code)) {
        offenders.push(`${file}:${index + 1}  ${line.trim().slice(0, 80)}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `focused tests would silence the rest of the suite:\n${offenders.join('\n')}`,
  );
});
