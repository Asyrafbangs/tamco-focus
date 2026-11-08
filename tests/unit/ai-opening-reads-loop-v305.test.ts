import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GROQ_FREE_LIMITS } from '@/domain/ai';

/**
 * v305 — the loop performs the mandatory reads itself.
 *
 * The decision of WHICH records a question needs is tested in
 * `ai-opening-reads-v305`. This is the other half: that the orchestration
 * actually fetches them before the model is asked anything, through the same
 * tools and the same authorization as a read the model requests, and that a
 * mandatory read which fails is put to the model as a failure rather than as
 * an absence.
 *
 * That last one is the point of the whole change. A seeded read that failed
 * silently would be worse than no seeding at all: the model would answer a
 * question believing it had been given the evidence.
 */

const state = vi.hoisted(() => ({
  runs: [] as { name: string; input: unknown }[],
  registerBehaviour: 'ok' as 'ok' | 'throws',
}));

vi.mock('@/server/ai/tools', () => {
  const register = {
    name: 'search_findings',
    description: 'stub',
    schema: { safeParse: () => ({ success: true, data: {} }) },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(input: unknown) {
      state.runs.push({ name: 'search_findings', input });
      if (state.registerBehaviour === 'throws') throw new Error('upstream 502');
      return {
        evidence: '<record-set source="search_findings">{"total":1}</record-set>',
        sources: [
          {
            kind: 'finding' as const,
            id: 'f-500',
            label: 'ESH-0500 — Walkway blocked',
            href: '/findings/f-500',
          },
        ],
        rows: 1,
      };
    },
  };
  const tasks = {
    ...register,
    name: 'list_my_tasks',
    async run(input: unknown) {
      state.runs.push({ name: 'list_my_tasks', input });
      return {
        evidence: '<record-set source="list_my_tasks">{"total":2}</record-set>',
        sources: [],
        rows: 2,
      };
    },
  };
  const detail = {
    ...register,
    name: 'get_finding_detail',
    async run(input: unknown) {
      state.runs.push({ name: 'get_finding_detail', input });
      return {
        evidence: '<record-set source="get_finding_detail">{"status":"open"}</record-set>',
        sources: [],
        rows: 1,
      };
    },
  };
  const all = [register, tasks, detail];
  return {
    AGENT_TOOLS: all,
    toolByName: (name: string) => all.find((one) => one.name === name),
  };
});

import { runInvestigation, type AgentEvent, type AgentResult } from '@/server/ai/agent';
import type { AiProvider, ProviderRequest } from '@/server/ai/providers/types';

const caller = { userId: 'u1', fullName: 'Izzul', timezone: 'Asia/Kuala_Lumpur' };
const roomy = { ...GROQ_FREE_LIMITS, tokensPerMinute: 1_000_000 };

/** Answers immediately, and keeps what it was sent. */
function recording(seen: ProviderRequest[]): AiProvider {
  return {
    id: 'groq',
    model: 'openai/gpt-oss-120b',
    tier: 'free',
    async send(request) {
      seen.push(request);
      return {
        text: 'Start with ESH-0500.',
        toolCalls: [],
        usage: { inputTokens: 300, outputTokens: 40, reasoningTokens: 0, cachedInputTokens: 0 },
        stop: 'answered' as const,
        requests: 1,
        model: 'openai/gpt-oss-120b',
      };
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

function ask(question: string, seen: ProviderRequest[]) {
  return collect(
    runInvestigation({
      provider: recording(seen),
      history: [],
      question,
      caller,
      eshAccess: 'coordinator, all departments',
      limits: roomy,
      tokensUsedThisMinute: 0,
      tokensUsedToday: 0,
      effort: 'medium',
      wait: async () => {},
    }),
  );
}

beforeEach(() => {
  state.runs = [];
  state.registerBehaviour = 'ok';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v305 the loop fetches what the question needs', () => {
  it('reads the register and the tasks before the model is asked anything', async () => {
    const seen: ProviderRequest[] = [];
    const { result } = await ask('What should I prioritise today?', seen);

    expect(state.runs.map((one) => one.name)).toEqual(['search_findings', 'list_my_tasks']);
    /* Before, not after: the first thing the provider sees already has them. */
    const first = seen[0]!.messages.map((one) => one.content).join('\n');
    expect(first).toContain('<record-set source="search_findings">');
    expect(first).toContain('<record-set source="list_my_tasks">');
    expect(first).toContain('read for you before this question');
    expect(result.stop).toBe('answered');
  });

  it('keeps them in the audit trail, with their rows', async () => {
    /*
     * A read performed on somebody's behalf is still a read of their
     * records. It belongs in the tool-call record for the same reason every
     * other one does: so what the answer rests on can be checked afterwards.
     */
    const { result, events } = await ask('What should I prioritise today?', []);
    expect(result.toolCalls.map((one) => ({ name: one.name, ok: one.ok, rows: one.rows }))).toEqual(
      [
        { name: 'search_findings', ok: true, rows: 1 },
        { name: 'list_my_tasks', ok: true, rows: 2 },
      ],
    );
    expect(events.filter((one) => one.type === 'tool')).toHaveLength(2);
    /* And the citation comes from the seeded read, as it would from any. */
    expect(result.sources).toEqual([
      {
        kind: 'finding',
        id: 'f-500',
        label: 'ESH-0500 — Walkway blocked',
        href: '/findings/f-500',
      },
    ]);
  });

  it('opens the one record a yes-or-no question is about', async () => {
    const seen: ProviderRequest[] = [];
    await ask('Has the walkway finding been fixed?', seen);

    expect(state.runs.map((one) => one.name)).toEqual(['search_findings', 'get_finding_detail']);
    expect(state.runs[1]!.input).toEqual({ finding_id: 'f-500' });
  });

  it('tells the model a mandatory read FAILED rather than letting it read as empty', async () => {
    /*
     * The one that makes seeding safe. Without this the model answers "how
     * many findings are overdue" from a register it believes it was given,
     * and an outage becomes "you have none" - the exact sentence this whole
     * assistant exists not to produce.
     */
    state.registerBehaviour = 'throws';
    const seen: ProviderRequest[] = [];
    const { result } = await ask('How many findings are overdue?', seen);

    const first = seen[0]!.messages.map((one) => one.content).join('\n');
    expect(first).toContain('THIS READ FAILED');
    expect(first).toContain('never report it as "there are none"');
    expect(first).toContain('search_findings');
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'search_findings', ok: false, error: 'read failed' }),
    ]);
  });

  it('fetches nothing for a question that does not need it', async () => {
    const seen: ProviderRequest[] = [];
    await ask('What did my team achieve last week?', seen);

    expect(state.runs).toEqual([]);
    expect(seen[0]!.messages.map((one) => one.content).join('\n')).not.toContain(
      'read for you before this question',
    );
  });

  it('does not put the seeded evidence into the stored thread', async () => {
    /*
     * The stored turn is what the screen replays. v303 shipped a defect of
     * exactly this shape - the caller context was stored inside the person's
     * own question and came back as words they had never written - so the
     * evidence goes to the provider and stays out of the record.
     */
    const { result } = await ask('What should I prioritise today?', []);
    const stored = result.messages.map((one) => one.content).join('\n');
    expect(stored).not.toContain('read for you before this question');
    expect(stored).not.toContain('<record-set source="search_findings">');
  });
});
