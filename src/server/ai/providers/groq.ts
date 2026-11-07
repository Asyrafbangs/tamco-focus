import 'server-only';

import {
  looksLikeUnknownParameter,
  messageFrom,
  parseResetDuration,
  stopFrom,
  toolCallsFrom,
  usageFrom,
  wireMessage,
  wireTools,
  type ChatResponse,
} from '@/server/ai/providers/chat-wire';
import {
  ProviderError,
  type AiProvider,
  type ProviderErrorKind,
  type ProviderReply,
  type ProviderRequest,
} from '@/server/ai/providers/types';

/*
 * v297 — the chat dialect itself moved to `chat-wire.ts` when OpenAI's own
 * provider arrived beside this one. Both speak it; one copy of it is the
 * point. `parseResetDuration` is re-exported because it is Groq's header
 * format that was reverse-engineered to write it, and the test that proves
 * it belongs with this provider.
 */
export { parseResetDuration } from '@/server/ai/providers/chat-wire';

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
        tools: wireTools(request.tools),
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

      return {
        text: choice.message?.content ?? '',
        toolCalls,
        usage: usageFrom(parsed),
        stop: stopFrom(toolCalls, choice.finish_reason),
        model: parsed.model ?? options.model,
        requests,
      };
    },
  };
}
