import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * v295 — the boundary the assistant must not cross, checked as source.
 *
 * Every other guarantee in this feature rests on one fact: the agent reads
 * through the caller's own Supabase session, so row-level security decides
 * what comes back. One import of the service-role client anywhere under
 * `src/server/ai` would silently turn "answer about your work" into "answer
 * about anyone's", and nothing in a passing integration test would notice,
 * because the answers would simply be more complete.
 *
 * So this reads the files. It is a blunt instrument on purpose: a rule that
 * can be satisfied by changing one line of a mock is not a rule.
 */

const AI_DIR = path.join(process.cwd(), 'src', 'server', 'ai');

/**
 * The code, without its commentary.
 *
 * These files explain the rule they obey — "nothing here may import the
 * service-role client" — and a check that reads the explanation as a
 * violation is a check that punishes documentation. Comments go first.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function aiSources(): { file: string; text: string }[] {
  return readdirSync(AI_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({
      file: name,
      text: withoutComments(readFileSync(path.join(AI_DIR, name), 'utf8')),
    }));
}

/** The lines that actually pull something in, rather than mention it. */
function importsOf(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => /^\s*import\b|\bfrom\s+['"]/.test(line))
    .join('\n');
}

describe('v295 the agent cannot leave the caller’s permissions', () => {
  it('never reaches for the service-role client', () => {
    for (const { file, text } of aiSources()) {
      expect(text, `${file} must not import the service-role client`).not.toContain(
        'createSupabaseServiceRoleClient',
      );
      expect(text, `${file} must not read the service-role key`).not.toContain(
        'SUPABASE_SERVICE_ROLE_KEY',
      );
    }
  });

  it('never writes raw SQL of its own', () => {
    /*
     * The model cannot be given a query to run, and neither can this layer
     * assemble one: a tool is a call to a reader the application already
     * uses, and anything else is a second opinion about who may see what.
     */
    for (const { file, text } of aiSources()) {
      expect(text, `${file} must not call rpc('execute...')`).not.toMatch(
        /rpc\(\s*['"`](execute|exec|query|sql)/i,
      );
      expect(text, `${file} must not build SQL`).not.toMatch(/\bselect\s+\*\s+from\b/i);
    }
  });

  it('keeps the API key server-side', () => {
    for (const { file, text } of aiSources()) {
      expect(text, `${file} must not expose the key to a bundle`).not.toContain(
        'NEXT_PUBLIC_ANTHROPIC',
      );
    }
    const config = readFileSync(path.join(AI_DIR, 'config.ts'), 'utf8');
    expect(config).toContain("import 'server-only'");
    expect(config).toContain('ANTHROPIC_API_KEY');
  });

  it('exposes no tool that writes', () => {
    /*
     * Phase 1 is read-only, and "read-only" has to mean something a reader
     * can check. Every tool name is a reading verb, and none of the server
     * actions that change records are imported here.
     */
    const tools = readFileSync(path.join(AI_DIR, 'tools.ts'), 'utf8');
    const names = [...tools.matchAll(/^\s*name: '([a-z_]+)',$/gm)].map((match) => match[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name, `${name} does not read`).toMatch(/^(list|get|search|read|count)_/);
    }
    /*
     * Checked against what the file imports, not against its prose: a tool
     * description may well say "assigned", and that is the vocabulary of the
     * product rather than a capability it has.
     */
    const imported = importsOf(withoutComments(tools));
    for (const forbidden of [
      'saveFinding',
      'declineReportIntake',
      'markReportIntakeDuplicate',
      'claimReportIntake',
      'completeTask',
      "/actions'",
    ]) {
      expect(imported, `tools.ts must not import ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('wraps every tool result as evidence before the model sees it', () => {
    const tools = withoutComments(readFileSync(path.join(AI_DIR, 'tools.ts'), 'utf8'));
    const returns = [...tools.matchAll(/evidence:\s*([^,\n]+)/g)]
      .map((match) => match[1]!.trim())
      // The field's own declaration on the interface is not a return value.
      .filter((value) => value !== 'string;');
    expect(returns.length).toBeGreaterThan(0);
    for (const value of returns) {
      expect(value, 'a tool returned evidence that was not wrapped').toMatch(/^asEvidence\(/);
    }
  });
});
