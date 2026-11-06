import 'server-only';

import { MODEL_RATES } from '@/domain/ai';

/**
 * What the assistant is allowed to do, and what it costs.
 *
 * Read once, from the server environment only. The API key never leaves this
 * process: it is not prefixed `NEXT_PUBLIC_`, this module is `server-only`,
 * and nothing here is ever returned to a browser.
 */

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export interface AiConfig {
  /** Whether the feature answers at all. A switch, not a deploy. */
  enabled: boolean;
  apiKey: string | null;
  model: string;
  /** `low` through `max`: how hard the model works before answering. */
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** US dollars, per person, over a rolling 24 hours. */
  dailyLimitUsd: number;
}

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

export function aiConfig(): AiConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const model = process.env.AI_MODEL?.trim() || 'claude-opus-5-5';
  const effort = process.env.AI_EFFORT?.trim() || 'high';
  return {
    /*
     * Off unless there is a key AND nobody has switched it off. Two
     * conditions, because "we removed the key" and "we turned it off for a
     * week" are different decisions and an operator should be able to make
     * the second one without touching a secret.
     */
    enabled: Boolean(apiKey) && process.env.AI_ENABLED?.trim().toLowerCase() !== 'false',
    apiKey,
    model: model in MODEL_RATES ? model : 'claude-opus-5-5',
    effort: (EFFORTS.has(effort) ? effort : 'high') as AiConfig['effort'],
    dailyLimitUsd: number('AI_DAILY_LIMIT_USD', 5),
  };
}
