import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v298 — a failed text match must not read as an empty register.
 *
 * The defect this guards is the worst one the complex evaluation found, and
 * it was not a model failure. `search_findings` matches free text with a
 * literal `ilike '*term*'`, and risk level is a column rather than prose. So
 * asked "how many critical findings do we have open?", the assistant searched
 * the word "critical", matched none of the sixteen open findings, and told a
 * manager there were none — across three turns, holding to it when pushed.
 * There were four, two of them overdue, one with no protection recorded.
 *
 * The same mechanism produced three more wrong answers in one run: "no
 * evidence of a repeated electrical-testing pattern" over three Test Bay 3
 * earthing findings, "I cannot establish a count of separate hazards" over
 * two linked reports of one press hazard, and a mezzanine edge reported as
 * unfindable because "mezzanine edge" is not a substring of "Open edge on
 * mezzanine walkway".
 *
 * Every one of those answers was carefully hedged, which is what makes this
 * worth a test rather than a prompt line: it does not read as a hallucination,
 * it reads as diligence, and a manager would act on it.
 */

const listRegister = vi.fn();
const getEshAccess = vi.fn();

const getTeamActivity = vi.fn(async () => ({ events: [], team: [], failed: false }));

vi.mock('@/server/esh/queries', () => ({
  listRegister: (...args: unknown[]) => listRegister(...args),
  getFindingDetail: vi.fn(),
  getHazardDistribution: vi.fn(),
  listVerificationQueue: vi.fn(),
}));
/* v303 — the tool layer now reads the team's history too. */
vi.mock('@/server/team-activity', () => ({
  getTeamActivity: () => getTeamActivity(),
}));
vi.mock('@/server/esh/access', () => ({
  getEshAccess: () => getEshAccess(),
}));
vi.mock('@/server/queries', () => ({
  getMyTasks: vi.fn(),
  getStepsIOwe: vi.fn(),
  getTaskDetail: vi.fn(),
  getTeamAvailableWork: vi.fn(),
}));

const { toolByName } = await import('@/server/ai/tools');
const searchFindings = toolByName('search_findings')!;
const caller = { userId: 'u1', fullName: 'Izzul', timezone: 'Asia/Kuala_Lumpur' };

/** One register row, with only the fields this tool actually passes on. */
const row = (reference: string, title: string) => ({
  findingId: `id-${reference}`,
  actionId: null,
  reference,
  title,
  location: 'Test Bay 3',
  departmentName: 'Operations',
  status: 'open',
  isRestricted: false,
  riskLevel: 'critical',
  actionState: 'assigned',
  priority: 'normal',
  dueAt: '2026-11-03',
  dueIsDateOnly: true,
  actionCount: 1,
  ownerEmail: 'lee@tamco.local',
  isOverdue: true,
  needsAttention: true,
  lastUpdateAt: '2026-11-07',
  lastUpdateType: 'assigned',
  closedAt: null,
  hazardLabel: null,
  notificationFailed: false,
  changesRequested: false,
  escalationLevel: null,
});

beforeEach(() => {
  listRegister.mockReset();
  getEshAccess.mockReset();
  getEshAccess.mockResolvedValue({ enabled: true, canCoordinate: true, scopeAll: true });
});

describe('v298 search_findings tells a failed match apart from an empty register', () => {
  it('reports how many records the filter holds when the text matched none', async () => {
    listRegister
      // The search the model actually ran: the word "critical".
      .mockResolvedValueOnce({ rows: [], total: 0, failed: false })
      // The same filter, counted again without the text.
      .mockResolvedValueOnce({
        rows: [row('F-003', 'Earth continuity not checked before energising, Bay 3')],
        total: 16,
        failed: false,
      });

    const outcome = await searchFindings.run({ filter: 'open', search: 'critical' }, caller);

    expect(listRegister).toHaveBeenCalledTimes(2);
    // The second call is the same filter with the text removed, not a guess.
    expect(listRegister.mock.calls[1]![0]).toMatchObject({ filter: 'open', search: '' });
    /*
     * The number is the point. "0 of 16" is what turns "there are none" into
     * "ask differently", and it is the one fact the model could not get.
     */
    expect(outcome.evidence).toContain('16');
    expect(outcome.evidence).toMatch(/matched none of the 16/i);
    expect(outcome.evidence).toMatch(/NOT an empty register/i);
    expect(outcome.rows).toBe(0);
  });

  it('does not count twice when the text matched something', async () => {
    listRegister.mockResolvedValueOnce({
      rows: [row('F-001', 'Earth bond missing on routine test rig, Bay 3')],
      total: 1,
      failed: false,
    });

    const outcome = await searchFindings.run({ filter: 'open', search: 'earth' }, caller);

    // A search that worked costs exactly one read, as it always did.
    expect(listRegister).toHaveBeenCalledTimes(1);
    expect(outcome.evidence).not.toMatch(/matched none/i);
    expect(outcome.rows).toBe(1);
  });

  it('does not count twice when there was no text to fail', async () => {
    listRegister.mockResolvedValueOnce({ rows: [], total: 0, failed: false });

    const outcome = await searchFindings.run({ filter: 'closed', search: '' }, caller);

    /*
     * An empty filter result with no search term is the genuine case prompt
     * rule 9c governs: nothing of that kind is visible to this person. There
     * is nothing to re-count and nothing to retry.
     */
    expect(listRegister).toHaveBeenCalledTimes(1);
    expect(outcome.evidence).not.toMatch(/matched none/i);
  });

  it('keeps a failed read a failed read, and never calls it a failed match', async () => {
    listRegister.mockResolvedValueOnce({ rows: [], total: 0, failed: true });

    const outcome = await searchFindings.run({ filter: 'open', search: 'critical' }, caller);

    expect(listRegister).toHaveBeenCalledTimes(1);
    expect(outcome.evidence).toMatch(/could not be read/i);
    expect(outcome.evidence).not.toMatch(/matched none/i);
  });

  it('says the search is literal, and that risk level is not text', async () => {
    /*
     * The description is the only place the model learns this before it
     * spends a call finding out. Asserted because the fix is half evidence
     * and half warning, and the warning is the half that prevents the call.
     */
    expect(searchFindings.description).toMatch(/literal substring/i);
    expect(searchFindings.description).toMatch(/not text|NOT text/);
    expect(searchFindings.description).toMatch(/count .*yourself|read the rows/i);
  });
});
