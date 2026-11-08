import { describe, expect, it, vi } from 'vitest';

import {
  classify,
  createOpenAiProvider,
  inputItemsFrom,
  textFrom,
  toolCallsFrom,
  usageFrom,
} from '@/server/ai/providers/openai';
import { stopWords, totalTokens } from '@/domain/ai';
import { ProviderError, stopReasonFor } from '@/server/ai/providers/types';

/**
 * v297 — the OpenAI provider, against a stubbed `fetch`.
 *
 * It was written for chat-completions first, because Groq speaks that dialect
 * and the translation was already here. The real API refused it:
 *
 *   Function tools with reasoning_effort are not supported for gpt-5.4-mini
 *   in /v1/chat/completions. To use function tools, use /v1/responses or set
 *   reasoning_effort to 'none'.
 *
 * So these hold the Responses dialect instead, and every shape in them was
 * confirmed against the live API before it was written — including the two
 * the public documentation does not state: that a conversation replayed
 * without the model's reasoning items is accepted, and that `store: false` is
 * honoured.
 *
 * The other half is billing. The first real contact with this API was
 * `credit_balance_exhausted`, and a 429 read as a throttle is an afternoon
 * spent waiting for something that will never arrive.
 */

const TOOL = {
  name: 'list_my_tasks',
  description: 'The signed-in person’s own tasks',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
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

/** A finished answer, in the shape the live API returns. */
const ANSWER = {
  model: 'gpt-5.4-mini-2026-03-17',
  status: 'completed',
  incomplete_details: null,
  output: [
    { type: 'reasoning', id: 'rs_1' },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Two actions are overdue.' }],
    },
  ],
  usage: {
    input_tokens: 1_200,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 80,
    output_tokens_details: { reasoning_tokens: 31 },
    total_tokens: 1_280,
  },
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

function bodyOf(fetchStub: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  return JSON.parse(String(fetchStub.mock.calls[index]![1]!.body));
}

describe('v297 what the OpenAI provider sends', () => {
  it('speaks Responses: instructions, input items, flat tools, reasoning and a ceiling', async () => {
    const fetchStub = vi.fn(async (_url: string, _init: RequestInit) => okResponse(ANSWER));
    await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);

    expect(String(fetchStub.mock.calls[0]![0])).toBe('https://api.openai.com/v1/responses');
    const body = bodyOf(fetchStub);
    expect(body.model).toBe('gpt-5.4-mini');
    expect(body.instructions).toBe('You read records.');
    expect(body.input).toEqual([{ role: 'user', content: 'What is overdue?' }]);
    expect(body.reasoning).toEqual({ effort: 'medium' });
    expect(body.max_output_tokens).toBe(2_000);
    expect(body.tool_choice).toBe('auto');
    /*
     * Flat: `{type, name, parameters}` with no nested `function` object, which
     * is what this API wants and what chat-completions did not.
     */
    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'list_my_tasks',
        description: 'The signed-in person’s own tasks',
        parameters: TOOL.parameters,
      },
    ]);
    // Never sent: the loop has no opinion about either.
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
  });

  it('asks the service not to retain the company’s records', async () => {
    const fetchStub = vi.fn(async () => okResponse(ANSWER));
    await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);
    /*
     * These requests carry real findings. `store: false` is the reason this
     * provider can be pointed at them at all, so it is asserted rather than
     * assumed.
     */
    expect(bodyOf(fetchStub).store).toBe(false);
  });

  it('carries the key, and the account headers only when they are set', async () => {
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
});

describe('v297 the conversation, as a list of items', () => {
  it('turns a tool call and its result into two items joined by one id', () => {
    const items = inputItemsFrom([
      { role: 'user', content: 'What is overdue?' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_abc', name: 'list_my_tasks', arguments: '{}' }],
      },
      { role: 'tool', content: '[]', toolCallId: 'call_abc', name: 'list_my_tasks' },
    ]);

    expect(items).toEqual([
      { role: 'user', content: 'What is overdue?' },
      { type: 'function_call', call_id: 'call_abc', name: 'list_my_tasks', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_abc', output: '[]' },
    ]);
  });

  it('keeps an assistant’s words when it both spoke and called a tool', () => {
    const items = inputItemsFrom([
      {
        role: 'assistant',
        content: 'Let me check.',
        toolCalls: [{ id: 'c1', name: 'list_my_tasks', arguments: '{}' }],
      },
    ]);
    expect(items[0]).toEqual({ role: 'assistant', content: 'Let me check.' });
    expect(items[1]).toMatchObject({ type: 'function_call', call_id: 'c1' });
  });

  it('does not replay the model’s reasoning, which is never stored', () => {
    /*
     * Confirmed against the live API: a conversation without the reasoning
     * items is accepted and answered. If that were not true, this product
     * could not hold a multi-step investigation at all, because it keeps no
     * chain of thought by design.
     */
    const items = inputItemsFrom([
      { role: 'user', content: 'Why?' },
      { role: 'assistant', content: 'Because the queue is 19 days deep.' },
    ]);
    expect(items.some((item) => item.type === 'reasoning')).toBe(false);
  });
});

describe('v297 reading the reply', () => {
  it('joins every output_text and ignores the reasoning item', () => {
    expect(
      textFrom([
        { type: 'reasoning' },
        { type: 'message', content: [{ type: 'output_text', text: 'One. ' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Two.' }] },
      ]),
    ).toBe('One. Two.');
  });

  it('reads a function call from its item, carrying the call id', () => {
    expect(
      toolCallsFrom([
        { type: 'reasoning' },
        {
          type: 'function_call',
          call_id: 'call_lCrom8',
          name: 'list_my_tasks',
          arguments: '{"days":7}',
        },
      ]),
    ).toEqual([{ id: 'call_lCrom8', name: 'list_my_tasks', arguments: '{"days":7}' }]);
  });

  it('counts cached input once, and keeps reasoning inside the output it was billed as', () => {
    const usage = usageFrom({
      usage: {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 400 },
        output_tokens: 80,
        output_tokens_details: { reasoning_tokens: 31 },
      },
    });
    /*
     * 1,000 reported inclusive of cache, so 600 is charged at the full rate.
     * The 31 reasoning tokens stay inside the 80: they were billed at the
     * output rate, and netting them off would under-report what was spent.
     */
    expect(usage).toEqual({
      inputTokens: 600,
      outputTokens: 80,
      cachedInputTokens: 400,
      reasoningTokens: 31,
    });
    /*
     * Reported, and reported as a SUBSET. Both halves matter: without the
     * first, a reasoning model's output spend is unattributable; without the
     * second, the rate-limit estimate counts 31 tokens that were never spent
     * twice and the loop stops early for budget it still has.
     */
    expect(usage.reasoningTokens).toBeLessThanOrEqual(usage.outputTokens);
    expect(totalTokens(usage)).toBe(600 + 80 + 400);
  });

  it('reports no reasoning rather than guessing when the provider omits the detail', () => {
    const usage = usageFrom({
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(usage.reasoningTokens).toBe(0);
  });

  it('reports tool calls, a finished answer and a truncated one distinctly', async () => {
    const answered = vi.fn(async () => okResponse(ANSWER));
    expect((await providerWith(answered as unknown as typeof fetch).send(REQUEST)).stop).toBe(
      'answered',
    );

    const calling = vi.fn(async () =>
      okResponse({
        ...ANSWER,
        output: [{ type: 'function_call', call_id: 'c1', name: 'list_my_tasks', arguments: '{}' }],
      }),
    );
    const wanted = await providerWith(calling as unknown as typeof fetch).send(REQUEST);
    expect(wanted.stop).toBe('tool_calls');
    expect(wanted.toolCalls).toHaveLength(1);

    /*
     * Incomplete at the ceiling. On a reasoning model this can arrive with no
     * text at all — the whole budget spent thinking — and either way it is
     * not an answer.
     */
    const cut = vi.fn(async () =>
      okResponse({
        ...ANSWER,
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'reasoning', id: 'rs_1' }],
      }),
    );
    const truncated = await providerWith(cut as unknown as typeof fetch).send(REQUEST);
    expect(truncated.stop).toBe('truncated');
    expect(truncated.text).toBe('');
  });

  it('names the model the service actually served', async () => {
    const fetchStub = vi.fn(async () => okResponse(ANSWER));
    const reply = await providerWith(fetchStub as unknown as typeof fetch).send(REQUEST);
    expect(reply.model).toBe('gpt-5.4-mini-2026-03-17');
    expect(reply.requests).toBe(1);
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
    ['the wording the live API used', '{"error":{"message":"You have no credits remaining."}}'],
  ])('treats %s as a bill, which waiting cannot clear', (_name, body) => {
    /*
     * v309 — its own kind, not the daily allowance's.
     *
     * This suite has told a wait from a bill since v297 and then handed both
     * to the same stop reason, so the screen said "the assistant's daily
     * allowance is shared across everyone here, and it is used up" when the
     * API had said "You have no credits remaining" - seen in production on
     * 8 November. The honest action, topping up, was invisible; the apparent
     * one, waiting until tomorrow, would have failed again.
     */
    expect(classify(429, headers, body)).toBe('credits_exhausted');
    expect(stopReasonFor('credits_exhausted')).toBe('credits');
  });

  it('says what to do about a bill, and does not call it an allowance', () => {
    const said = stopWords({ stop: 'credits', readCount: 0 });
    expect(said).toMatch(/no credits/i);
    expect(said).not.toMatch(/daily allowance/i);
    expect(said).toMatch(/add credits/i);
    /* And the daily allowance keeps its own words. */
    expect(stopWords({ stop: 'quota', readCount: 0 })).toMatch(/daily allowance/i);
  });

  it.each([
    ['slow_down', '{"error":{"code":"slow_down"}}'],
    ['the per-minute bucket', '{"error":{"message":"Rate limit reached for requests"}}'],
  ])('treats %s as a wait', (_name, body) => {
    expect(classify(429, headers, body)).toBe('rate_limited');
    expect(stopReasonFor('rate_limited')).toBe('rate_limited');
  });

  it('falls back to the headers when the body says neither', () => {
    expect(classify(429, new Headers({ 'x-ratelimit-reset-tokens': '6m0s' }), '{}')).toBe(
      'rate_limited',
    );
    expect(classify(429, new Headers({ 'x-ratelimit-reset-tokens': '2h30m0s' }), '{}')).toBe(
      'quota_exhausted',
    );
    expect(classify(429, new Headers({ 'retry-after': '3600' }), '{}')).toBe('quota_exhausted');
  });

  it('classifies the rest the way the loop needs to act on them', () => {
    expect(classify(401, headers, '')).toBe('auth');
    expect(classify(404, headers, '{"error":{"message":"The model does not exist"}}')).toBe(
      'bad_request',
    );
    expect(classify(400, headers, '{"error":{"code":"context_length_exceeded"}}')).toBe(
      'context_too_long',
    );
    expect(classify(413, headers, '')).toBe('context_too_long');
    expect(classify(408, headers, '')).toBe('timeout');
    expect(classify(503, headers, '{"error":{"code":"server_is_overloaded"}}')).toBe('server');
  });

  it('asks for another sample when the model’s own output was refused', async () => {
    const refusal = () => errorResponse(400, { error: { message: 'output_parse_failed' } });
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

  it('never quietly drops the reasoning to make a request legal', async () => {
    /*
     * The trap this model sets. On chat-completions, tools plus
     * `reasoning_effort` is a 400 that names the parameter — and a provider
     * that answered by dropping it would succeed, every time, running an
     * investigator that does not think. Nothing here retries without
     * reasoning: the request is the request.
     */
    const fetchStub = vi.fn(async () =>
      errorResponse(400, {
        error: { message: 'Unsupported parameter: reasoning', param: 'reasoning' },
      }),
    );
    await providerWith(fetchStub as unknown as typeof fetch)
      .send(REQUEST)
      .catch(() => undefined);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchStub as ReturnType<typeof vi.fn>).reasoning).toEqual({ effort: 'medium' });
  });

  it('carries the wait the service asked for, and what the attempt cost', async () => {
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
        expect(error.requests).toBe(1);
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

  it('refuses a reply that is not JSON, and one with no output at all', async () => {
    const notJson = vi.fn(async () => new Response('<html>502</html>', { status: 200 }));
    await providerWith(notJson as unknown as typeof fetch)
      .send(REQUEST)
      .catch((error: ProviderError) => expect(error.kind).toBe('malformed'));

    const empty = vi.fn(async () => okResponse({ model: 'gpt-5.4-mini', output: [] }));
    await providerWith(empty as unknown as typeof fetch)
      .send(REQUEST)
      .catch((error: ProviderError) => expect(error.kind).toBe('malformed'));
  });
});
