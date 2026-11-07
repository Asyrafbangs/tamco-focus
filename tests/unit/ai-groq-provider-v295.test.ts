import { beforeEach, describe, expect, it, vi } from 'vitest';

import { classify, createGroqProvider, parseResetDuration } from '@/server/ai/providers/groq';
import { ProviderError, stopReasonFor } from '@/server/ai/providers/types';

/**
 * v295 — the Groq provider, against a stubbed `fetch`.
 *
 * Two things are under test. The first is translation: our neutral messages
 * into the OpenAI chat shape Groq speaks, and its reply back again, including
 * the parameters that are documented as unsupported on the gpt-oss models and
 * must therefore not be sent.
 *
 * The second is failure. On a free plan the interesting responses are the ones
 * that are not 200, and the distinctions matter: a per-minute rate limit is
 * worth waiting out, an exhausted daily quota is not, and a reply cut off at
 * its length limit is not an answer. Getting these wrong does not produce an
 * error — it produces a confident wrong answer, which is worse.
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
  model: 'openai/gpt-oss-120b',
  choices: [
    { message: { role: 'assistant', content: 'Two actions are overdue.' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 1_200, completion_tokens: 80, total_tokens: 1_280 },
};

function providerWith(fetchImpl: typeof fetch) {
  return createGroqProvider({
    apiKey: 'test-key-not-a-real-one',
    model: 'openai/gpt-oss-120b',
    tier: 'free',
    fetchImpl,
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v295 what the provider sends', () => {
  it('posts to Groq’s OpenAI-compatible endpoint with the key in the header only', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const provider = providerWith(async (url, init) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return okResponse(ANSWER);
    });

    await provider.send({
      system: 'You are TAMCO AI.',
      messages: [{ role: 'user', content: 'What is overdue?' }],
      tools: [TOOL],
      maxOutputTokens: 1_600,
      effort: 'high',
    });

    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-key-not-a-real-one');
    // The key travels in the header and nowhere else: never a query string,
    // which is where it would end up in somebody's access log.
    expect(calls[0]!.url).not.toContain('key');
  });

  it('sends the system prompt as a message and the tools as functions', async () => {
    let body: Record<string, unknown> = {};
    const provider = providerWith(async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return okResponse(ANSWER);
    });

    await provider.send({
      system: 'You are TAMCO AI.',
      messages: [{ role: 'user', content: 'What is overdue?' }],
      tools: [TOOL],
      maxOutputTokens: 1_600,
      effort: 'high',
    });

    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]).toEqual({ role: 'system', content: 'You are TAMCO AI.' });
    expect(messages[1]).toEqual({ role: 'user', content: 'What is overdue?' });

    const tools = body.tools as { type: string; function: Record<string, unknown> }[];
    expect(tools[0]!.type).toBe('function');
    expect(tools[0]!.function.name).toBe('list_my_tasks');
    /*
     * Deliberately not strict. Strict function calling requires every
     * property to be in `required`, and two tools take an optional argument
     * with a default; sending strict would 400 on those rather than catch
     * anything, and the Zod guard in each tool is what actually refuses a
     * malformed call.
     */
    expect(tools[0]!.function).not.toHaveProperty('strict');
    expect(body.tool_choice).toBe('auto');
    expect(body.max_completion_tokens).toBe(1_600);
  });

  it('sends reasoning_effort but never reasoning_format', async () => {
    /*
     * Groq documents `reasoning_format` as unsupported on the gpt-oss models,
     * and `raw` with tools enabled as a 400. Sending it would turn every
     * investigation into a failed request, which is the kind of mistake that
     * only shows up against the real API.
     */
    let body: Record<string, unknown> = {};
    const provider = providerWith(async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return okResponse(ANSWER);
    });

    await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [TOOL],
      maxOutputTokens: 1_000,
      effort: 'medium',
    });

    expect(body.reasoning_effort).toBe('medium');
    expect(body).not.toHaveProperty('reasoning_format');
    // The chain of thought is neither wanted nor stored.
    expect(body.include_reasoning).toBe(false);
  });

  it('carries tool calls and their results back in the shape Groq expects', async () => {
    let body: Record<string, unknown> = {};
    const provider = providerWith(async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return okResponse(ANSWER);
    });

    await provider.send({
      system: 'x',
      messages: [
        { role: 'user', content: 'What is overdue?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call_1', name: 'list_my_tasks', arguments: '{}' }],
        },
        { role: 'tool', toolCallId: 'call_1', name: 'list_my_tasks', content: '<record-set/>' },
      ],
      tools: [TOOL],
      maxOutputTokens: 1_000,
      effort: 'high',
    });

    const messages = body.messages as Record<string, unknown>[];
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'list_my_tasks' } }],
    });
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      name: 'list_my_tasks',
      content: '<record-set/>',
    });
  });

  it('retries once without the optional parameters if they are rejected', async () => {
    /*
     * Documentation and deployments drift. A feature that dies on an unknown
     * field is a feature that dies on a Tuesday, so an unrecognised-parameter
     * 400 costs one retry rather than the whole turn.
     */
    const bodies: Record<string, unknown>[] = [];
    const provider = providerWith(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      bodies.push(body);
      if (bodies.length === 1) {
        return errorResponse(400, {
          error: { message: 'Unrecognized request argument supplied: include_reasoning' },
        });
      }
      return okResponse(ANSWER);
    });

    const reply = await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [TOOL],
      maxOutputTokens: 1_000,
      effort: 'high',
    });

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty('include_reasoning');
    expect(bodies[1]).not.toHaveProperty('include_reasoning');
    expect(bodies[1]).not.toHaveProperty('reasoning_effort');
    expect(reply.text).toContain('Two actions are overdue.');
  });
});

describe('v295 what the provider reads back', () => {
  it('reports an answer with its token usage', async () => {
    const provider = providerWith(async () => okResponse(ANSWER));
    const reply = await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [],
      maxOutputTokens: 1_000,
      effort: 'high',
    });
    expect(reply.stop).toBe('answered');
    expect(reply.text).toBe('Two actions are overdue.');
    expect(reply.usage).toEqual({ inputTokens: 1_200, outputTokens: 80, cachedInputTokens: 0 });
  });

  it('separates cached input tokens out of the prompt count', async () => {
    /*
     * Groq reports prompt tokens inclusive of whatever was served from cache.
     * Counting the cached part at the full rate as well would overstate every
     * cost estimate the feature produces.
     */
    const provider = providerWith(async () =>
      okResponse({
        ...ANSWER,
        usage: {
          prompt_tokens: 1_000,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 400 },
        },
      }),
    );
    const reply = await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [],
      maxOutputTokens: 1_000,
      effort: 'high',
    });
    expect(reply.usage).toEqual({ inputTokens: 600, outputTokens: 50, cachedInputTokens: 400 });
  });

  it('reads a tool call, leaving its arguments as the model wrote them', async () => {
    const provider = providerWith(async () =>
      okResponse({
        model: 'openai/gpt-oss-120b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_abc123',
                  type: 'function',
                  function: { name: 'get_finding_detail', arguments: '{"finding_id":"f-1"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }),
    );
    const reply = await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [TOOL],
      maxOutputTokens: 1_000,
      effort: 'high',
    });
    expect(reply.stop).toBe('tool_calls');
    expect(reply.toolCalls).toEqual([
      { id: 'call_abc123', name: 'get_finding_detail', arguments: '{"finding_id":"f-1"}' },
    ]);
    expect(reply.text).toBe('');
  });

  it('calls a length-limited reply truncated, not answered', async () => {
    const provider = providerWith(async () =>
      okResponse({
        ...ANSWER,
        choices: [
          {
            message: { content: 'The overdue actions are ESH-0101, ESH-' },
            finish_reason: 'length',
          },
        ],
      }),
    );
    const reply = await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [],
      maxOutputTokens: 20,
      effort: 'high',
    });
    expect(reply.stop).toBe('truncated');
  });

  it('refuses a reply that is not JSON, or carries no choice at all', async () => {
    const notJson = providerWith(async () => new Response('<html>502</html>', { status: 200 }));
    await expect(
      notJson.send({ system: 'x', messages: [], tools: [], maxOutputTokens: 10, effort: 'high' }),
    ).rejects.toMatchObject({ kind: 'malformed' });

    const noChoice = providerWith(async () => okResponse({ choices: [] }));
    await expect(
      noChoice.send({ system: 'x', messages: [], tools: [], maxOutputTokens: 10, effort: 'high' }),
    ).rejects.toMatchObject({ kind: 'malformed' });
  });
});

describe('v295 how a failure is classified', () => {
  const headers = (values: Record<string, string>) => new Headers(values);

  it('separates a per-minute rate limit from an exhausted daily quota', async () => {
    /*
     * Both arrive as a 429. Waiting helps with the first and is pointless for
     * the second, and telling somebody "try again in a moment" when their
     * allowance is gone until tomorrow wastes their afternoon.
     */
    expect(
      classify(429, headers({ 'x-ratelimit-remaining-requests': '812', 'retry-after': '8' }), ''),
    ).toBe('rate_limited');
    expect(classify(429, headers({ 'x-ratelimit-remaining-requests': '0' }), '')).toBe(
      'quota_exhausted',
    );
    // A reset measured in hours is a day's allowance whatever the header says.
    expect(classify(429, headers({ 'x-ratelimit-reset-requests': '3h20m1.4s' }), '')).toBe(
      'quota_exhausted',
    );
  });

  /*
   * v296, and the single most consequential thing in this file.
   *
   * Groq's headers carry requests remaining for the DAY and tokens remaining
   * for the MINUTE. There is no header for tokens remaining for the day - and
   * tokens per day is the limit that actually binds a free account running an
   * agent loop. So a daily token refusal arrives as a 429 with hundreds of
   * requests to spare and a short request reset, and every signal the
   * classifier used said "busy minute".
   *
   * A usage export over one afternoon: 407 requests, 91 refused on tokens per
   * day, 1 on tokens per minute. All 92 were reported to the person as a
   * minute of rate limiting. The body is the only place the bucket is named,
   * so the body is read first.
   */
  it('reads the bucket out of the message, because no header carries it', () => {
    const tpd = JSON.stringify({
      error: {
        message:
          'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199418, Requested 1736. Please try again in 8m32.1s.',
        type: 'tokens',
        code: 'rate_limit_exceeded',
      },
    });
    /* Requests to spare and a short request reset: every old signal said minute. */
    expect(
      classify(
        429,
        headers({ 'x-ratelimit-remaining-requests': '593', 'x-ratelimit-reset-requests': '2.1s' }),
        tpd,
      ),
    ).toBe('quota_exhausted');

    const tpm = JSON.stringify({
      error: {
        message:
          'Rate limit reached for model `openai/gpt-oss-120b` in organization `org_x` on tokens per minute (TPM): Limit 8000, Used 7840, Requested 900. Please try again in 5.2s.',
        code: 'rate_limit_exceeded',
      },
    });
    expect(classify(429, headers({ 'x-ratelimit-remaining-requests': '593' }), tpm)).toBe(
      'rate_limited',
    );

    // Requests per day is a day's allowance too.
    expect(classify(429, headers({}), 'on requests per day (RPD): Limit 1000')).toBe(
      'quota_exhausted',
    );
  });

  it('treats a long retry-after as a day, when the message says nothing', () => {
    /*
     * The fallback for a message we cannot read. 507, 657 and 761 seconds
     * were the waits observed on those daily refusals, while the request
     * reset header stayed in single-digit seconds.
     */
    expect(classify(429, headers({ 'retry-after': '657' }), '')).toBe('quota_exhausted');
    expect(classify(429, headers({ 'retry-after': '12' }), '')).toBe('rate_limited');
  });

  it('knows a rejected tool call from an ordinary bad request', () => {
    /*
     * Observed against the real API: gpt-oss emitted a call to `commentary` -
     * part of the format it reasons in, not a tool anybody defined - and Groq
     * answered 400 `tool_use_failed`, ending an investigation that was going
     * well. The request was sound; the call it wrote was not.
     */
    const body = JSON.stringify({
      error: {
        message:
          "Tool call validation failed: attempted to call tool 'commentary' which was not in request.tools",
        type: 'invalid_request_error',
        code: 'tool_use_failed',
      },
    });
    expect(classify(400, headers({}), body)).toBe('malformed_generation');
    expect(new ProviderError('malformed_generation', 'x').retryable).toBe(true);
  });

  it('retries once when the model names a tool nobody offered', async () => {
    let attempts = 0;
    const provider = providerWith(async () => {
      attempts += 1;
      if (attempts === 1) {
        return errorResponse(400, {
          error: {
            message: "attempted to call tool 'commentary' which was not in request.tools",
            code: 'tool_use_failed',
          },
        });
      }
      return okResponse(ANSWER);
    });

    const reply = await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [TOOL],
      maxOutputTokens: 1_000,
      effort: 'medium',
    });
    expect(attempts).toBe(2);
    expect(reply.text).toContain('Two actions are overdue.');
    /*
     * v296. Both requests happened and both counted against the provider's
     * daily allowance, so the reply says two. The route used to record
     * `toolCalls.length + 1` - database reads, which never touch the network
     * - and a resampled generation was recorded as a single request.
     */
    expect(reply.requests).toBe(2);
  });

  /*
   * v296. A refused request spends the allowance exactly as a served one
   * does, and a resampled generation spends it three times. A usage report
   * that counts only the turns which produced an answer shows a fraction of
   * what the provider's own console shows.
   */
  it('counts every request it made, including the ones that failed', async () => {
    let attempts = 0;
    const alwaysMalformed = providerWith(async () => {
      attempts += 1;
      return errorResponse(400, {
        error: { message: 'output_parse_failed', code: 'output_parse_failed' },
      });
    });

    const failure = await alwaysMalformed
      .send({
        system: 'x',
        messages: [{ role: 'user', content: 'y' }],
        tools: [TOOL],
        maxOutputTokens: 1_000,
        effort: 'medium',
      })
      .catch((cause: unknown) => cause as ProviderError);

    expect(failure).toBeInstanceOf(ProviderError);
    expect((failure as ProviderError).kind).toBe('malformed_generation');
    // One try plus two resamples, all three against the day's allowance.
    expect(attempts).toBe(3);
    expect((failure as ProviderError).requests).toBe(3);
  });

  it('counts one request for an ordinary answer', async () => {
    const provider = providerWith(async () => okResponse(ANSWER));
    const reply = await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [TOOL],
      maxOutputTokens: 1_000,
      effort: 'medium',
    });
    expect(reply.requests).toBe(1);
  });

  it('counts the parameter fallback as the second request it is', async () => {
    let attempts = 0;
    const provider = providerWith(async () => {
      attempts += 1;
      if (attempts === 1) {
        return errorResponse(400, {
          error: { message: 'Unrecognized request argument supplied: reasoning_effort' },
        });
      }
      return okResponse(ANSWER);
    });
    const reply = await provider.send({
      system: 'x',
      messages: [{ role: 'user', content: 'y' }],
      tools: [TOOL],
      maxOutputTokens: 1_000,
      effort: 'medium',
    });
    expect(reply.requests).toBe(2);
  });

  it('knows an invalid key from a bad request from a server fault', () => {
    expect(classify(401, headers({}), '')).toBe('auth');
    expect(classify(403, headers({}), '')).toBe('auth');
    expect(classify(400, headers({}), 'tool_choice is invalid')).toBe('bad_request');
    expect(classify(500, headers({}), '')).toBe('server');
    expect(classify(503, headers({}), '')).toBe('server');
    expect(classify(504, headers({}), '')).toBe('timeout');
  });

  it('recognises a context that is too long, however it is reported', () => {
    expect(classify(413, headers({}), '')).toBe('context_too_long');
    expect(
      classify(
        400,
        headers({}),
        'Please reduce the length of the messages: context_length_exceeded',
      ),
    ).toBe('context_too_long');
  });

  it('turns a 429 into a retry-after the loop can act on', async () => {
    const provider = providerWith(async () =>
      errorResponse(
        429,
        { error: { message: 'Rate limit reached' } },
        {
          'retry-after': '11',
          'x-ratelimit-remaining-requests': '940',
        },
      ),
    );
    let failure: ProviderError | null = null;
    try {
      await provider.send({
        system: 'x',
        messages: [],
        tools: [],
        maxOutputTokens: 10,
        effort: 'high',
      });
    } catch (cause) {
      failure = cause as ProviderError;
    }
    expect(failure).toBeInstanceOf(ProviderError);
    if (!failure) throw new Error('the provider did not fail');
    expect(failure.kind).toBe('rate_limited');
    expect(failure.retryAfterMs).toBe(11_000);
    expect(failure.retryable).toBe(true);
    expect(failure.message).toContain('Rate limit reached');
  });

  it('does not call an exhausted quota retryable', () => {
    const quota = new ProviderError('quota_exhausted', 'daily limit', { retryAfterMs: 3_600_000 });
    expect(quota.retryable).toBe(false);
    /*
     * v296. This asserted `'rate_limited'`, which is how the one distinction
     * the classifier exists to draw got lost again on the way to the reader:
     * correctly identified as a quota, then described as a busy minute.
     */
    expect(stopReasonFor('quota_exhausted')).toBe('quota');
    expect(stopReasonFor('rate_limited')).toBe('rate_limited');
    expect(stopReasonFor('context_too_long')).toBe('budget');
    expect(stopReasonFor('timeout')).toBe('clock');
    expect(stopReasonFor('auth')).toBe('failed');
  });
});

describe('v295 Groq’s reset durations', () => {
  it('reads the formats Groq actually sends', () => {
    expect(parseResetDuration('7.66s')).toBe(7_660);
    expect(parseResetDuration('2m59.56s')).toBe(179_560);
    expect(parseResetDuration('1h30m')).toBe(5_400_000);
    expect(parseResetDuration('250ms')).toBe(250);
    // A bare number is seconds, as `retry-after` sends it.
    expect(parseResetDuration('11')).toBe(11_000);
  });

  it('returns nothing rather than zero for what it cannot read', () => {
    /*
     * Zero would read as "retry immediately", which against a rate limit is
     * how one 429 becomes a dozen.
     */
    expect(parseResetDuration(null)).toBeNull();
    expect(parseResetDuration('')).toBeNull();
    expect(parseResetDuration('soon')).toBeNull();
  });
});
