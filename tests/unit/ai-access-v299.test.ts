import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { canUseAssistant } from '@/domain/ai';
import type { AppRole } from '@/domain/types';
import { aiConfig } from '@/server/ai/config';

/**
 * v299 — who the assistant is for, and which variable switches it on.
 *
 * Two defects shipped to production in the v295–v298 merge, neither of them a
 * failure of any existing test, because nothing asserted either rule:
 *
 *   1. `/ai` carried no role gate at all. The nav entry had no `managerOnly`
 *      flag, the page checked only that somebody was signed in, and the route
 *      checked the same. So the merge that shipped the OpenAI provider put a
 *      "TAMCO AI" destination in front of every signed-in person at once.
 *   2. The disabled notice named `GROQ_API_KEY` as a literal string, two
 *      versions after the provider became OpenAI. An administrator following
 *      it would have set a variable the running code does not read — and
 *      because the provider still defaults to Groq, the assistant would then
 *      have stayed off with no indication of why.
 *
 * The role rule lives in one function so the rail, the page and the route
 * cannot drift apart, and that function is what this file pins. The three
 * enforcement points are proven in `tests/e2e/ai-access-v299.spec.ts`, where a
 * real team member is told no by a real server.
 */

describe('v299 who may use the assistant', () => {
  it('admits managers and administrators', () => {
    expect(canUseAssistant('manager')).toBe(true);
    expect(canUseAssistant('administrator')).toBe(true);
  });

  it('refuses a team member', () => {
    expect(canUseAssistant('team_member')).toBe(false);
  });

  /*
   * Exhaustive over the union rather than over a list written out here. A
   * fourth role added to `AppRole` makes this fail to compile until somebody
   * decides whether the assistant is for them, which is the point: the v298
   * defect was a permission decision nobody made.
   */
  it('has an answer for every role the application defines', () => {
    const answers: Record<AppRole, boolean> = {
      team_member: false,
      manager: true,
      administrator: true,
    };
    for (const [role, expected] of Object.entries(answers) as [AppRole, boolean][]) {
      expect(canUseAssistant(role)).toBe(expected);
    }
    expect(Object.values(answers).filter(Boolean)).toHaveLength(2);
  });
});

const TOUCHED = ['AI_PROVIDER', 'AI_MODEL', 'GROQ_API_KEY', 'OPENAI_API_KEY'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const name of TOUCHED) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of TOUCHED) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe('v299 the disabled notice names the right variable', () => {
  it('names OPENAI_API_KEY when the provider is OpenAI', () => {
    process.env.AI_PROVIDER = 'openai';
    const config = aiConfig();
    expect(config.provider).toBe('openai');
    expect(config.keyVariable).toBe('OPENAI_API_KEY');
    /*
     * The literal that was live in production. Named here so that putting it
     * back — in any provider's branch — fails.
     */
    expect(config.keyVariable).not.toBe('GROQ_API_KEY');
  });

  it('names GROQ_API_KEY when the provider is Groq', () => {
    process.env.AI_PROVIDER = 'groq';
    expect(aiConfig().keyVariable).toBe('GROQ_API_KEY');
  });

  /*
   * The trap this makes visible. `AI_PROVIDER` defaults to Groq, so an
   * operator who sets only `OPENAI_API_KEY` gets an assistant that is still
   * off and a notice asking for the Groq key. That notice is now correct
   * about the configuration it is running under, which is the only way
   * somebody can tell what went wrong.
   */
  it('reads the Groq key, and says so, when no provider is declared', () => {
    process.env.OPENAI_API_KEY = 'sk-set-but-not-selected';
    const config = aiConfig();
    expect(config.provider).toBe('groq');
    expect(config.keyVariable).toBe('GROQ_API_KEY');
    expect(config.apiKey).toBeNull();
    expect(config.enabled).toBe(false);
  });

  it('is the variable the key is actually read from', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env[aiConfig().keyVariable] = 'sk-test-v299';
    expect(aiConfig().apiKey).toBe('sk-test-v299');
  });
});
