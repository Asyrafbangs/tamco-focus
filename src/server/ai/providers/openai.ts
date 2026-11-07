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

/**
 * OpenAI, on the chat-completions endpoint.
 *
 * Sibling to `groq.ts` rather than a replacement for it. Groq implements this
 * same API, so the message shape, the tool shape and the usage block are
 * shared in `chat-wire.ts`; what lives here is what OpenAI does differently,
 * which is almost entirely about failure.
 *
 * **Chat Completions, not Responses.** OpenAI's model page lists both as
 * supported for `gpt-5.4-mini`. Chat Completions is the one this codebase
 * already speaks, so choosing it makes the second provider a hundred lines
 * instead of a second dialect. The Responses API offers hosted tools we do
 * not want — this assistant reads the company's own records through eight
 * tools of ours and nothing else.
 *
 * **Not streamed,** for the same reason as Groq: usage drives the budget, and
 * the route already streams our own step events to the person watching.
 *
 * **What the documentation does not settle.** OpenAI's model page confirms the
 * id, both endpoints, the effort values and the prices. It does not state, on
 * any page that could be read without an account, the Chat Completions
 * parameter names (`reasoning_effort`, `max_completion_tokens`), whether
 * `temperature` is accepted, or where cached tokens appear in a chat usage
 * block. Rather than guess:
 *
 *   - the optional parameters are sent, and dropped together on a 400 that
 *     names an unknown parameter — the same fallback `groq.ts` has;
 *   - `max_completion_tokens` is sent, and retried once as `max_tokens` if
 *     that is what this deployment wants;
 *   - `temperature` is never sent, because the loop does not need it and a
 *     reasoning model that rejects it would fail every request;
 *   - both cached-token paths are read.
 *
 * Each of those is a measured behaviour the first real run will confirm or
 * correct, and each is a test in `ai-openai-provider-v297`.
 */

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/**
 * Which kind of failure a response represents.
 *
 * The distinction that matters is the same one as on Groq, and OpenAI draws
 * it more plainly: a 429 is either traffic — too many requests or tokens this
 * minute, which waiting fixes — or money, which it does not. OpenAI's error
 * reference names the money cases explicitly: `credit_balance_exhausted`,
 * `organization_spend_limit_exceeded`, `project_spend_limit_exceeded`,
 * `organization_usage_limit_exceeded`, and the broader `insufficient_quota`
 * type. Its rate-limit guide says outright that billing errors "require user
 * action" and must not be retried.
 *
 * Getting this wrong is not cosmetic. On Groq it sent people back every
 * minute for a whole afternoon against a quota that would not return until
 * the next day.
 */
export function classify(status: number, headers: Headers, body: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) {
    /*
     * Billing first, and by name. These are the codes OpenAI documents for a
     * 429 that waiting cannot clear.
     */
    if (
      /credit_balance_exhausted|insufficient_quota|spend_limit_exceeded|usage_limit_exceeded|billing_hard_limit_reached|exceeded your current quota/i.test(
        body,
      )
    ) {
      return 'quota_exhausted';
    }
    /*
     * `slow_down` is documented as the rate rising too quickly, and the plain
     * "Rate limit reached for requests" 429 is the per-minute bucket. Both
     * are waits.
     */
    if (/slow_down|rate limit reached|rate_limit/i.test(body)) return 'rate_limited';
    /*
     * Failing that, the headers. A 429 with no requests left for the window
     * is a rate limit; a reset measured in hours is not something to sit and
     * wait for.
     */
    const reset =
      parseResetDuration(headers.get('x-ratelimit-reset-tokens')) ??
      parseResetDuration(headers.get('x-ratelimit-reset-requests'));
    if (reset !== null && reset > 10 * 60_000) return 'quota_exhausted';
    const waitAsked = parseResetDuration(headers.get('retry-after'));
    if (waitAsked !== null && waitAsked > 5 * 60_000) return 'quota_exhausted';
    return 'rate_limited';
  }
  if (status === 413) return 'context_too_long';
  if (status === 400) {
    if (
      /context[_ ]length|context_length_exceeded|too many tokens|maximum context|reduce the length/i.test(
        body,
      )
    ) {
      return 'context_too_long';
    }
    /*
     * The model's own output, refused. Rarer here than on Groq's gpt-oss -
     * the two forms seen there were artefacts of that model's reasoning
     * format - but a refused generation is a sound request either way, and
     * worth another sample rather than a dead investigation.
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
  if (status === 404) return 'bad_request';
  if (status === 408 || status === 504) return 'timeout';
  /*
   * 503 `server_is_overloaded` is OpenAI's documented "try again", and 529 is
   * used by some gateways for the same thing. Both are retryable server-side
   * conditions rather than anything wrong with the request.
   */
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** Whether a 400 is specifically about the output-limit parameter's name. */
export function looksLikeOutputLimitName(body: string): boolean {
  return /max_completion_tokens|max_tokens|max_output_tokens/i.test(body);
}

export interface OpenAiOptions {
  apiKey: string;
  model: string;
  tier: 'free' | 'paid';
  /** Sent as `OpenAI-Organization` when set. */
  organization?: string | null;
  /** Sent as `OpenAI-Project` when set. */
  project?: string | null;
  /** Per-request ceiling. The loop's deadline is the real limit. */
  timeoutMs?: number;
  /** Swapped in tests. */
  fetchImpl?: typeof fetch;
}

export function createOpenAiProvider(options: OpenAiOptions): AiProvider {
  const doFetch = options.fetchImpl ?? fetch;
  /*
   * Longer than Groq's 25 seconds. Groq is fast by design; a reasoning model
   * asked to work at `high` on a conversation carrying several tool results
   * can take considerably longer, and a timeout shorter than the model's
   * honest thinking time turns good answers into failures.
   */
  const timeoutMs = options.timeoutMs ?? 90_000;

  async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signals = signal ? [signal, timeout] : [timeout];
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // The key reaches exactly one place: this header, on the server.
      authorization: `Bearer ${options.apiKey}`,
    };
    if (options.organization) headers['openai-organization'] = options.organization;
    if (options.project) headers['openai-project'] = options.project;
    return doFetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.any(signals),
      cache: 'no-store',
    });
  }

  return {
    id: 'openai',
    model: options.model,
    tier: options.tier,

    async send(request: ProviderRequest): Promise<ProviderReply> {
      /*
       * Counted here, per call, because the loop sums what each step cost. A
       * counter living on the provider would accumulate across the steps of
       * one turn and be added again each time.
       */
      let requests = 0;
      const sendOne = async (body: Record<string, unknown>, signal?: AbortSignal) => {
        requests += 1;
        return post(body, signal);
      };

      const common: Record<string, unknown> = {
        model: options.model,
        messages: [
          { role: 'system', content: request.system },
          ...request.messages.map(wireMessage),
        ],
        /*
         * `auto` rather than `required`. A question the records cannot answer
         * should get "I could not establish that", and forcing a tool call
         * turns that into a guess dressed up as a lookup.
         */
        tool_choice: 'auto',
        /*
         * No `strict: true`, for the reason `groq.ts` gives: two tools take a
         * genuinely optional argument with a default, strict mode requires
         * every property to be `required`, and every tool validates its own
         * arguments with Zod anyway — a guard the tests actually exercise.
         */
        tools: wireTools(request.tools),
      };

      /** The output ceiling, under the name this deployment accepts. */
      let limitKey = 'max_completion_tokens';
      const withLimit = (base: Record<string, unknown>) => ({
        ...base,
        [limitKey]: request.maxOutputTokens,
      });
      /* Optional, and dropped together if this deployment rejects them. */
      const optional: Record<string, unknown> = { reasoning_effort: request.effort };

      let response: Response;
      let text: string;
      const attempt = async (body: Record<string, unknown>) => {
        try {
          response = await sendOne(body, request.signal);
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
      };

      await attempt(withLimit({ ...common, ...optional }));

      /*
       * The output-limit parameter, under its other name. `max_tokens` was
       * the name for years and `max_completion_tokens` replaced it; which one
       * a given deployment insists on is not something the public
       * documentation settles, and a feature that dies on that is a feature
       * that dies for a word.
       */
      if (!response!.ok && response!.status === 400 && looksLikeOutputLimitName(text!)) {
        limitKey = limitKey === 'max_completion_tokens' ? 'max_tokens' : 'max_completion_tokens';
        await attempt(withLimit({ ...common, ...optional }));
      }

      /* An optional parameter this deployment does not recognise. */
      if (!response!.ok && response!.status === 400 && looksLikeUnknownParameter(text!)) {
        await attempt(withLimit(common));
      }

      /*
       * Up to two more samples when the model's own output was refused. The
       * request is sound and the next sample usually is too.
       */
      for (
        let tries = 0;
        tries < 2 &&
        !response!.ok &&
        classify(response!.status, response!.headers, text!) === 'malformed_generation';
        tries += 1
      ) {
        await attempt(withLimit({ ...common, ...optional }));
      }

      if (!response!.ok) {
        const kind = classify(response!.status, response!.headers, text!);
        throw new ProviderError(kind, messageFrom(text!), {
          status: response!.status,
          retryAfterMs:
            parseResetDuration(response!.headers.get('retry-after')) ??
            parseResetDuration(response!.headers.get('x-ratelimit-reset-tokens')),
          requests,
        });
      }

      let parsed: ChatResponse;
      try {
        parsed = JSON.parse(text!) as ChatResponse;
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
