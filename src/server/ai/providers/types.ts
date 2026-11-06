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
}

/** What went wrong, in terms the loop and the route can both act on. */
export type ProviderErrorKind =
  | 'rate_limited'
  | 'quota_exhausted'
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

  constructor(
    kind: ProviderErrorKind,
    message: string,
    options: { retryAfterMs?: number | null; status?: number | null } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.status = options.status ?? null;
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
    case 'quota_exhausted':
      return 'rate_limited';
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
