import 'server-only';

import { GROQ_FREE_LIMITS, MODEL_RATES, type TierLimits } from '@/domain/ai';

/**
 * What the assistant is allowed to do, which model runs it, and what it costs.
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
  provider: 'groq';
  apiKey: string | null;
  model: string;
  /** How hard the model works before answering. */
  effort: 'low' | 'medium' | 'high';
  /** Whether requests are actually billed. Decides what is recorded as spend. */
  tier: 'free' | 'paid';
  /** The plan's own ceilings, which the budget is held against. */
  limits: TierLimits;
  /** A dollar ceiling as well, for when the tier is a paid one. */
  dailySpendLimitUsd: number;
  /*
   * The slice of the shared daily allowance one person may have.
   *
   * The provider's quota belongs to the API key, so everybody here draws on
   * one pool. Without a share, the first colleague to have a busy morning
   * spends the whole day's tokens and the other eight meet a 429 in the
   * middle of a question. A fraction rather than a count because the pool
   * moves with the plan. 1 switches it off.
   */
  personDailyShare: number;
}

const EFFORTS = new Set(['low', 'medium', 'high']);

export function aiConfig(): AiConfig {
  const apiKey = process.env.GROQ_API_KEY?.trim() || null;
  const requested = process.env.AI_MODEL?.trim() || 'openai/gpt-oss-120b';
  /*
   * An unknown model name is refused rather than passed through. The rate
   * card and the context window come from that name, and a model we cannot
   * price is one whose usage we would be reporting as a guess.
   */
  const model =
    requested in MODEL_RATES && MODEL_RATES[requested]!.provider === 'groq'
      ? requested
      : 'openai/gpt-oss-120b';
  /*
   * `medium`, from measurement rather than taste. On the same eval scenario
   * `high` spent 5,526 tokens against `medium`'s 2,744 - because higher
   * effort also means more tool calls, and every call resends the
   * conversation - and both answers were correct. At 8,000 tokens a minute
   * that is the difference between one question a minute and three. `high`
   * remains available for an account with room for it.
   */
  const effort = process.env.AI_EFFORT?.trim() || 'medium';
  const tier = process.env.AI_TIER?.trim() === 'paid' ? 'paid' : 'free';

  return {
    /*
     * Off unless there is a key AND nobody has switched it off. Two
     * conditions, because "we removed the key" and "we turned it off for a
     * week" are different decisions, and an operator should be able to make
     * the second one without touching a secret.
     */
    enabled: Boolean(apiKey) && process.env.AI_ENABLED?.trim().toLowerCase() !== 'false',
    provider: 'groq',
    apiKey,
    model,
    effort: (EFFORTS.has(effort) ? effort : 'medium') as AiConfig['effort'],
    tier,
    /*
     * Groq's documented free-plan ceilings for gpt-oss-120b, overridable
     * because a plan change moves them and the Groq console is the authority.
     * The minute limit on tokens is the one that shapes the loop.
     */
    limits: {
      requestsPerMinute: number('AI_LIMIT_RPM', GROQ_FREE_LIMITS.requestsPerMinute),
      requestsPerDay: number('AI_LIMIT_RPD', GROQ_FREE_LIMITS.requestsPerDay),
      tokensPerMinute: number('AI_LIMIT_TPM', GROQ_FREE_LIMITS.tokensPerMinute),
      tokensPerDay: number('AI_LIMIT_TPD', GROQ_FREE_LIMITS.tokensPerDay),
    },
    dailySpendLimitUsd: number('AI_DAILY_LIMIT_USD', 1),
    /*
     * Half the day each, by default.
     *
     * Not 1/headcount: the assistant is not used evenly, and a share that
     * small would refuse the one person actually investigating something
     * while eight unused shares sat idle. Half is loose enough to be
     * invisible on a normal day and tight enough that one runaway afternoon
     * leaves the rest of the office something to work with.
     */
    personDailyShare: Math.min(1, Math.max(0, number('AI_PERSON_DAILY_SHARE', 0.5))),
  };
}
