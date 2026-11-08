import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v302 — the team tool answered "nobody" to everybody.
 *
 * Found on a live screen, not by a test. A head of department asked "how is my
 * team doing last week" and was told his team "looks light on visible
 * workload", with the assistant noting that the team's work "returned no
 * visible team workload". He does see his team, and they were not idle.
 *
 * The model was not at fault. `list_team_workload` called
 * `getTeamAvailableWork`, which returns `{ groups, failed }`, and then wrote:
 *
 *     const rows = Array.isArray(work) ? work : [];
 *
 * An object is not an array, so the true branch was dead and the tool returned
 * **zero rows on every call for every caller** - a sentence about a team,
 * produced from no evidence about that team, and phrased with exactly the
 * hedging that makes it sound diligent. That is the v298 lesson again: an
 * answer that reads as careful is the hardest kind of wrong to notice.
 *
 * The same expression discarded `failed`, so a failed query would have arrived
 * as the same emptiness - the one outcome `getTeamAvailableWork`'s own comment
 * says must never be rendered as "nobody has anything waiting".
 *
 * These tests fail against the old implementation: the first two because the
 * rows are empty, the third because an unreadable team was reported as an
 * empty one.
 */

const getTeamLoad = vi.fn();
/*
 * The query the tool used to call. It is mocked, and generously - with work
 * in it - so that reverting the fix fails these tests for the right reason:
 * not "the function is missing", but "the team had work and the tool reported
 * none".
 */
const getTeamAvailableWork = vi.fn(async () => ({
  groups: [{ ownerId: 'u-EHS-004', ownerName: 'Amer Syazwan Mansoor', tasks: [{ id: 't1' }] }],
  failed: false,
}));

vi.mock('@/server/esh/queries', () => ({
  listRegister: vi.fn(),
  getFindingDetail: vi.fn(),
  getHazardDistribution: vi.fn(),
  listVerificationQueue: vi.fn(),
}));
vi.mock('@/server/esh/access', () => ({
  getEshAccess: vi.fn(),
}));
vi.mock('@/server/queries', () => ({
  getMyTasks: vi.fn(),
  getStepsIOwe: vi.fn(),
  getTaskDetail: vi.fn(),
  getTeamLoad: (...args: unknown[]) => getTeamLoad(...args),
  getTeamAvailableWork: () => getTeamAvailableWork(),
}));

const { toolByName } = await import('@/server/ai/tools');
const teamWorkload = toolByName('list_team_workload')!;
const caller = { userId: 'hod-1', fullName: 'Izzul', timezone: 'Asia/Kuala_Lumpur' };

/** One row of `team_load_summary`, as `getTeamLoad` maps it. */
const member = (
  fullName: string,
  employeeId: string,
  over: Partial<Record<string, number>> = {},
) => ({
  userId: `u-${employeeId}`,
  fullName,
  employeeId,
  availableWorkCount: 0,
  overdueCount: 0,
  staleCount: 0,
  openBarrierCount: 0,
  routinesThisWeek: 0,
  routinesCompletedThisWeek: 0,
  routinesOverdue: 0,
  quickActionsCreatedThisWeek: 0,
  operationalCreatedThisWeek: 0,
  decisionsPending: 0,
  ...over,
});

/**
 * The rows the model is actually shown.
 *
 * `ToolOutcome.rows` is a count, not the data - every tool returns
 * `capped.shown`. The records travel inside the fenced `asEvidence` block, so
 * a test that only read `rows` would be asserting on a number and would pass
 * against a tool handing the model an empty record set.
 */
function shownRows(evidence: string): Array<Record<string, unknown>> {
  const line = evidence.split('\n').find((one) => one.startsWith('{'));
  if (!line) throw new Error('no record set in the evidence block');
  return JSON.parse(line).rows as Array<Record<string, unknown>>;
}

beforeEach(() => {
  getTeamLoad.mockReset();
});

describe('v302 list_team_workload returns the team', () => {
  it('returns a row for each person, carrying the counts the question needs', async () => {
    getTeamLoad.mockResolvedValue([
      member('Amer Syazwan Mansoor', 'EHS-004', { availableWorkCount: 6, overdueCount: 2 }),
      member('Nurizzah Aqilah', 'EHS-005', { staleCount: 3, decisionsPending: 1 }),
    ]);

    const outcome = await teamWorkload.run({}, caller);

    /*
     * The assertion that would have caught the defect on the day it shipped,
     * and the cheapest one to write: the tool returned nothing, for a team of
     * two with eleven things between them.
     */
    const rows = shownRows(outcome.evidence);
    expect(outcome.rows).toBe(2);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      person: 'Amer Syazwan Mansoor',
      employee_id: 'EHS-004',
      available_work: 6,
      overdue: 2,
    });
    expect(rows[1]).toMatchObject({
      person: 'Nurizzah Aqilah',
      stale: 3,
      decisions_pending: 1,
    });
    expect(getTeamLoad).toHaveBeenCalledWith('hod-1');
  });

  it('distinguishes a person with nothing on from a team that was never read', async () => {
    /*
     * Both of these are legitimately "no work", and the difference matters to
     * the answer: a quiet team is a finding, an unread team is not.
     */
    getTeamLoad.mockResolvedValue([member('Mohd Fadli Baharil', 'EHS-002')]);

    const outcome = await teamWorkload.run({}, caller);

    const rows = shownRows(outcome.evidence);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ person: 'Mohd Fadli Baharil', available_work: 0 });
  });

  it('manages nobody is an empty answer, and stays one', async () => {
    getTeamLoad.mockResolvedValue([]);
    const outcome = await teamWorkload.run({}, caller);
    expect(outcome.rows).toBe(0);
    expect(shownRows(outcome.evidence)).toEqual([]);
  });

  it('a team that cannot be read fails, rather than reading as a team with nothing on', async () => {
    /*
     * `getTeamLoad` throws `TEAM_LOAD_UNAVAILABLE` when the query errors. The
     * agent loop turns a thrown tool into a failed tool result, which the
     * prompt requires the model to admit; swallowing it here would hand back
     * `[]` and let the assistant say the team is idle because the database
     * was unreachable. The old implementation did exactly that for every
     * call, successful or not.
     */
    getTeamLoad.mockRejectedValue(new Error('TEAM_LOAD_UNAVAILABLE'));
    await expect(teamWorkload.run({}, caller)).rejects.toThrow('TEAM_LOAD_UNAVAILABLE');
  });
});
