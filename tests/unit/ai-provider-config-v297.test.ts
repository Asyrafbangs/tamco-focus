import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { aiConfig } from '@/server/ai/config';
import { providerFor } from '@/server/ai/providers';
import { AGENT_LIMITS, GROQ_FREE_LIMITS, MODEL_RATES, OPENAI_TIER_LIMITS } from '@/domain/ai';

/**
 * v297 — which provider runs, and on whose terms.
 *
 * `config.ts` had no test. It was the file that decided the model, the key,
 * the rate card and the budget off one provider's assumptions, and the
 * second provider turns each of those into a choice that can be made wrongly
 * in a way nothing would notice until the bill or the 404s arrived:
 *
 *   - a Groq model name sent to OpenAI is a 404 on every single request;
 *   - OpenAI's traffic recorded at Groq's free tier is real money reported
 *     as nothing;
 *   - Groq's 8,000-tokens-a-minute ceiling applied to OpenAI would throttle
 *     the loop to a fraction of what the plan allows.
 *
 * And the default itself: Groq, until somebody reads a comparison and says
 * otherwise. A measurement that changes production before it has been read
 * is not a measurement.
 */

const TOUCHED = [
  'AI_PROVIDER',
  'AI_MODEL',
  'AI_TIER',
  'AI_EFFORT',
  'AI_ENABLED',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT_ID',
  'AI_LIMIT_TPM',
];

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

describe('v297 the provider is a choice, and Groq is still the default', () => {
  it('stays on Groq when nothing says otherwise', () => {
    process.env.GROQ_API_KEY = 'gsk_test';
    const config = aiConfig();
    expect(config.provider).toBe('groq');
    expect(config.model).toBe('openai/gpt-oss-120b');
    expect(config.tier).toBe('free');
    expect(config.limits).toEqual(GROQ_FREE_LIMITS);
    expect(config.enabled).toBe(true);
  });

  it('switches on one variable, and takes that provider’s key, model and limits', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    const config = aiConfig();
    expect(config.provider).toBe('openai');
    expect(config.model).toBe('gpt-5.4-mini');
    expect(config.limits).toEqual(OPENAI_TIER_LIMITS);
    /*
     * `paid`, because OpenAI has no free tier for this model. Recording real
     * spending as nothing is the one thing a cost report must never do.
     */
    expect(config.tier).toBe('paid');
  });

  it('is off when the chosen provider has no key, even if the other one does', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.GROQ_API_KEY = 'gsk_test';
    const config = aiConfig();
    expect(config.apiKey).toBeNull();
    expect(config.enabled).toBe(false);
    expect(providerFor(config)).toBeNull();
  });

  it('refuses a model belonging to the other provider rather than sending it', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AI_MODEL = 'openai/gpt-oss-120b';
    // Groq's model name on OpenAI's endpoint is a 404 per request, for ever.
    expect(aiConfig().model).toBe('gpt-5.4-mini');

    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'gsk_test';
    process.env.AI_MODEL = 'gpt-5.4-mini';
    expect(aiConfig().model).toBe('openai/gpt-oss-120b');
  });

  it('accepts a dated snapshot of the chosen provider’s model', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AI_MODEL = 'gpt-5.4-mini-2026-03-17';
    expect(aiConfig().model).toBe('gpt-5.4-mini-2026-03-17');
  });

  it('lets an operator override the tier and the limits either way', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AI_TIER = 'free';
    process.env.AI_LIMIT_TPM = '50000';
    const config = aiConfig();
    expect(config.tier).toBe('free');
    expect(config.limits.tokensPerMinute).toBe(50_000);
    // The ones not overridden keep the provider's own defaults.
    expect(config.limits.requestsPerMinute).toBe(OPENAI_TIER_LIMITS.requestsPerMinute);
  });

  it('carries the account scoping headers only when they are configured', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(aiConfig().organization).toBeNull();
    process.env.OPENAI_ORG_ID = 'org-tamco';
    process.env.OPENAI_PROJECT_ID = 'proj-jarvis';
    const config = aiConfig();
    expect(config.organization).toBe('org-tamco');
    expect(config.project).toBe('proj-jarvis');
  });

  it('builds the provider the configuration names', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    const openai = providerFor(aiConfig());
    expect(openai?.id).toBe('openai');
    expect(openai?.model).toBe('gpt-5.4-mini');

    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'gsk_test';
    delete process.env.OPENAI_API_KEY;
    expect(providerFor(aiConfig())?.id).toBe('groq');
  });
});

describe('v297 the rate card knows what the new model costs', () => {
  it('prices gpt-5.4-mini from OpenAI’s published figures', () => {
    const rate = MODEL_RATES['gpt-5.4-mini'];
    expect(rate).toBeDefined();
    expect(rate!.provider).toBe('openai');
    expect(rate!.inputPerMillion).toBe(0.75);
    expect(rate!.cachedInputPerMillion).toBe(0.075);
    expect(rate!.outputPerMillion).toBe(4.5);
    expect(rate!.contextWindow).toBe(400_000);
    expect(rate!.maxOutputTokens).toBe(128_000);
  });

  it('prices the dated snapshot identically, so pinning one costs nothing', () => {
    expect(MODEL_RATES['gpt-5.4-mini-2026-03-17']).toEqual({
      ...MODEL_RATES['gpt-5.4-mini']!,
      id: 'gpt-5.4-mini-2026-03-17',
    });
  });
});

describe('v298 the reply ceiling is per provider, because 4,000 truncates this model', () => {
  /*
   * The defect this guards. `AGENT_LIMITS.maxOutputTokens` is 4,000, measured
   * for gpt-oss on a free tier whose binding constraint is tokens a minute.
   * Asked the first cross-module question of the complex suite - "the five
   * most important things today" - gpt-5.4-mini called eight tools, read
   * forty-three rows, spent 4,426 output tokens and returned the route's
   * length-limit notice instead of an answer. The reads were paid for and
   * thrown away.
   */
  it('gives OpenAI room for a synthesis that thinks first, and leaves Groq alone', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    const openai = aiConfig().maxOutputTokens;
    expect(openai).toBe(12_000);
    expect(openai).toBeGreaterThan(AGENT_LIMITS.maxOutputTokens);
    // Well inside what the model itself permits, so the ceiling is ours.
    expect(openai).toBeLessThanOrEqual(MODEL_RATES['gpt-5.4-mini']!.maxOutputTokens);

    process.env.AI_PROVIDER = 'groq';
    process.env.GROQ_API_KEY = 'gsk_test';
    delete process.env.OPENAI_API_KEY;
    /*
     * Unchanged on the free tier on purpose: a ceiling larger than the
     * minute's whole allowance is a request that tier cannot satisfy.
     */
    expect(aiConfig().maxOutputTokens).toBe(AGENT_LIMITS.maxOutputTokens);
  });

  it('lets an operator move it without a deploy, and ignores nonsense', () => {
    process.env.AI_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';
    process.env.AI_MAX_OUTPUT_TOKENS = '20000';
    expect(aiConfig().maxOutputTokens).toBe(20_000);
    process.env.AI_MAX_OUTPUT_TOKENS = 'generous';
    expect(aiConfig().maxOutputTokens).toBe(12_000);
    delete process.env.AI_MAX_OUTPUT_TOKENS;
  });
});
