import { describe, expect, it, vi } from 'vitest';

import {
  classify,
  createOpenAiProvider,
  looksLikeOutputLimitName,
} from '@/server/ai/providers/openai';
import { ProviderError, stopReasonFor } from '@/server/ai/providers/types';

/**
 * v297 — the OpenAI provider, against a stubbed `fetch`.
 *
 * The same two subjects as the Groq suite, for the same reasons: translation
 * one way and failure the other. What differs is what is unknown.
 *
 * OpenAI's model page settles the id, the endpoints, the effort values and
 * the prices. It does not settle, on any page readable without an account,
 * the Chat Completions parameter names or where cached tokens appear in a
 * chat usage block. The provider therefore adapts — it retries under the
 * other name for the output limit, drops optional parameters once, and reads
 * both cached-token paths — and those adaptations are what most of this file
 * holds, because an adaptation nobody tested is a guess with extra steps.
 *
 * The other half is billing. On Groq a misread 429 wasted an afternoon. Here
 * the difference is money: OpenAI documents several 429s that waiting cannot
 * clear, and each one is named in `classify` and asserted here.
 */

const TOOL = {
  name: 'list_my_tasks',
  description: 'The signed-in person’s own tasks',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

function okResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function errorResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const ANSWER = {
  model: 'gpt-5.4-mini-2026-03-17',
  choices: [
    { message: { role: 'assistant', content: 'Two actions are overdue.' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 1_200, completion_tokens: 80, total_tokens: 1_280 },
};

function providerWith(fetchImpl: typeof fetch, extra: Record<string, unknown> = {}) {
  return createOpenAiProvider({
    apiKey: 'test-key-not-a-real-one',
    model: 'gpt-5.4-mini',
    tier: 'paid',
    fetchImpl,
    ...extra,
  });
}

const REQUEST = {
  system: 'You read records.',
  messages: [{ role: 'user' as const, content: 'What is overdue?' }],
  tools: [TOOL],
  maxOutputTokens: 2_000,
  effort: 'medium' as const,
};

/** The JSON body of the nth call to the stub. */
function bodyOf(fetchStub: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchStub.mock.calls[index]![1]!.body));
}

describe('v297 what the OpenAI provider sends', () => {
  it('sends the model, the effort and the output ceiling, and no sampling knobs', async () => {
    const fetchStub = vi.fn(async () => okResponse(ANSWER));
    await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);

    const body = bodyOf(fetchStub);
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.reasoning_effort).toBe('medium');
    expect(body.max_completion_tokens).toBe(2_000);
    /*
     * Never sent. The loop has no opinion about temperature, and a reasoning
     * model that rejects it would fail every request for a parameter we did
     * not need.
     */
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    // Groq's own extension, which OpenAI does not document.
    expect(body).not.toHaveProperty('include_reasoning');
  });

  it('offers tools without forcing one, and without strict mode', async () => {
    const fetchStub = vi.fn(async () => okResponse(ANSWER));
    await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);

    const body = bodyOf(fetchStub);
    expect(body.tool_choice).toBe('auto');
    const tools = body.tools as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ type: 'function' });
    expect((tools[0]!.function as Record<string, unknown>).name).toBe('list_my_tasks');
    expect(tools[0]).not.toHaveProperty('strict');
  });

  it('carries the key, and the account headers only when they are set', async () => {
    // Typed parameters, so the call record carries the init object.
    const plain = vi.fn(async (_url: string, _init: RequestInit) => okResponse(ANSWER));
    await providerWith(plain as unknown as typeof fetch).send(REQUEST);
    const headers = plain.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-key-not-a-real-one');
    expect(headers).not.toHaveProperty('openai-organization');

    const scoped = vi.fn(async (_url: string, _init: RequestInit) => okResponse(ANSWER));
    await providerWith(scoped as unknown as typeof fetch, {
      organization: 'org-tamco',
      project: 'proj-jarvis',
    }).send(REQUEST);
    const scopedHeaders = scoped.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(scopedHeaders['openai-organization']).toBe('org-tamco');
    expect(scopedHeaders['openai-project']).toBe('proj-jarvis');
  });

  it('sends an assistant turn’s tool calls back, so the results answer something', async () => {
    const fetchStub = vi.fn(async () => okResponse(ANSWER));
    await providerWith(fetchStub as unknown as typeof fetch).send({
      ...REQUEST,
      messages: [
        { role: 'user', content: 'What is overdue?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'list_my_tasks', arguments: '{}' }],
        },
        { role: 'tool', content: '[]', toolCallId: 'call_1', name: 'list_my_tasks' },
      ],
    });

    const messages = bodyOf(fetchStub).messages as Array<Record<string, unknown>>;
    expect(messages[0]).toMatchObject({ role: 'system' });
    const assistant = messages[2] as { tool_calls?: Array<Record<string, unknown>> };
    expect(assistant.tool_calls?.[0]).toMatchObject({ id: 'call_1', type: 'function' });
    expect(messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
  });
});

describe('v297 adapting to what the documentation does not settle', () => {
  it('retries under the other output-limit name when the first is refused', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(
        errorResponse(400, {
          error: { message: "Unsupported parameter: 'max_completion_tokens'", type: 'invalid' },
        }),
      )
      .mockResolvedValueOnce(okResponse(ANSWER));

    const reply = await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);

    expect(bodyOf(fetchStub, 0)).toHaveProperty('max_completion_tokens');
    const second = bodyOf(fetchStub, 1);
    expect(second.max_tokens).toBe(2_000);
    expect(second).not.toHaveProperty('max_completion_tokens');
    // And the retry is counted: a refused request costs the allowance too.
    expect(reply.requests).toBe(2);
    expect(reply.text).toBe('Two actions are overdue.');
  });

  it('drops the optional parameters when the deployment does not know them', async () => {
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(
        errorResponse(400, {
          error: { message: 'Unrecognized request argument supplied: reasoning_effort' },
        }),
      )
      .mockResolvedValueOnce(okResponse(ANSWER));

    await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);

    expect(bodyOf(fetchStub, 0)).toHaveProperty('reasoning_effort');
    const second = bodyOf(fetchStub, 1);
    expect(second).not.toHaveProperty('reasoning_effort');
    // The ceiling is still sent: it is not one of the optional ones.
    expect(second.max_completion_tokens).toBe(2_000);
  });

  it('reads cached tokens from either place the usage block may put them', async () => {
    const chatShape = vi.fn(async () =>
      okResponse({
        ...ANSWER,
        usage: {
          prompt_tokens: 1_000,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 400 },
        },
      }),
    );
    const chat = await providerWith(chatShape as unknown as typeof fetch).send(REQUEST);
    // 1,000 reported, 400 of them cached: 600 charged at the full rate.
    expect(chat.usage).toEqual({ inputTokens: 600, outputTokens: 50, cachedInputTokens: 400 });

    const responsesShape = vi.fn(async () =>
      okResponse({
        ...ANSWER,
        usage: {
          input_tokens: 1_000,
          output_tokens: 50,
          input_tokens_details: { cached_tokens: 400 },
        },
      }),
    );
    const responses = await providerWith(responsesShape as unknown as typeof fetch).send(REQUEST);
    expect(responses.usage).toEqual({ inputTokens: 600, outputTokens: 50, cachedInputTokens: 400 });
  });

  it('reads a tool call whether or not it is wrapped in `function`', async () => {
    const wrapped = vi.fn(async () =>
      okResponse({
        ...ANSWER,
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                { id: 'a', type: 'function', function: { name: 'list_my_tasks', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );
    const first = await providerWith(wrapped as unknown as typeof fetch).send(REQUEST);
    expect(first.stop).toBe('tool_calls');
    expect(first.toolCalls).toEqual([{ id: 'a', name: 'list_my_tasks', arguments: '{}' }]);

    const flat = vi.fn(async () =>
      okResponse({
        ...ANSWER,
        choices: [
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                { id: 'b', type: 'function', name: 'list_my_tasks', arguments: '{"days":7}' },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    );
    const second = await providerWith(flat as unknown as typeof fetch).send(REQUEST);
    expect(second.toolCalls).toEqual([{ id: 'b', name: 'list_my_tasks', arguments: '{"days":7}' }]);
  });

  it('reports a reply cut off at its length limit as truncated, not as an answer', async () => {
    const fetchStub = vi.fn(async () =>
      okResponse({
        ...ANSWER,
        choices: [
          {
            message: { role: 'assistant', content: 'The three overdue actions are' },
            finish_reason: 'length',
          },
        ],
      }),
    );
    const reply = await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);
    expect(reply.stop).toBe('truncated');
  });

  it('names the model the service actually served', async () => {
    const fetchStub = vi.fn(async () => okResponse(ANSWER));
    const reply = await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);
    // Asked for the alias, served by the snapshot: the snapshot is recorded.
    expect(reply.model).toBe('gpt-5.4-mini-2026-03-17');
  });
});

describe('v297 telling a wait apart from a bill', () => {
  const headers = new Headers();

  it.each([
    ['credit_balance_exhausted', '{"error":{"code":"credit_balance_exhausted"}}'],
    ['insufficient_quota', '{"error":{"type":"insufficient_quota"}}'],
    ['organization spend limit', '{"error":{"code":"organization_spend_limit_exceeded"}}'],
    ['project spend limit', '{"error":{"code":"project_spend_limit_exceeded"}}'],
    ['organization usage limit', '{"error":{"code":"organization_usage_limit_exceeded"}}'],
    ['the older wording', '{"error":{"message":"You exceeded your current quota"}}'],
  ])('treats %s as a quota, which waiting cannot clear', (_name, body) => {
    expect(classify(429, headers, body)).toBe('quota_exhausted');
    expect(stopReasonFor('quota_exhausted')).toBe('quota');
  });

  it.each([
    ['slow_down', '{"error":{"code":"slow_down"}}'],
    ['the per-minute bucket', '{"error":{"message":"Rate limit reached for requests"}}'],
  ])('treats %s as a wait', (_name, body) => {
    expect(classify(429, headers, body)).toBe('rate_limited');
    expect(stopReasonFor('rate_limited')).toBe('rate_limited');
  });

  it('falls back to the headers when the body says neither', () => {
    const soon = new Headers({ 'x-ratelimit-reset-tokens': '6m0s' });
    expect(classify(429, soon, '{}')).toBe('rate_limited');

    // Hours away is not something to sit and wait for.
    const hours = new Headers({ 'x-ratelimit-reset-tokens': '2h30m0s' });
    expect(classify(429, hours, '{}')).toBe('quota_exhausted');

    const asked = new Headers({ 'retry-after': '3600' });
    expect(classify(429, asked, '{}')).toBe('quota_exhausted');
  });

  it('classifies the rest the way the loop needs to act on them', () => {
    expect(classify(401, headers, '')).toBe('auth');
    expect(classify(403, headers, '')).toBe('auth');
    expect(classify(404, headers, '{"error":{"message":"The model does not exist"}}')).toBe(
      'bad_request',
    );
    expect(classify(400, headers, '{"error":{"code":"context_length_exceeded"}}')).toBe(
      'context_too_long',
    );
    expect(classify(413, headers, '')).toBe('context_too_long');
    expect(classify(408, headers, '')).toBe('timeout');
    expect(classify(503, headers, '{"error":{"code":"server_is_overloaded"}}')).toBe('server');
    expect(classify(500, headers, '')).toBe('server');
  });

  it('asks for another sample when the model’s own output was refused', async () => {
    const refusal = () =>
      errorResponse(400, { error: { message: 'tool_use_failed: commentary is not a tool' } });
    const fetchStub = vi
      .fn()
      .mockResolvedValueOnce(refusal())
      .mockResolvedValueOnce(refusal())
      .mockResolvedValueOnce(okResponse(ANSWER));

    const reply = await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);
    expect(reply.text).toBe('Two actions are overdue.');
    // Three requests spent, and all three counted against the allowance.
    expect(reply.requests).toBe(3);
  });

  it('gives up after the resamples, carrying what the attempt cost', async () => {
    const fetchStub = vi.fn(async () =>
      errorResponse(400, { error: { message: 'output_parse_failed' } }),
    );
    const sending = providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);
    await expect(sending).rejects.toBeInstanceOf(ProviderError);
    await sending.catch((error: ProviderError) => {
      expect(error.kind).toBe('malformed_generation');
      expect(error.requests).toBe(3);
      expect(error.retryable).toBe(true);
    });
  });

  it('carries the wait the service asked for', async () => {
    const fetchStub = vi.fn(async () =>
      errorResponse(
        429,
        { error: { message: 'Rate limit reached for requests' } },
        { 'retry-after': '12' },
      ),
    );
    await providerWith(fetchStub as unknown as typeof fetch)
      .send(REQUEST)
      .catch((error: ProviderError) => {
        expect(error.kind).toBe('rate_limited');
        expect(error.retryAfterMs).toBe(12_000);
        expect(error.status).toBe(429);
      });
  });

  it('reports an abort as a timeout rather than a failure of the records', async () => {
    const fetchStub = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    await providerWith(fetchStub as unknown as typeof fetch)
      .send(REQUEST)
      .catch((error: ProviderError) => {
        expect(error.kind).toBe('timeout');
        expect(stopReasonFor('timeout')).toBe('clock');
      });
  });

  it('refuses a reply that is not JSON, and one with no choices', async () => {
    const notJson = vi.fn(async () => new Response('<html>502</html>', { status: 200 }));
    await providerWith(notJson as unknown as typeof fetch)
      .send(REQUEST)
      .catch((error: ProviderError) => expect(error.kind).toBe('malformed'));

    const empty = vi.fn(async () => okResponse({ model: 'gpt-5.4-mini', choices: [] }));
    await providerWith(empty as unknown as typeof fetch)
      .send(REQUEST)
      .catch((error: ProviderError) => expect(error.kind).toBe('malformed'));
  });
});

describe('v297 the output-limit sniffer', () => {
  it('recognises a complaint about the parameter’s name, and nothing else', () => {
    expect(looksLikeOutputLimitName("Unsupported parameter: 'max_completion_tokens'")).toBe(true);
    expect(looksLikeOutputLimitName('Use max_tokens instead')).toBe(true);
    expect(looksLikeOutputLimitName('Invalid value for temperature')).toBe(false);
  });
});
