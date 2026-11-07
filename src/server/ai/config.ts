import 'server-only';

import { GROQ_FREE_LIMITS, MODEL_RATES, OPENAI_TIER_LIMITS, type TierLimits } from '@/domain/ai';

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
  provider: AiProviderId;
  apiKey: string | null;
  /** Optional OpenAI scoping headers, when the account uses them. */
  organization: string | null;
  project: string | null;
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

/**
 * Who runs the model (v297).
 *
 * Groq remains the default, deliberately: adding OpenAI beside it is a
 * measurement, and a measurement that changes what production uses before
 * anybody has read the results is not a measurement. Switching is one
 * environment variable once the comparison has been read.
 */
export type AiProviderId = 'groq' | 'openai';

interface ProviderDefaults {
  keyVariable: string;
  defaultModel: string;
  limits: TierLimits;
  /** Whether requests are billed unless the operator says otherwise. */
  defaultTier: 'free' | 'paid';
}

const PROVIDERS: Record<AiProviderId, ProviderDefaults> = {
  groq: {
    keyVariable: 'GROQ_API_KEY',
    defaultModel: 'openai/gpt-oss-120b',
    limits: GROQ_FREE_LIMITS,
    defaultTier: 'free',
  },
  /*
   * `paid` by default, because OpenAI has no free tier for this model: every
   * request is billed. Defaulting it to `free` would record real spending as
   * nothing, which is the one thing a cost report must never do.
   */
  openai: {
    keyVariable: 'OPENAI_API_KEY',
    defaultModel: 'gpt-5.4-mini',
    limits: OPENAI_TIER_LIMITS,
    defaultTier: 'paid',
  },
};

export function aiConfig(): AiConfig {
  const requestedProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  const provider: AiProviderId = requestedProvider === 'openai' ? 'openai' : 'groq';
  const defaults = PROVIDERS[provider];
  const apiKey = process.env[defaults.keyVariable]?.trim() || null;
  const requested = process.env.AI_MODEL?.trim() || defaults.defaultModel;
  /*
   * An unknown model name is refused rather than passed through, and so is a
   * model belonging to the other provider. The rate card and the context
   * window come from that name, and a model we cannot price is one whose
   * usage we would be reporting as a guess; a Groq model name sent to OpenAI
   * is a 404 per request, every request.
   */
  const model =
    requested in MODEL_RATES && MODEL_RATES[requested]!.provider === provider
      ? requested
      : defaults.defaultModel;
  /*
   * `medium` by default, and the honest position is that this is not yet
   * settled by evidence.
   *
   * An earlier note here claimed `high` cost about twice `medium`, from one
   * pair of samples - 5,526 against 2,744 on the same scenario. Measured
   * across every scenario run at both efforts, that does not generalise:
   *
   *   blame-the-owner      medium 7,626  high 3,294   (high read 1, medium 3)
   *   unreadable-register  medium 1,874  high 2,332
   *   recurring-or-not     medium 2,808  high 5,106
   *
   * What dominates the cost is how many tools the model calls, because every
   * call resends the whole conversation, and that varies more between two
   * runs at the same effort - 1,874, 2,300 and 3,034 on one scenario at
   * `medium` - than it does between the two efforts. Until there are several
   * samples per scenario per effort, a default chosen on these numbers would
   * be chosen on noise.
   *
   * So `medium` stands as the conservative default on a shared free tier,
   * `high` is one environment variable away, and the comparison is a
   * measurement still owed rather than one already made.
   */
  const effort = process.env.AI_EFFORT?.trim() || 'medium';
  const declaredTier = process.env.AI_TIER?.trim();
  const tier: 'free' | 'paid' =
    declaredTier === 'paid' ? 'paid' : declaredTier === 'free' ? 'free' : defaults.defaultTier;

  return {
    /*
     * Off unless there is a key AND nobody has switched it off. Two
     * conditions, because "we removed the key" and "we turned it off for a
     * week" are different decisions, and an operator should be able to make
     * the second one without touching a secret.
     */
    enabled: Boolean(apiKey) && process.env.AI_ENABLED?.trim().toLowerCase() !== 'false',
    provider,
    apiKey,
    organization: process.env.OPENAI_ORG_ID?.trim() || null,
    project: process.env.OPENAI_PROJECT_ID?.trim() || null,
    model,
    effort: (EFFORTS.has(effort) ? effort : 'medium') as AiConfig['effort'],
    tier,
    /*
     * Groq's documented free-plan ceilings for gpt-oss-120b, overridable
     * because a plan change moves them and the Groq console is the authority.
     * The minute limit on tokens is the one that shapes the loop.
     */
    limits: {
      requestsPerMinute: number('AI_LIMIT_RPM', defaults.limits.requestsPerMinute),
      requestsPerDay: number('AI_LIMIT_RPD', defaults.limits.requestsPerDay),
      tokensPerMinute: number('AI_LIMIT_TPM', defaults.limits.tokensPerMinute),
      tokensPerDay: number('AI_LIMIT_TPD', defaults.limits.tokensPerDay),
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
