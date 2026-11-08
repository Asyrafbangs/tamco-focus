import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * v305 — a settings section cannot be opened and show nothing.
 *
 * The panels used to be revealed by an enumerated list in the stylesheet, one
 * `[data-active='x'] [data-settings-panel='x']` selector per section. A section
 * added without its selector was `display: none` for good: in the DOM,
 * reachable from the menu, and blank when you got there. Only a browser could
 * see it, which is why `design-system.spec.ts` carries a test that walks every
 * section.
 *
 * The open section is now state the workspace already holds, so there is no
 * list to fall out of. These assertions keep it that way, cheaply enough to run
 * on every change rather than once a gate:
 *
 *  - the stylesheet hides panels only through `hidden`, never by enumerating
 *    section names, so the trap cannot be reintroduced one selector at a time;
 *  - every section in the menu has a panel, and every panel has a menu entry.
 *
 * The second is also enforced by the compiler — `page.tsx` builds its panels as
 * a `Record<SettingsKey, ReactNode>` — but a type error is only as good as the
 * shape that produces it, and this asserts the shape.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const STYLESHEET = read('src/app/globals.css');
/*
 * The section data lives in its own module, not in the client component.
 * `page.tsx` is a server component and iterates these to build the panels;
 * importing a plain value out of a `use client` module from the server yields
 * a client reference proxy, and `SETTINGS_SECTIONS.filter` threw at request
 * time. This guard reads where the data actually is, so moving it back would
 * fail here rather than in a browser.
 */
const WORKSPACE = read('src/app/(app)/more/settings/sections.ts');
const PAGE = read('src/app/(app)/more/settings/page.tsx');

/** Every CSS rule whose selector mentions a settings panel. */
function panelRules() {
  const rules: string[] = [];
  const pattern = /([^{}]*\[data-settings-panel[^{}]*)\{([^}]*)\}/g;
  for (const match of STYLESHEET.matchAll(pattern)) {
    rules.push(`${match[1]!.trim()} { ${match[2]!.replace(/\s+/g, ' ').trim()} }`);
  }
  return rules;
}

describe('v305 settings panels', () => {
  it('the stylesheet names no section, so none can be left out of a list', () => {
    const rules = panelRules();
    expect(rules.length, 'no rule in the stylesheet addresses a settings panel').toBeGreaterThan(0);

    const enumerated = rules.filter((rule) => /data-active=/.test(rule));
    expect(
      enumerated,
      'a settings panel is revealed by naming its section in CSS again; visibility belongs to SettingsPanel',
    ).toEqual([]);

    /*
     * Positive control: the panels must still actually be hidden, or this file
     * would pass happily against a stylesheet that had simply dropped the rule
     * and left every section on screen at once.
     */
    expect(
      rules.some((rule) => /\[hidden\]/.test(rule) && /display:\s*none/.test(rule)),
      'nothing hides a closed panel',
    ).toBe(true);
  });

  it('every section in the menu has a panel, and every panel a menu entry', () => {
    const declared = [...WORKSPACE.matchAll(/^\s*key: '([a-z]+)',$/gm)].map((match) => match[1]!);
    expect(declared.length, 'no sections were found in SETTINGS_SECTIONS').toBeGreaterThan(5);

    const union = WORKSPACE.match(/export type SettingsKey =([\s\S]*?);/);
    expect(union, 'SettingsKey is no longer a union of string literals').not.toBeNull();
    const keys = [...union![1]!.matchAll(/'([a-z]+)'/g)].map((match) => match[1]!);

    expect([...declared].sort(), 'a section key has no entry in SETTINGS_SECTIONS').toEqual(
      [...keys].sort(),
    );

    const panelled = PAGE.slice(PAGE.indexOf('const panels: Record<SettingsKey, ReactNode>'));
    for (const key of keys) {
      expect(
        new RegExp(`^\\s{4}${key}:`, 'm').test(panelled),
        `"${key}" is a settings section with no panel`,
      ).toBe(true);
    }
  });
});
