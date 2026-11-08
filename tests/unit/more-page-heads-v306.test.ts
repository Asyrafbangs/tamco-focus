import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * v306 — no heading is announced twice on the More screens.
 *
 * Every page under `/more` opened with a tracked, uppercase label stating what
 * the heading below it already stated: "MORE" over "Records and settings",
 * "RECORDS" over "Audit history", "ARCHIVE" over "Cancelled outcomes",
 * "ADMINISTRATOR" over "Identity and access" on a page that refuses anybody
 * else. A line of decoration above every heading, and on a phone a line of
 * screen.
 *
 * This asserts only the pattern that was wrong — an eyebrow immediately above
 * a heading — rather than banning the class. An eyebrow that says something
 * the heading does not is a different thing and is still allowed.
 */

const AREA = resolve(process.cwd(), 'src/app/(app)/more');

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('v306 More page heads', () => {
  it('no eyebrow sits directly above a heading', () => {
    const files = sources(AREA);
    expect(files.length, 'no components were found under /more').toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      /*
       * The eyebrow paragraph and whatever follows it, allowing a comment or a
       * blank line in between — the gap is where this would otherwise be
       * stepped around without changing anything a person sees.
       */
      const pattern = /className="eyebrow"[^]*?<\/p>\s*(?:\{\/\*[^]*?\*\/\}\s*)?<(\w+)/g;
      for (const match of text.matchAll(pattern)) {
        if (/^h[1-6]$/.test(match[1]!)) {
          offenders.push(`${relative(process.cwd(), file)} — eyebrow above <${match[1]}>`);
        }
      }
    }

    expect(offenders, 'an eyebrow restates the heading beneath it').toEqual([]);
  });
});
