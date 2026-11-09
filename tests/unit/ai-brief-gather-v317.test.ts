import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v317 — the brief's *gathering*, which had no test at all.
 *
 * The thirty-three tests beside this one exercise `buildAiBrief`, a pure
 * function over a snapshot. That is the easy half. Everything an independent
 * review found wrong was in the half that assembles the snapshot:
 *
 *   * the register was read one page deep, so a team with sixty open findings
 *     exported fifty of them - and a high-risk finding on page two was absent
 *     from the unprotected set, which the brief renders as *protected*. The
 *     dangerous direction;
 *   * `available` was filled in with the number of rows that came back, which
 *     makes a truncated read indistinguishable from a complete one;
 *   * restricted findings were dropped from the body but left in the
 *     interim-protection count, so the brief counted a finding it did not
 *     contain. Both a disclosure and an arithmetic that does not add up.
 *
 * These are all defects of assembly, invisible to a snapshot test, which is
 * why this file exists. The mocks stand in for the database only; the
 * pagination, the filtering and the counting under test are the real ones.
 */

type Answer = {
  data: unknown;
  count?: number | null;
  error: { code?: string; message: string } | null;
};

const state = vi.hoisted(() => ({
  checklistPages: [] as Answer[],
  ranges: [] as Array<[number, number]>,
}));

vi.mock('@/lib/supabase/server', () => {
  const builder = () => {
    const chain: Record<string, unknown> = {};
    for (const step of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit']) {
      chain[step] = () => chain;
    }
    chain.range = (from: number, to: number) => {
      state.ranges.push([from, to]);
      return Promise.resolve(state.checklistPages.shift() ?? { data: [], count: 0, error: null });
    };
    return chain;
  };

  return {
    createSupabaseServerClient: async () => ({ from: () => builder() }),
    requireProfile: async () => ({
      id: 'u-1',
      full_name: 'Izzul Asyraf',
      role: 'manager',
      email: 'izzul@tamco.local',
      timezone: 'Asia/Kuala_Lumpur',
    }),
  };
});

const listOpenTasksComplete = vi.fn();
const getLatestTaskUpdatesComplete = vi.fn();
vi.mock('@/server/queries', () => ({
  listOpenTasksComplete: (...args: unknown[]) => listOpenTasksComplete(...args),
  getLatestTaskUpdatesComplete: (...args: unknown[]) => getLatestTaskUpdatesComplete(...args),
}));

const getEshAccess = vi.fn();
vi.mock('@/server/esh/access', () => ({
  getEshAccess: () => getEshAccess(),
}));

const listRegister = vi.fn();
vi.mock('@/server/esh/queries', () => ({
  REGISTER_PAGE_SIZE: 50,
  listRegister: (options: unknown) => listRegister(options),
}));

const { gatherAiBrief } = await import('@/server/ai-brief');

function finding(over: Partial<Record<string, unknown>> = {}) {
  return {
    findingId: 'f-1',
    reference: 'ESH-9001',
    title: 'Interlock defeated on press 2',
    riskLevel: 'critical',
    status: 'open',
    actionState: 'in_progress',
    actionTitle: 'Replace the interlock switch',
    ownerEmail: 'fadli@tamco.local',
    dueAt: '2026-11-13',
    isOverdue: false,
    departmentName: 'Maintenance',
    hazardLabel: 'Machinery',
    isRestricted: false,
    ...over,
  };
}

/** A register answer for one filter, keyed by the page the caller asks for. */
function register(pages: Record<string, Array<Array<Record<string, unknown>>>>) {
  const totals: Record<string, number> = {};
  for (const [filter, list] of Object.entries(pages)) {
    totals[filter] = list.reduce((sum, page) => sum + page.length, 0);
  }
  return (options: { filter: string; page: number }, overrideTotal?: Record<string, number>) => ({
    rows: pages[options.filter]?.[options.page] ?? [],
    total: overrideTotal?.[options.filter] ?? totals[options.filter] ?? 0,
    failed: false,
  });
}

beforeEach(() => {
  state.checklistPages = [];
  state.ranges = [];
  listOpenTasksComplete.mockReset();
  getLatestTaskUpdatesComplete.mockReset();
  getEshAccess.mockReset();
  listRegister.mockReset();

  listOpenTasksComplete.mockResolvedValue({ tasks: [], total: 0, complete: true });
  getLatestTaskUpdatesComplete.mockResolvedValue({
    updates: new Map(),
    unverified: 0,
    failed: false,
  });
  getEshAccess.mockResolvedValue({ enabled: true });
  listRegister.mockResolvedValue({ rows: [], total: 0, failed: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v317 the register is read to the end, not one page deep', () => {
  it('walks every page and reports the counted total', async () => {
    const open = Array.from({ length: 50 }, (_, index) =>
      finding({ findingId: `f-${index}`, reference: `ESH-${9000 + index}` }),
    );
    const rest = Array.from({ length: 10 }, (_, index) =>
      finding({ findingId: `f-5${index}`, reference: `ESH-${9100 + index}` }),
    );
    const answer = register({ open: [open, rest], unprotected: [[]] });
    listRegister.mockImplementation(async (options: { filter: string; page: number }) =>
      answer(options),
    );

    const { markdown, snapshot } = await gatherAiBrief();

    expect(snapshot.findings).toHaveLength(60);
    expect(markdown).toContain('| ESH-9109 |');
    expect(markdown).toContain('| ESH findings (open) | 60 | 60 | complete');

    const pagesAsked = listRegister.mock.calls
      .map(([options]) => options as { filter: string; page: number })
      .filter((options) => options.filter === 'open')
      .map((options) => options.page);
    expect(pagesAsked).toEqual([0, 1]);
  });

  it('does not describe a finding as protected merely because page one ended', async () => {
    /*
     * The failure mode worth a test of its own. The unprotected set used to be
     * page one only, so a high-risk finding listed on page two came back as
     * "not in the unprotected set" - which the brief renders as an interim
     * control being in place. A reader would have planned the paperwork for a
     * hazard nobody had put a barrier in front of.
     */
    const page = Array.from({ length: 50 }, (_, index) =>
      finding({ findingId: `u-${index}`, reference: `ESH-${8000 + index}` }),
    );
    const second = [finding({ findingId: 'u-50', reference: 'ESH-8050' })];
    const answer = register({ open: [[...page, ...second]], unprotected: [page, second] });
    listRegister.mockImplementation(async (options: { filter: string; page: number }) =>
      answer(options),
    );

    const { snapshot } = await gatherAiBrief();

    const late = snapshot.findings.find((one) => one.id === 'u-50');
    expect(late?.noVerifiedInterimControl).toBe(true);
    expect(snapshot.findings.filter((one) => one.noVerifiedInterimControl)).toHaveLength(51);
  });

  it('reports the missing portion when the walk cannot reach the total', async () => {
    const page = Array.from({ length: 50 }, (_, index) =>
      finding({ findingId: `s-${index}`, reference: `ESH-${7000 + index}` }),
    );
    const answer = register({ open: [page], unprotected: [[]] });
    listRegister.mockImplementation(async (options: { filter: string; page: number }) =>
      answer(options, { open: 61 }),
    );

    const { markdown } = await gatherAiBrief();

    expect(markdown).toContain('**INCOMPLETE**');
    expect(markdown).toContain('11 of 61 open findings were not read');
    expect(markdown).toContain('### Incomplete sources');
  });
});

describe('v317 restricted findings leave no trace, including in the counts', () => {
  it('keeps a restricted finding out of the interim-protection count', async () => {
    const ordinary = finding({ findingId: 'f-open', reference: 'ESH-9001' });
    const restricted = finding({
      findingId: 'f-secret',
      reference: 'ESH-9002',
      title: 'Operator health referral after the solvent exposure',
      isRestricted: true,
    });
    /* Both are unprotected; only one of them may be spoken about. */
    const answer = register({
      open: [[ordinary, restricted]],
      unprotected: [[ordinary, restricted]],
    });
    listRegister.mockImplementation(async (options: { filter: string; page: number }) =>
      answer(options),
    );

    const { markdown, snapshot } = await gatherAiBrief();

    expect(snapshot.findings).toHaveLength(1);
    expect(snapshot.restrictedFindingsExcluded).toBe(1);

    /* The count that used to include it. One of two, reported as one of one. */
    expect(markdown).toContain('| Interim protection check | 1 | 1 | complete');
    expect(markdown).toContain('| ESH findings (open) | 1 | 1 | complete');

    expect(markdown).not.toContain('ESH-9002');
    expect(markdown).not.toContain('Operator health referral');
    expect(markdown).toContain('1 restricted finding(s) excluded by product rule');
    expect(markdown).toContain('from this count and from every other count in this brief');
  });

  it('counts the significant-finding alarm on the visible findings alone', async () => {
    const restricted = finding({
      findingId: 'f-secret',
      reference: 'ESH-9003',
      isRestricted: true,
    });
    const answer = register({ open: [[restricted]], unprotected: [[restricted]] });
    listRegister.mockImplementation(async (options: { filter: string; page: number }) =>
      answer(options),
    );

    const { markdown, snapshot } = await gatherAiBrief();

    expect(snapshot.findings).toHaveLength(0);
    expect(markdown).not.toContain('have no verified interim control');
    expect(markdown).toContain('| Interim protection check | 0 | 0 | complete');
  });
});

describe('v317 no count is the number of rows that came back', () => {
  it('reports the task total from the count, and the shortfall against it', async () => {
    listOpenTasksComplete.mockImplementation(async (options: { scope: string }) =>
      options.scope === 'team'
        ? { tasks: [task('t-1')], total: 97, complete: false }
        : { tasks: [], total: 0, complete: true },
    );

    const { markdown } = await gatherAiBrief();

    expect(markdown).toContain('| Team tasks (open) | 1 | 97 | **INCOMPLETE**');
    expect(markdown).toContain('96 of 97 not included.');
  });

  it('says the updates total is unverified rather than claiming the walk finished', async () => {
    listOpenTasksComplete.mockImplementation(async (options: { scope: string }) =>
      options.scope === 'team'
        ? { tasks: [task('t-1')], total: 1, complete: true }
        : { tasks: [], total: 0, complete: true },
    );
    getLatestTaskUpdatesComplete.mockResolvedValue({
      updates: new Map(),
      unverified: 9,
      failed: false,
    });

    const { markdown } = await gatherAiBrief();

    expect(markdown).toContain('| Latest employee updates | 0 | not counted | **INCOMPLETE**');
    expect(markdown).toContain('9 task(s) could not be walked to the end');
    expect(markdown).toContain('unknown rather than no');
  });

  it('calls the updates total verified once the walk has finished', async () => {
    listOpenTasksComplete.mockImplementation(async (options: { scope: string }) =>
      options.scope === 'team'
        ? { tasks: [task('t-1')], total: 1, complete: true }
        : { tasks: [], total: 0, complete: true },
    );
    getLatestTaskUpdatesComplete.mockResolvedValue({
      updates: new Map([
        [
          't-1',
          {
            taskId: 't-1',
            authorName: 'Amer',
            body: 'Waiting on the contractor quotation.',
            createdAt: '2026-11-07T02:00:00.000Z',
          },
        ],
      ]),
      unverified: 0,
      failed: false,
    });

    const { markdown } = await gatherAiBrief();

    expect(markdown).toContain('| Latest employee updates | 1 | 1 | complete');
    expect(markdown).toContain('Waiting on the contractor quotation.');
  });
});

describe('v317 the checklist read pages too', () => {
  it('asks for a second page and counts what the source holds', async () => {
    listOpenTasksComplete.mockImplementation(async (options: { scope: string }) =>
      options.scope === 'team'
        ? { tasks: [task('t-1')], total: 1, complete: true }
        : { tasks: [], total: 0, complete: true },
    );
    state.checklistPages = [
      {
        data: Array.from({ length: 1000 }, (_, index) => ({
          id: `c-${index}`,
          task_id: 't-1',
          action: `Step ${index}`,
          position: index,
          state: 'ready',
          due_at: null,
          evidence_rule: 'optional',
          depends_on_item_id: null,
        })),
        count: 1004,
        error: null,
      },
      {
        data: Array.from({ length: 4 }, (_, index) => ({
          id: `d-${index}`,
          task_id: 't-1',
          action: `Later step ${index}`,
          position: 1000 + index,
          state: 'ready',
          due_at: null,
          evidence_rule: 'optional',
          depends_on_item_id: null,
        })),
        count: 1004,
        error: null,
      },
    ];

    const { markdown } = await gatherAiBrief();

    expect(state.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(markdown).toContain('| Checklist actions (open) | 1004 | 1004 | complete');
    expect(markdown).toContain('Later step 3');
  });

  it('names the steps it could not read rather than reporting what it got', async () => {
    listOpenTasksComplete.mockImplementation(async (options: { scope: string }) =>
      options.scope === 'team'
        ? { tasks: [task('t-1')], total: 1, complete: true }
        : { tasks: [], total: 0, complete: true },
    );
    state.checklistPages = [
      {
        data: [
          {
            id: 'c-1',
            task_id: 't-1',
            action: 'Obtain the contractor quotation',
            position: 0,
            state: 'ready',
            due_at: null,
            evidence_rule: 'optional',
            depends_on_item_id: null,
          },
        ],
        /* The source says there are more than arrived. */
        count: 12,
        error: null,
      },
    ];

    const { markdown } = await gatherAiBrief();

    expect(markdown).toContain('| Checklist actions (open) | 1 | 12 | **INCOMPLETE**');
    expect(markdown).toContain('11 of 12 open steps were not read');
  });
});

function task(id: string) {
  return {
    id,
    title: 'Replace the torn suction hose',
    description: 'The hose on pump 2 is split along the reinforcement.',
    ownerName: 'Amer',
    status: 'active',
    workClass: 'focus',
    urgency: 'high',
    isMandatory: false,
    dueAt: '2026-11-14',
    isOverdue: false,
    isStale: false,
    progressPercent: 40,
    checklistCompleted: 1,
    checklistTotal: 4,
    openBarrierCount: 0,
    delegatedOpenCount: 0,
    delegatedOverdueCount: 0,
    completionEvidenceRule: 'optional',
    reviewStatus: null,
    assignedByName: 'Izzul Asyraf',
  };
}
