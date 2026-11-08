import 'server-only';

import { NO_USAGE, type AiMessage, type AiToolCall, type TokenUsage } from '@/domain/ai';
import { messageFrom, parseResetDuration } from '@/server/ai/providers/chat-wire';
import {
  ProviderError,
  type AiProvider,
  type ProviderErrorKind,
  type ProviderReply,
  type ProviderRequest,
} from '@/server/ai/providers/types';

/**
 * OpenAI, on the Responses endpoint.
 *
 * It was written against chat-completions first, because Groq speaks that
 * dialect and the translation was already here. The real API refused it:
 *
 *   Function tools with reasoning_effort are not supported for gpt-5.4-mini
 *   in /v1/chat/completions. To use function tools, use /v1/responses or set
 *   reasoning_effort to 'none'.
 *
 * Tools or reasoning, not both — and this assistant is eight tools and a
 * reasoning budget. `reasoning_effort: 'none'` would have kept the request
 * legal and quietly taken the thinking out of an investigator, which is the
 * one trade this product must not make silently. So it speaks Responses.
 *
 * Nothing above this file changed: the loop still calls `send` and gets text,
 * tool calls and a token count. The dialect is wider than chat-completions —
 * input is a list of typed items rather than messages, a tool call is an item
 * rather than a field, and reasoning is an item we neither ask for nor keep.
 *
 * Every shape below was confirmed against the live API before it was written,
 * including the parts the public documentation does not state: that a
 * conversation replayed **without** the model's reasoning items is accepted
 * (this codebase never stores them), and that `store: false` is honoured, so
 * a company's records are not retained by the service after the answer.
 *
 * **Not streamed,** for the reason the Groq provider gives: usage drives the
 * budget, and the route already streams our own step events.
 */

const ENDPOINT = 'https://api.openai.com/v1/responses';

/* The Responses shapes, only as far as we use them. */

interface ResponseItem {
  type?: string;
  /* function_call */
  call_id?: string;
  name?: string;
  arguments?: string;
  /* message */
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
}

interface ResponsesReply {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output?: ResponseItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; type?: string; code?: string } | null;
}

/**
 * Our neutral conversation, as a list of Responses input items.
 *
 * Three kinds go up. A plain turn is a role and its text. An assistant turn
 * that asked for tools becomes one `function_call` item per call — the whole
 * turn, not a field on it — and each tool result is a `function_call_output`
 * carrying the same `call_id`. Lose that id and the results answer nothing.
 *
 * The model's own `reasoning` items are not replayed, because they are never
 * stored. Confirmed against the live API: a conversation without them is
 * accepted and answered.
 */
export function inputItemsFrom(messages: readonly AiMessage[]): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'tool') {
      items.push({
        type: 'function_call_output',
        call_id: message.toolCallId,
        output: message.content,
      });
      continue;
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      if (message.content) items.push({ role: 'assistant', content: message.content });
      for (const call of message.toolCalls) {
        items.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
      }
      continue;
    }
    items.push({ role: message.role, content: message.content });
  }
  return items;
}

/** The answer's text: every `output_text` the message items carry. */
export function textFrom(output: readonly ResponseItem[]): string {
  return output
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text')
    .map((part) => part.text ?? '')
    .join('');
}

export function toolCallsFrom(output: readonly ResponseItem[]): AiToolCall[] {
  return output
    .filter((item) => item.type === 'function_call' && item.name)
    .map((item, index) => ({
      id: item.call_id ?? `call_${index}`,
      name: item.name!,
      // Left as the string the model wrote. The tool parses it and refuses it
      // if it is not what the schema asked for.
      arguments: item.arguments ?? '{}',
    }));
}

/**
 * What the turn cost.
 *
 * `output_tokens` includes the reasoning the model did before writing, and
 * reasoning is billed at the output rate. That is the single biggest
 * difference from gpt-oss on Groq for the purposes of a cost comparison, and
 * it is not a surcharge to be netted off: thinking is what was paid for.
 */
export function usageFrom(reply: ResponsesReply): TokenUsage {
  const usage = reply.usage;
  if (!usage) return { ...NO_USAGE };
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  return {
    inputTokens: Math.max(0, (usage.input_tokens ?? 0) - cached),
    outputTokens: usage.output_tokens ?? 0,
    cachedInputTokens: cached,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
  };
}

/**
 * Which kind of failure a response represents.
 *
 * The distinction that matters is between a wait and a bill. OpenAI draws it
 * plainly: a 429 is either traffic this minute, which waiting fixes, or
 * money, which it does not. The billing codes are named here because the
 * first real contact with this API was one of them —
 * `credit_balance_exhausted` — and a harness that read it as a throttle slept
 * five times against a refusal that could never succeed.
 */
export function classify(status: number, headers: Headers, body: string): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) {
    if (
      /credit_balance_exhausted|insufficient_quota|spend_limit_exceeded|usage_limit_exceeded|billing_hard_limit_reached|exceeded your current quota|no credits remaining/i.test(
        body,
      )
    ) {
      return 'credits_exhausted';
    }
    if (/slow_down|rate limit reached|rate_limit/i.test(body)) return 'rate_limited';
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
  if (status >= 500) return 'server';
  return 'bad_request';
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
   * Longer than Groq's 25 seconds. A reasoning model asked to work at `high`
   * on a conversation carrying several tool results takes longer than a fast
   * non-reasoning one, and a timeout shorter than the model's honest thinking
   * time turns good answers into failures.
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
      let requests = 0;
      const sendOne = async (body: Record<string, unknown>, signal?: AbortSignal) => {
        requests += 1;
        return post(body, signal);
      };

      const body: Record<string, unknown> = {
        model: options.model,
        instructions: request.system,
        input: inputItemsFrom(request.messages),
        /*
         * `auto` rather than `required`. A question the records cannot answer
         * should get "I could not establish that", and forcing a tool call
         * turns that into a guess dressed up as a lookup.
         */
        tool_choice: 'auto',
        /*
         * Flattened, which is how this API wants a function tool: no nested
         * `function` object. No `strict` either, for the reason `groq.ts`
         * gives — two tools take a genuinely optional argument with a
         * default, and every tool validates its own arguments with Zod.
         */
        tools: request.tools.map((tool) => ({
          type: 'function',
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        })),
        reasoning: { effort: request.effort },
        max_output_tokens: request.maxOutputTokens,
        /*
         * The company's own records are in these requests. `store: false`
         * asks OpenAI not to retain the response, and is the reason this
         * provider can be pointed at real findings at all. Confirmed
         * accepted and echoed back as `false` by the live API.
         */
        store: false,
      };

      let response: Response;
      let text: string;
      const attempt = async () => {
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

      await attempt();

      /*
       * Up to two more samples when the model's own output was refused. No
       * fallback that drops `reasoning` and tries again: on this model that
       * would be a request for an investigator that does not think, answered
       * successfully, and nobody would be told.
       */
      for (
        let tries = 0;
        tries < 2 &&
        !response!.ok &&
        classify(response!.status, response!.headers, text!) === 'malformed_generation';
        tries += 1
      ) {
        await attempt();
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

      let parsed: ResponsesReply;
      try {
        parsed = JSON.parse(text!) as ResponsesReply;
      } catch {
        throw new ProviderError('malformed', 'The model returned something that was not JSON.', {
          requests,
        });
      }

      const output = parsed.output ?? [];
      if (output.length === 0) {
        throw new ProviderError('malformed', 'The model returned no reply at all.', { requests });
      }

      const toolCalls = toolCallsFrom(output);
      /*
       * `incomplete` with `max_output_tokens` means the reply stopped
       * mid-thought — and on a reasoning model it can stop having spent the
       * whole budget thinking, with no text at all. Either way it is reported
       * as truncated rather than answered, because the alternative is showing
       * somebody half a conclusion as though it were the whole one.
       */
      const truncated =
        parsed.status === 'incomplete' && parsed.incomplete_details?.reason === 'max_output_tokens';

      return {
        text: textFrom(output),
        toolCalls,
        usage: usageFrom(parsed),
        stop: toolCalls.length > 0 ? 'tool_calls' : truncated ? 'truncated' : 'answered',
        model: parsed.model ?? options.model,
        requests,
      };
    },
  };
}
