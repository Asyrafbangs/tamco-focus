import 'server-only';

import { NO_USAGE, type AiMessage, type AiToolCall, type TokenUsage } from '@/domain/ai';
import {
  ProviderError,
  type AiProvider,
  type ProviderErrorKind,
  type ProviderReply,
  type ProviderRequest,
} from '@/server/ai/providers/types';

/**
 * Groq, speaking the OpenAI chat-completions shape.
 *
 * Written against `fetch` rather than an SDK. The request is one JSON POST and
 * the response is one JSON object; a dependency to express that would be
 * weight without a benefit, and this way the error handling — which is most of
 * the real work on a free tier — is ours rather than something to work around.
 *
 * Three decisions worth knowing about:
 *
 * **Not streamed.** Groq documents token usage for non-streaming replies;
 * what a streaming chunk carries for usage is not documented, and neither is
 * the tool-call delta shape. Usage is a requirement here — it drives the
 * budget that keeps the free tier working — and a streamed request would
 * leave us either guessing the numbers or dropping them. The person still
 * sees the investigation stream, because the route streams our own events as
 * each step completes; it is the model call inside a step that is not
 * streamed. The model is fast enough on Groq that a step is a second or two.
 *
 * **`reasoning_format` is not sent.** Groq's reasoning page states it is not
 * supported on the gpt-oss models, and `raw` with tools enabled is a
 * documented 400. `reasoning_effort` is sent, and `include_reasoning: false`
 * asks for the chain of thought to be left out of the response — we neither
 * want it nor store it.
 *
 * **Optional parameters fall back once.** If Groq rejects a request for a
 * parameter it does not recognise, the same request is retried without the
 * optional ones rather than failing the turn. Documentation and deployment
 * drift, and a feature that dies on an unknown field is a feature that dies
 * on a Tuesday.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/* The OpenAI chat shapes, only as far as we use them. */

interface ChatToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface ChatChoice {
  message?: { role?: string; content?: string | null; tool_calls?: ChatToolCall[] };
  finish_reason?: string;
}

interface ChatResponse {
  model?: string;
  choices?: ChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string; code?: string };
}

/** Our neutral message, as the OpenAI chat shape wants it. */
function wireMessage(message: AiMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallId,
      name: message.name,
      content: message.content,
    };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      // An assistant turn that asked for tools must carry the calls back, or
      // the tool results that follow answer nothing.
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

/**
 * `2m59.56s`, `7.66s`, `120` — Groq's reset headers, in milliseconds.
 *
 * Returns null rather than zero for anything unparseable: zero would read as
 * "retry immediately", which against a rate limit is how a single 429 becomes
 * a dozen.
 */
export function parseResetDuration(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1_000);
  const pattern = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
  let total = 0;
  let matched = false;
  for (const [, amount, unit] of trimmed.matchAll(pattern)) {
    matched = true;
    const size = Number(amount);
    total +=
      unit === 'ms'
        ? size
        : unit === 's'
          ? size * 1_000
          : unit === 'm'
            ? size * 60_000
            : size * 3_600_000;
  }
  return matched ? Math.round(total) : null;
}

/**
 * Which kind of failure a response represents.
 *
 * The distinction that matters most is between a per-minute rate limit and an
 * exhausted daily quota. Both arrive as a 429. Waiting helps with the first
 * and is pointless for the second, and telling somebody "try again in a
 * moment" when their allowance is gone until tomorrow is a small lie that
 * wastes their afternoon. Groq's headers always report requests remaining
 * for the day and tokens remaining for the minute, so a 429 with no daily
 * requests left is a quota, and anything else is the minute.
 */
export function classify(status: number, headers: Headers, body: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) {
    /*
     * Groq says which limit it was, in the body, and that is the only place
     * it says so for tokens-per-day.
     *
     * This mattered more than anything else here. The headers carry requests
     * remaining for the DAY and tokens remaining for the MINUTE - there is
     * no header for tokens remaining for the day - so a day's token quota
     * arrives as a 429 with requests to spare and a short request reset, and
     * was classified as a per-minute limit. A usage export settled it: of
     * 407 requests over one afternoon, 91 were refused on tokens-per-day and
     * exactly one on tokens-per-minute, and every one of the 91 told the
     * person to ask again in a minute. The message names the bucket -
     * "on tokens per day (TPD)" - so the message is what is read first.
     */
    if (/\b(?:tokens|requests) per day\b|\b[TR]PD\b/i.test(body)) return 'quota_exhausted';
    if (/\b(?:tokens|requests) per minute\b|\b[TR]PM\b/i.test(body)) return 'rate_limited';
    const remainingDay = Number(headers.get('x-ratelimit-remaining-requests') ?? 'NaN');
    if (Number.isFinite(remainingDay) && remainingDay <= 0) return 'quota_exhausted';
    /*
     * Failing that, a long wait. `retry-after` is included because it is the
     * header Groq actually populated on those daily refusals - 507, 657 and
     * 761 seconds were observed - while the request reset stayed small.
     */
    const reset = parseResetDuration(headers.get('x-ratelimit-reset-requests'));
    if (reset !== null && reset > 10 * 60_000) return 'quota_exhausted';
    const waitAsked = parseResetDuration(headers.get('retry-after'));
    if (waitAsked !== null && waitAsked > 5 * 60_000) return 'quota_exhausted';
    return 'rate_limited';
  }
  if (status === 413) return 'context_too_long';
  if (status === 400) {
    if (/context[_ ]length|too many tokens|maximum context|reduce the length/i.test(body)) {
      return 'context_too_long';
    }
    /*
     * The model's own output, refused. `tool_use_failed` is a call to
     * something nobody offered - gpt-oss reaches for `commentary`, which
     * belongs to the format it reasons in. `output_parse_failed` is prose
     * where structure was expected. Both are sampling slips on a sound
     * request.
     */
    if (
      /tool_use_failed|not in request\.tools|tool call validation failed|output_parse_failed|parsing failed|could not be parsed/i.test(
        body,
      )
    ) {
      return 'malformed_generation';
    }
    return 'bad_request';
  }
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function messageFrom(body: string): string {
  try {
    const parsed = JSON.parse(body) as ChatResponse;
    return parsed.error?.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

/** Whether a 400 is about a parameter this deployment does not know. */
function looksLikeUnknownParameter(body: string): boolean {
  return /unrecognized|unknown|unsupported|not supported|invalid.*(parameter|field|argument)|additional propert/i.test(
    body,
  );
}

function usageFrom(response: ChatResponse): TokenUsage {
  const usage = response.usage;
  if (!usage) return { ...NO_USAGE };
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    // Groq reports prompt tokens inclusive of anything served from cache, so
    // the cached part is subtracted out to avoid counting it at both rates.
    inputTokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    outputTokens: usage.completion_tokens ?? 0,
    cachedInputTokens: cached,
  };
}

function toolCallsFrom(choice: ChatChoice): AiToolCall[] {
  return (choice.message?.tool_calls ?? [])
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function!.name!,
      // Left as the string the model wrote. The tool parses it and refuses it
      // if it is not what the schema asked for; trusting it here would move
      // that decision somewhere it cannot be tested.
      arguments: call.function?.arguments ?? '{}',
    }));
}

export interface GroqOptions {
  apiKey: string;
  model: string;
  tier: 'free' | 'paid';
  /** Per-request ceiling. The loop's deadline is the real limit. */
  timeoutMs?: number;
  /** Swapped in tests. */
  fetchImpl?: typeof fetch;
}

export function createGroqProvider(options: GroqOptions): AiProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 25_000;

  async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signals = signal ? [signal, timeout] : [timeout];
    return doFetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The key reaches exactly one place: this header, on the server.
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
      cache: 'no-store',
    });
  }

  return {
    id: 'groq',
    model: options.model,
    tier: options.tier,

    async send(request: ProviderRequest): Promise<ProviderReply> {
      /*
       * Counted here, per call, because the loop sums what each step cost.
       * A counter living on the provider would accumulate across the steps
       * of one turn and be added again each time.
       */
      let requests = 0;
      const sendOne = async (body: Record<string, unknown>, signal?: AbortSignal) => {
        requests += 1;
        return post(body, signal);
      };

      const base: Record<string, unknown> = {
        model: options.model,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.map(wireMessage),
        ],
        max_completion_tokens: request.maxOutputTokens,
        /*
         * `auto` rather than `required`. A question the records cannot answer
         * should get "I could not establish that", and forcing a tool call
         * turns that into a guess dressed up as a lookup.
         */
        tool_choice: 'auto',
        /*
         * No `strict: true`. Strict function calling requires every property
         * to appear in `required`, and two of our tools take a genuinely
         * optional argument with a default - a horizon in days, a register
         * filter. Declaring those required to satisfy strict mode would make
         * the model supply a value it has no opinion about, and omitting
         * strict costs nothing here: every tool validates its own arguments
         * with Zod and answers an invalid call with a message the model can
         * act on, which is a better guard than a schema flag because it is
         * the one the tests exercise.
         */
        tools: request.tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
      };
      /* Optional, and dropped together if this deployment rejects them. */
      const optional: Record<string, unknown> = {
        reasoning_effort: request.effort,
        include_reasoning: false,
      };

      let response: Response;
      let text: string;
      try {
        response = await sendOne({ ...base, ...optional }, request.signal);
        text = await response.text();
      } catch (cause) {
        const aborted =
          (cause as Error)?.name === 'AbortError' || (cause as Error)?.name === 'TimeoutError';
        throw new ProviderError(
          aborted ? 'timeout' : 'network',
          aborted
            ? 'The model did not answer in time.'
            : `Could not reach the model: ${String(cause)}`,
          { requests },
        );
      }

      if (!response.ok && response.status === 400 && looksLikeUnknownParameter(text)) {
        try {
          response = await sendOne(base, request.signal);
          text = await response.text();
        } catch (cause) {
          throw new ProviderError('network', `Could not reach the model: ${String(cause)}`, {
            requests,
          });
        }
      }

      /*
       * Up to two more samples when the model's own output was refused. The
       * request is sound and the next sample usually is too; without this, a
       * format artefact ends an investigation that was going well, which is
       * what it did to one eval scenario twice in a row with two different
       * error codes.
       */
      for (
        let attempt = 0;
        attempt < 2 &&
        !response.ok &&
        classify(response.status, response.headers, text) === 'malformed_generation';
        attempt += 1
      ) {
        try {
          response = await sendOne({ ...base, ...optional }, request.signal);
          text = await response.text();
        } catch (cause) {
          throw new ProviderError('network', `Could not reach the model: ${String(cause)}`, {
            requests,
          });
        }
      }

      if (!response.ok) {
        const kind = classify(response.status, response.headers, text);
        throw new ProviderError(kind, messageFrom(text), {
          status: response.status,
          retryAfterMs:
            parseResetDuration(response.headers.get('retry-after')) ??
            parseResetDuration(response.headers.get('x-ratelimit-reset-tokens')),
          requests,
        });
      }

      let parsed: ChatResponse;
      try {
        parsed = JSON.parse(text) as ChatResponse;
      } catch {
        throw new ProviderError('malformed', 'The model returned something that was not JSON.', {
          requests,
        });
      }

      const choice = parsed.choices?.[0];
      if (!choice) {
        throw new ProviderError('malformed', 'The model returned no reply at all.', { requests });
      }

      const toolCalls = toolCallsFrom(choice);
      const finish = choice.finish_reason ?? 'stop';
      /*
       * `length` means the reply stopped mid-sentence. It is reported as
       * truncated rather than answered, because the alternative is showing
       * somebody half a conclusion as though it were the whole one.
       */
      const stop: ProviderReply['stop'] =
        toolCalls.length > 0 ? 'tool_calls' : finish === 'length' ? 'truncated' : 'answered';

      return {
        text: choice.message?.content ?? '',
        toolCalls,
        usage: usageFrom(parsed),
        stop,
        model: parsed.model ?? options.model,
        requests,
      };
    },
  };
}
