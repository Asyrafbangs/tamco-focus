import 'server-only';

import type { AiMessage, AiToolCall, StopReason, TokenUsage } from '@/domain/ai';

/**
 * The seam between the investigation loop and whoever is running the model.
 *
 * One interface, deliberately small: send a conversation and a tool list, get
 * back text, tool calls and a token count. Everything a provider does
 * differently — OpenAI's chat messages against Anthropic's content blocks,
 * `reasoning_effort` against `thinking`, a 429 header against a typed error —
 * is handled inside its own module and never leaks past this file.
 *
 * That is what makes the provider choice a configuration value rather than a
 * rewrite. It is also what makes the loop testable: a stub that satisfies
 * `AiProvider` is a legitimate provider as far as the loop is concerned.
 */

/** A tool as the model is told about it. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  system: string;
  messages: readonly AiMessage[];
  tools: readonly ToolSpec[];
  maxOutputTokens: number;
  /** How hard the model should work before answering. */
  effort: 'low' | 'medium' | 'high';
  /** Abandons the request; the loop sets this from its own deadline. */
  signal?: AbortSignal;
}

export interface ProviderReply {
  text: string;
  toolCalls: AiToolCall[];
  usage: TokenUsage;
  /**
   * `tool_calls` when the model wants tools, `answered` when it is done,
   * `truncated` when it hit the output ceiling mid-sentence. A truncated
   * reply is never presented as a finished one.
   */
  stop: 'answered' | 'tool_calls' | 'truncated';
  /** The model that actually served it, as the provider reported it. */
  model: string;
  /*
   * How many HTTP requests this one `send` actually cost.
   *
   * Usually one, and more whenever the provider was asked again: a parameter
   * this deployment did not recognise, or output it refused and we resampled.
   * Reported because the provider's own limits are counted in requests, and
   * a daily request allowance guarded by a number we made up is not guarded.
   * The route used to record `toolCalls.length + 1`, which counted database
   * reads that never touched the network and missed every retry.
   */
  requests: number;
}

/** What went wrong, in terms the loop and the route can both act on. */
export type ProviderErrorKind =
  | 'rate_limited'
  | 'quota_exhausted'
  /*
   * v309 — the account has no money, which is not the same as a spent daily
   * allowance and must not be reported as one.
   *
   * Found in production: the API answered "You have no credits remaining" and
   * the screen said "the assistant's daily allowance is shared across
   * everyone here, and it is used up" - so the honest action, topping up, was
   * invisible, and the apparent one, waiting until tomorrow, would have
   * failed again. `classify` already told the two apart; the kinds collapsed
   * them one line later.
   */
  | 'credits_exhausted'
  | 'context_too_long'
  | 'timeout'
  | 'auth'
  /*
   * The model produced output the provider would not accept, and rejected the
   * whole request because of it.
   *
   * Two forms observed against Groq, both from gpt-oss and both on a sound
   * request: `tool_use_failed`, where it called `commentary` - part of the
   * format it reasons in, not a tool anybody defined - and
   * `output_parse_failed`, where it wrote prose where structure was expected.
   * Neither is the request's fault, so each is worth another sample.
   */
  | 'malformed_generation'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'malformed';

/**
 * A provider failure, classified.
 *
 * The classification is the point. "Something went wrong" leaves the loop no
 * choice but to give up or retry blindly; knowing that this was a per-minute
 * rate limit with eleven seconds to wait, rather than an exhausted daily
 * quota, is the difference between finishing the investigation and lying
 * about it.
 */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  /** How long the provider asked us to wait, where it said so. */
  readonly retryAfterMs: number | null;
  readonly status: number | null;
  /** Whether waiting could plausibly help. */
  readonly retryable: boolean;
  /*
   * How many HTTP requests were spent before giving up.
   *
   * A failure costs the provider's request allowance exactly as a success
   * does, and a refused request can cost several: three 400s from one
   * resampled generation are three requests against the day. Counting only
   * the turns that produced an answer is how a usage report comes to show
   * half of what the provider's own console shows.
   */
  readonly requests: number;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: { retryAfterMs?: number | null; status?: number | null; requests?: number } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.status = options.status ?? null;
    this.requests = options.requests ?? 1;
    this.retryable =
      kind === 'rate_limited' ||
      kind === 'server' ||
      kind === 'network' ||
      kind === 'malformed_generation';
  }
}

/** How a provider failure maps onto the way the loop stops. */
export function stopReasonFor(kind: ProviderErrorKind): StopReason {
  switch (kind) {
    case 'rate_limited':
      return 'rate_limited';
    /*
     * Its own stop reason since v296. Both are 429s and both used to end the
     * turn saying "ask again in a minute"; for a spent daily allowance that
     * sent people back every minute for the rest of the afternoon.
     */
    case 'quota_exhausted':
      return 'quota';
    case 'credits_exhausted':
      return 'credits';
    case 'context_too_long':
      return 'budget';
    case 'timeout':
      return 'clock';
    default:
      return 'failed';
  }
}

export interface AiProvider {
  readonly id: string;
  readonly model: string;
  readonly tier: 'free' | 'paid';
  send(request: ProviderRequest): Promise<ProviderReply>;
}
