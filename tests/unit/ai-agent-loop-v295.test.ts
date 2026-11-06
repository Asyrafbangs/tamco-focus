import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_LIMITS,
  GROQ_FREE_LIMITS,
  NO_USAGE,
  ToolInputError,
  type AiToolCall,
} from '@/domain/ai';
import { ProviderError } from '@/server/ai/providers/types';

/**
 * v295 — the loop, driven without a network.
 *
 * A stub provider lets every branch be forced: a model that keeps asking for
 * tools forever, a tool that throws, a tool that does not exist, arguments
 * that are not JSON, a reply cut off at its length limit, a per-minute rate
 * limit, an exhausted daily quota, and a minute whose token allowance is
 * already gone. On a free tier those are not edge cases — they are Tuesday.
 *
 * The invariant every one of them shares: the turn never invents an answer,
 * and never reports a failure as an absence.
 */

const state = vi.hoisted(() => ({
  toolRuns: [] as { name: string; input: unknown }[],
  toolBehaviour: 'ok' as 'ok' | 'throws' | 'bad-input',
}));

/*
 * The real tool module reaches the database layer, which needs a configured
 * environment this test has no business requiring. What is under test is the
 * loop around the tools, so the tools themselves are a stub.
 */
vi.mock('@/server/ai/tools', () => {
  const fake = {
    name: 'list_my_tasks',
    description: 'stub',
    schema: { safeParse: () => ({ success: true, data: {} }) },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(input: unknown) {
      state.toolRuns.push({ name: 'list_my_tasks', input });
      if (state.toolBehaviour === 'throws') throw new Error('upstream 502');
      if (state.toolBehaviour === 'bad-input') throw new ToolInputError('task_id is required');
      return {
        evidence: '<record-set source="list_my_tasks">[]</record-set>',
        sources: [
          { kind: 'task' as const, id: 't1', label: 'Fix the guard', href: '/work?task=t1' },
        ],
        rows: 1,
      };
    },
  };
  return {
    AGENT_TOOLS: [fake],
    toolByName: (name: string) => (name === 'list_my_tasks' ? fake : undefined),
  };
});

import {
  fixedPromptCost,
  runInvestigation,
  type AgentEvent,
  type AgentResult,
} from '@/server/ai/agent';
import type { AiProvider, ProviderReply } from '@/server/ai/providers/types';

const USAGE = { ...NO_USAGE, inputTokens: 300, outputTokens: 40 };

function answers(text: string): ProviderReply {
  return { text, toolCalls: [], usage: USAGE, stop: 'answered', model: 'openai/gpt-oss-120b' };
}

function callsTool(name = 'list_my_tasks', args = '{}'): ProviderReply {
  const call: AiToolCall = {
    id: `call_${Math.random().toString(36).slice(2)}`,
    name,
    arguments: args,
  };
  return {
    text: '',
    toolCalls: [call],
    usage: USAGE,
    stop: 'tool_calls',
    model: 'openai/gpt-oss-120b',
  };
}

/** A provider that answers from a script, then repeats its last reply. */
function scripted(
  replies: (ProviderReply | ProviderError)[],
  options: { onSend?: () => void } = {},
): AiProvider {
  let at = 0;
  return {
    id: 'groq',
    model: 'openai/gpt-oss-120b',
    tier: 'free',
    async send() {
      const next = replies[Math.min(at, replies.length - 1)]!;
      at += 1;
      options.onSend?.();
      if (next instanceof ProviderError) throw next;
      return next;
    },
  };
}

async function collect(run: AsyncGenerator<AgentEvent, AgentResult>) {
  const events: AgentEvent[] = [];
  let next = await run.next();
  while (!next.done) {
    events.push(next.value);
    next = await run.next();
  }
  return { events, result: next.value };
}

const caller = { userId: 'u1', fullName: 'Izzul', timezone: 'Asia/Kuala_Lumpur' };
const roomy = { ...GROQ_FREE_LIMITS, tokensPerMinute: 1_000_000 };

function run(overrides: Partial<Parameters<typeof runInvestigation>[0]>) {
  return runInvestigation({
    provider: scripted([answers('ok')]),
    history: [],
    question: 'What should I do today?',
    caller,
    eshAccess: 'none',
    limits: roomy,
    tokensUsedThisMinute: 0,
    wait: async () => {},
    ...overrides,
  });
}

beforeEach(() => {
  state.toolRuns = [];
  state.toolBehaviour = 'ok';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v295 what every request carries before a word of conversation', () => {
  it('is counted, not guessed, and leaves room for two steps a minute', () => {
    /*
     * The system prompt and the tool list are resent on every step, so this
     * number decides how many records one investigation can afford. The route
     * guessed it at 2,600 against a real 1,251 and refused questions the free
     * tier could have answered; it is now computed from the live prompt and
     * the live tools, and this is the test that notices when either grows.
     */
    const fixed = fixedPromptCost();
    expect(fixed).toBeGreaterThan(200);
    const perStep = fixed + 300 + AGENT_LIMITS.budgetedOutputTokens;
    expect(perStep * 2).toBeLessThanOrEqual(GROQ_FREE_LIMITS.tokensPerMinute * 0.9);
  });
});

describe('v295 an investigation that answers', () => {
  it('reads a tool, then answers, and cites what it read', async () => {
    const { events, result } = await collect(
      run({ provider: scripted([callsTool(), answers('Start with the guard.')]) }),
    );

    expect(state.toolRuns).toHaveLength(1);
    expect(result.text).toContain('Start with the guard.');
    expect(result.stop).toBe('answered');
    /*
     * The citation comes from the row the tool returned, not from anything
     * the model wrote. That is the whole guarantee: a link under an answer
     * points at a record that was actually read.
     */
    expect(result.sources).toEqual([
      { kind: 'task', id: 't1', label: 'Fix the guard', href: '/work?task=t1' },
    ]);
    expect(events.some((one) => one.type === 'sources')).toBe(true);
  });

  it('stores the exchange in a replayable shape, tool results included', async () => {
    const { result } = await collect(
      run({ provider: scripted([callsTool(), answers('Start with the guard.')]) }),
    );
    expect(result.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    // The assistant turn that asked for tools carries the calls, or the tool
    // results that follow it answer nothing.
    expect(result.messages[1]!.toolCalls?.[0]?.name).toBe('list_my_tasks');
    expect(result.messages[2]!.toolCallId).toBe(result.messages[1]!.toolCalls![0]!.id);
  });

  it('counts every step of the turn, and charges nothing on a free tier', async () => {
    const { result } = await collect(
      run({ provider: scripted([callsTool(), callsTool(), answers('Because of the queue.')]) }),
    );
    expect(result.usage.inputTokens).toBe(900);
    expect(result.usage.outputTokens).toBe(120);
    // Free tier: tokens recorded, nothing charged, list price still known.
    expect(result.chargedUsd).toBe(0);
    expect(result.listPriceUsd).toBeGreaterThan(0);
  });
});

describe('v295 an investigation that cannot finish says so', () => {
  it('stops at the step limit rather than looping', async () => {
    const { result } = await collect(run({ provider: scripted([callsTool()]) }));
    expect(result.stop).toBe('steps');
    expect(state.toolRuns.length).toBeLessThanOrEqual(AGENT_LIMITS.maxSteps);
    expect(result.text).toMatch(/limit on how many records/);
  });

  it('stops on the clock, with what it read', async () => {
    let clock = 0;
    const { result } = await collect(
      run({
        // Twenty seconds a step: the soft deadline arrives before the step
        // limit does.
        provider: scripted([callsTool()], { onSend: () => (clock += 20_000) }),
        now: () => clock,
      }),
    );
    expect(result.stop).toBe('clock');
    expect(result.text).toMatch(/ran out of time/);
  });

  it('stops before spending anything when the minute has no allowance left', async () => {
    /*
     * The free tier's real constraint. Nothing is sent: a 429 halfway through
     * a loop costs the tokens already spent and returns nothing, so the guard
     * is in front of the request rather than behind it.
     */
    let sent = 0;
    const { result } = await collect(
      run({
        provider: scripted([answers('never reached')], { onSend: () => (sent += 1) }),
        limits: GROQ_FREE_LIMITS,
        tokensUsedThisMinute: 7_900,
      }),
    );
    expect(sent).toBe(0);
    expect(result.stop).toBe('budget');
    expect(result.text).toMatch(/token allowance for this minute/);
    expect(result.usage.inputTokens).toBe(0);
  });

  it('never presents a truncated reply as a finished one', async () => {
    const cut: ProviderReply = {
      text: 'The three overdue actions are ESH-0101, ESH-0102 and',
      toolCalls: [],
      usage: USAGE,
      stop: 'truncated',
      model: 'openai/gpt-oss-120b',
    };
    const { result } = await collect(run({ provider: scripted([cut]) }));
    expect(result.stop).toBe('truncated');
    expect(result.text).toMatch(/cut off/);
  });
});

describe('v295 a rate-limited provider', () => {
  it('waits once when the wait fits, then carries on', async () => {
    const waited: number[] = [];
    const { events, result } = await collect(
      run({
        provider: scripted([
          new ProviderError('rate_limited', 'slow down', { retryAfterMs: 1_200, status: 429 }),
          answers('Here is what I found.'),
        ]),
        wait: async (ms) => {
          waited.push(ms);
        },
      }),
    );
    expect(waited).toEqual([1_200]);
    expect(result.stop).toBe('answered');
    expect(result.text).toContain('Here is what I found.');
    // And the wait is said out loud rather than looking like a hang.
    expect(events.some((one) => one.type === 'notice' && /waiting 2s/.test(one.message))).toBe(
      true,
    );
  });

  it('does not wait out a daily quota, because waiting would not help', async () => {
    const waited: number[] = [];
    const { result } = await collect(
      run({
        provider: scripted([
          new ProviderError('quota_exhausted', 'daily limit reached', {
            retryAfterMs: 3_600_000,
            status: 429,
          }),
        ]),
        wait: async (ms) => {
          waited.push(ms);
        },
      }),
    );
    expect(waited).toEqual([]);
    expect(result.stop).toBe('rate_limited');
    expect(result.failure?.kind).toBe('quota_exhausted');
    expect(result.text).toMatch(/rate limited/i);
  });

  it('does not wait longer than the turn has left', async () => {
    const waited: number[] = [];
    const { result } = await collect(
      run({
        provider: scripted([
          new ProviderError('rate_limited', 'slow down', { retryAfterMs: 90_000, status: 429 }),
        ]),
        wait: async (ms) => {
          waited.push(ms);
        },
      }),
    );
    expect(waited).toEqual([]);
    expect(result.stop).toBe('rate_limited');
  });

  it('reports an unreachable provider as a failure, not as an empty answer', async () => {
    const { result } = await collect(
      run({ provider: scripted([new ProviderError('network', 'connect ECONNREFUSED')]) }),
    );
    expect(result.stop).toBe('failed');
    expect(result.text).toMatch(/could not complete this investigation/i);
    // Nothing fabricated, and nothing implied about what the records contain.
    expect(result.sources).toEqual([]);
  });
});

describe('v295 an answer with nothing read behind it', () => {
  it('is discarded, and the model is asked to read first', async () => {
    /*
     * Measured across two full eval runs against the real model: on a
     * question it could not settle, gpt-oss-120b sometimes answers from the
     * question alone. The words were careful and the substance was
     * ungrounded, which is the one thing this feature cannot ship with - so
     * the loop enforces what the prompt asks rather than hoping.
     */
    const { events, result } = await collect(
      run({
        question: 'Prove that this hazard keeps recurring in the warehouse.',
        provider: scripted([
          answers('Hazards of this kind commonly recur in warehouses.'),
          callsTool(),
          answers('Two of the three share a housekeeping category.'),
        ]),
      }),
    );
    // The ungrounded draft never reaches the person.
    expect(result.text).not.toContain('commonly recur');
    expect(result.text).toContain('housekeeping category');
    expect(state.toolRuns).toHaveLength(1);
    expect(
      events.some((one) => one.type === 'notice' && /against your records/.test(one.message)),
    ).toBe(true);
  });

  it('nudges only once, so a question that needs no records still gets answered', async () => {
    const { result } = await collect(
      run({
        question: 'What can you actually do for me in this workspace?',
        provider: scripted([
          answers('I can read your tasks and findings.'),
          answers('I can read your tasks and findings.'),
        ]),
      }),
    );
    expect(result.text).toContain('I can read your tasks and findings.');
    expect(result.stop).toBe('answered');
  });

  it('does not spend two requests on a pleasantry', async () => {
    let sent = 0;
    const { result } = await collect(
      run({
        question: 'thanks',
        provider: scripted([answers('Any time.')], { onSend: () => (sent += 1) }),
      }),
    );
    expect(sent).toBe(1);
    expect(result.text).toBe('Any time.');
  });

  it('does not nudge an answer that followed a tool call', async () => {
    const { events } = await collect(
      run({
        question: 'Why are my corrective actions delayed this month?',
        provider: scripted([callsTool(), answers('Because of the verification queue.')]),
      }),
    );
    expect(events.some((one) => one.type === 'notice')).toBe(false);
  });
});

describe('v295 the same question is not asked twice', () => {
  it('tells the model it already has a result rather than fetching it again', async () => {
    /*
     * Measured against the real model: asked something the records could not
     * answer, gpt-oss-120b called the same tool with the same arguments four
     * times and never wrote a word. The step limit stopped it, which was
     * honest and useless - the whole minute's token allowance spent on one
     * repeated read. Breaking the cycle at the second call is what turns that
     * into an answer.
     */
    const { result } = await collect(
      run({
        provider: scripted([
          callsTool('list_my_tasks', '{}'),
          callsTool('list_my_tasks', '{}'),
          answers('Nothing in your tasks explains it.'),
        ]),
      }),
    );
    expect(state.toolRuns).toHaveLength(1);
    expect(result.toolCalls[1]).toMatchObject({ name: 'list_my_tasks', ok: false });
    expect(result.toolCalls[1]?.error).toMatch(/already called/);
    expect(result.text).toContain('Nothing in your tasks explains it.');
  });

  it('treats differently-ordered arguments as the same call', async () => {
    const { result } = await collect(
      run({
        provider: scripted([
          callsTool('list_my_tasks', '{"a":1,"b":2}'),
          callsTool('list_my_tasks', '{"b":2,"a":1}'),
          answers('Done.'),
        ]),
      }),
    );
    // Argument order is not a decision the model is making.
    expect(state.toolRuns).toHaveLength(1);
    expect(result.toolCalls[1]?.error).toMatch(/already called/);
  });

  it('still allows the same tool with different arguments', async () => {
    const { result } = await collect(
      run({
        provider: scripted([
          callsTool('list_my_tasks', '{"horizon_days":7}'),
          callsTool('list_my_tasks', '{"horizon_days":30}'),
          answers('Both horizons checked.'),
        ]),
      }),
    );
    expect(state.toolRuns).toHaveLength(2);
    expect(result.toolCalls.every((call) => call.ok)).toBe(true);
  });
});

describe('v295 a tool that fails is answered, not thrown', () => {
  it('hands the model an error result and keeps the turn alive', async () => {
    state.toolBehaviour = 'throws';
    const { events, result } = await collect(
      run({ provider: scripted([callsTool(), answers('I could not read your tasks.')]) }),
    );
    expect(result.text).toContain('could not read');
    expect(result.toolCalls[0]).toMatchObject({ ok: false });
    expect(events.some((one) => one.type === 'tool' && one.ok === false)).toBe(true);
    /*
     * And the model is told to treat it as unknown rather than absent. "No
     * rows" and "could not read" are different facts, and this is the point
     * where they get confused if nobody insists.
     */
    const toolMessage = result.messages.find((message) => message.role === 'tool');
    expect(toolMessage?.content).toMatch(/unknown rather than absent/);
  });

  it('tells the model exactly what was wrong with its arguments', async () => {
    state.toolBehaviour = 'bad-input';
    const { result } = await collect(
      run({ provider: scripted([callsTool(), answers('I need the task id.')]) }),
    );
    expect(result.toolCalls[0]?.error).toContain('task_id is required');
  });

  it('refuses arguments that are not JSON instead of guessing', async () => {
    const { result } = await collect(
      run({
        provider: scripted([
          callsTool('list_my_tasks', '{"task_id": '),
          answers('I need that again.'),
        ]),
      }),
    );
    expect(state.toolRuns).toHaveLength(0);
    expect(result.toolCalls[0]?.error).toMatch(/not valid JSON/);
  });

  it('refuses a tool that does not exist', async () => {
    const { result } = await collect(
      run({ provider: scripted([callsTool('delete_finding'), answers('I cannot do that.')]) }),
    );
    expect(state.toolRuns).toHaveLength(0);
    expect(result.toolCalls[0]).toMatchObject({ name: 'delete_finding', ok: false });
  });
});
