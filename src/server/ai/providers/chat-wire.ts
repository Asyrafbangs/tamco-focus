import 'server-only';

import { NO_USAGE, type AiMessage, type AiToolCall, type TokenUsage } from '@/domain/ai';

/**
 * The OpenAI chat-completions dialect, shared by the providers that speak it.
 *
 * Groq implements OpenAI's chat API deliberately, and gpt-5.4-mini is served
 * by OpenAI's own. The message shape, the tool-call shape, the usage block and
 * the `x-ratelimit-reset-*` duration format are therefore the same for both,
 * and were written twice before this file existed. Two copies of a wire format
 * is how one of them quietly stops matching the other.
 *
 * What is *not* here is anything either provider does differently: the
 * endpoint, which optional parameters exist, and above all how a failure is
 * classified. Those live in the provider, because that is where they differ.
 */

/* The OpenAI chat shapes, only as far as we use them. */

export interface ChatToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
  /*
   * Some deployments report a call flattened, without the `function` wrapper.
   * Reading both costs one `??` and saves an investigation that silently
   * calls no tools because the wrapper was not where we looked.
   */
  name?: string;
  arguments?: string;
}

export interface ChatChoice {
  message?: { role?: string; content?: string | null; tool_calls?: ChatToolCall[] };
  finish_reason?: string;
}

export interface ChatResponse {
  model?: string;
  choices?: ChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    /** What the Responses API calls them; accepted in case a deployment uses it. */
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string; type?: string; code?: string };
}

/** Our neutral message, as the OpenAI chat shape wants it. */
export function wireMessage(message: AiMessage): Record<string, unknown> {
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
 * `2m59.56s`, `7.66s`, `120` — a reset header, in milliseconds.
 *
 * Both providers use this format: OpenAI documents `x-ratelimit-reset-tokens`
 * as `6m0s`, Groq as `2m59.56s`.
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

export function messageFrom(body: string): string {
  try {
    const parsed = JSON.parse(body) as ChatResponse;
    return parsed.error?.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

/** Whether a 400 is about a parameter this deployment does not know. */
export function looksLikeUnknownParameter(body: string): boolean {
  return /unrecognized|unknown|unsupported|not supported|invalid.*(parameter|field|argument)|additional propert/i.test(
    body,
  );
}

export function usageFrom(response: ChatResponse): TokenUsage {
  const usage = response.usage;
  if (!usage) return { ...NO_USAGE };
  const cached =
    usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0;
  const prompt = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  return {
    // Prompt tokens are reported inclusive of anything served from cache, so
    // the cached part is subtracted out to avoid counting it at both rates.
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
    cachedInputTokens: cached,
    /*
     * Zero because this dialect does not break it out, not because gpt-oss
     * does not reason. It does, visibly, and that thinking is inside
     * `completion_tokens` exactly as it is on the Responses API - there is
     * simply no field here that says how much of it was thinking.
     */
    reasoningTokens: 0,
  };
}

export function toolCallsFrom(choice: ChatChoice): AiToolCall[] {
  return (choice.message?.tool_calls ?? [])
    .map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? call.name ?? '',
      // Left as the string the model wrote. The tool parses it and refuses it
      // if it is not what the schema asked for; trusting it here would move
      // that decision somewhere it cannot be tested.
      arguments: call.function?.arguments ?? call.arguments ?? '{}',
    }))
    .filter((call) => call.name !== '');
}

/** The tool list, as the chat API wants it. */
export function wireTools(
  tools: ReadonlyArray<{ name: string; description: string; parameters: Record<string, unknown> }>,
): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * What the reply means: tools wanted, answer finished, or cut off mid-sentence.
 *
 * `length` is reported as truncated rather than answered, because the
 * alternative is showing somebody half a conclusion as though it were the
 * whole one.
 */
export function stopFrom(
  toolCalls: readonly AiToolCall[],
  finishReason: string | undefined,
): 'answered' | 'tool_calls' | 'truncated' {
  if (toolCalls.length > 0) return 'tool_calls';
  return finishReason === 'length' ? 'truncated' : 'answered';
}
