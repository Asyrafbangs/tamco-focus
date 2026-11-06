import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v295 — the loop, driven without a network.
 *
 * A stubbed `messages.create` lets every branch be forced: a model that keeps
 * asking for tools forever, a tool that throws, a tool that does not exist, a
 * turn that runs out of clock. These are the paths that decide whether an
 * investigation ends with an answer, an honest limit, or a hung request.
 */

const state = vi.hoisted(() => ({
  replies: [] as unknown[],
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
      if (state.toolBehaviour === 'bad-input') throw new ToolInputError('task_id required');
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

import { runInvestigation, type AgentEvent, type AgentResult } from '@/server/ai/agent';
import { AGENT_LIMITS, ToolInputError } from '@/domain/ai';

const USAGE = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0 };

function says(text: string) {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: USAGE,
  };
}

function callsTool(name = 'list_my_tasks', input: unknown = {}) {
  return {
    content: [{ type: 'tool_use', id: `c${Math.random()}`, name, input }],
    stop_reason: 'tool_use',
    usage: USAGE,
  };
}

/** A client that answers from a script, then repeats its last reply. */
function scripted(replies: unknown[]) {
  let at = 0;
  return {
    create: async () => {
      const reply = replies[Math.min(at, replies.length - 1)];
      at += 1;
      return reply as never;
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

beforeEach(() => {
  state.toolRuns = [];
  state.toolBehaviour = 'ok';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v295 an investigation that answers', () => {
  it('reads a tool, then answers, and cites what it read', async () => {
    const { events, result } = await collect(
      runInvestigation({
        history: [],
        question: 'What should I do today?',
        caller,
        eshAccess: 'none',
        client: scripted([callsTool(), says('Start with the guard.')]),
      }),
    );

    expect(state.toolRuns).toHaveLength(1);
    expect(result.text).toContain('Start with the guard.');
    expect(result.stopped).toBe('answered');
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

  it('counts every step of the turn, not just the last', async () => {
    const { result } = await collect(
      runInvestigation({
        history: [],
        question: 'Why is this late?',
        caller,
        eshAccess: 'none',
        client: scripted([callsTool(), callsTool(), says('Because of the queue.')]),
      }),
    );
    // Three requests at 100 in / 10 out each.
    expect(result.usage.inputTokens).toBe(300);
    expect(result.usage.outputTokens).toBe(30);
    expect(result.costUsd).toBeGreaterThan(0);
  });
});

describe('v295 an investigation that cannot finish', () => {
  it('stops at the step limit and says so rather than looping', async () => {
    const { result } = await collect(
      runInvestigation({
        history: [],
        question: 'Investigate everything.',
        caller,
        eshAccess: 'none',
        // A model that never stops asking for tools.
        client: scripted([callsTool()]),
      }),
    );
    expect(result.stopped).toBe('steps');
    expect(state.toolRuns.length).toBeLessThanOrEqual(AGENT_LIMITS.maxSteps);
    expect(result.text).toMatch(/limit on how many records/);
  });

  it('stops on the clock, with something to show', async () => {
    let clock = 0;
    const { result } = await collect(
      runInvestigation({
        history: [],
        question: 'Investigate everything.',
        caller,
        eshAccess: 'none',
        client: scripted([callsTool()]),
        // Each step takes twenty seconds; the soft deadline arrives first.
        now: () => {
          clock += 20_000;
          return clock;
        },
      }),
    );
    expect(result.stopped).toBe('clock');
    expect(result.text).toMatch(/ran out of time/);
  });
});

describe('v295 a tool that fails is answered, not thrown', () => {
  it('hands the model an error result and keeps the turn alive', async () => {
    state.toolBehaviour = 'throws';
    const { events, result } = await collect(
      runInvestigation({
        history: [],
        question: 'What should I do today?',
        caller,
        eshAccess: 'none',
        client: scripted([callsTool(), says('I could not read your tasks.')]),
      }),
    );
    expect(result.text).toContain('could not read');
    expect(result.toolCalls[0]).toMatchObject({ ok: false });
    expect(events.some((one) => one.type === 'tool' && one.ok === false)).toBe(true);
  });

  it('tells the model exactly what was wrong with its arguments', async () => {
    state.toolBehaviour = 'bad-input';
    const { result } = await collect(
      runInvestigation({
        history: [],
        question: 'Open that task.',
        caller,
        eshAccess: 'none',
        client: scripted([callsTool(), says('I need the task id.')]),
      }),
    );
    expect(result.toolCalls[0]?.error).toContain('task_id required');
  });

  it('refuses a tool that does not exist', async () => {
    const { result } = await collect(
      runInvestigation({
        history: [],
        question: 'Delete the finding.',
        caller,
        eshAccess: 'none',
        client: scripted([callsTool('delete_finding'), says('I cannot do that.')]),
      }),
    );
    expect(state.toolRuns).toHaveLength(0);
    expect(result.toolCalls[0]).toMatchObject({ name: 'delete_finding', ok: false });
  });
});
