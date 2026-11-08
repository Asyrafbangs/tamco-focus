import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v303 — "what has my team achieved" had no tool that could answer it.
 *
 * A head of department asked for last week's team load and what they had
 * achieved, and got a correct, useless reply: a snapshot of right now, and "I
 * cannot establish last week's load from this record alone". The model was
 * not at fault and no prompt could have fixed it. `team_load_summary` holds
 * live counts and no history, so the question had no data behind it.
 *
 * It had data elsewhere: `getTeamActivity` is what the My Team screen reads -
 * audit events plus completions over a period, scoped by the same
 * `getTeamLoad` as every other team view.
 *
 * What these tests pin is the shape of the answer rather than the plumbing:
 *
 *   * counts per person, because 25 rows cannot hold a week of raw events and
 *     a truncated sample of a log is worse than a count;
 *   * people with nothing recorded present with zeros, because "nobody
 *     recorded anything for her last week" is usually the finding;
 *   * a failed read throws rather than reporting an idle week.
 */

const getTeamActivity = vi.fn();

vi.mock('@/server/esh/queries', () => ({
  listRegister: vi.fn(),
  getFindingDetail: vi.fn(),
  getHazardDistribution: vi.fn(),
  listVerificationQueue: vi.fn(),
}));
vi.mock('@/server/esh/access', () => ({ getEshAccess: vi.fn() }));
vi.mock('@/server/queries', () => ({
  getMyTasks: vi.fn(),
  getStepsIOwe: vi.fn(),
  getTaskDetail: vi.fn(),
  getTeamLoad: vi.fn(),
}));
vi.mock('@/server/team-activity', () => ({
  getTeamActivity: (...args: unknown[]) => getTeamActivity(...args),
}));

const { toolByName } = await import('@/server/ai/tools');
const teamActivity = toolByName('list_team_activity')!;
const caller = { userId: 'hod-1', fullName: 'Izzul', timezone: 'Asia/Kuala_Lumpur' };

const TEAM = [
  { userId: 'u-1', fullName: 'Nagarajan Munusamy' },
  { userId: 'u-2', fullName: 'Nurizzah Aqilah' },
];

const event = (over: Record<string, unknown>) => ({
  id: `e-${Math.random()}`,
  kind: 'completed',
  at: '2026-11-06T02:00:00.000Z',
  personId: 'u-1',
  personName: 'Nagarajan Munusamy',
  taskId: 't-1',
  taskTitle: 'Replace damaged fence panel',
  parentTitle: null,
  body: null,
  progressAfter: null,
  progressBefore: null,
  dueFrom: null,
  dueTo: null,
  ...over,
});

function shownRows(evidence: string): Array<Record<string, unknown>> {
  const line = evidence.split('\n').find((one) => one.startsWith('{'));
  if (!line) throw new Error('no record set in the evidence block');
  return JSON.parse(line).rows as Array<Record<string, unknown>>;
}

function payload(evidence: string): Record<string, unknown> {
  const line = evidence.split('\n').find((one) => one.startsWith('{'))!;
  return JSON.parse(line) as Record<string, unknown>;
}

beforeEach(() => {
  getTeamActivity.mockReset();
});

describe('v303 list_team_activity', () => {
  it('counts what each person did, and names what they finished', async () => {
    getTeamActivity.mockResolvedValue({
      team: TEAM,
      failed: false,
      events: [
        event({}),
        event({ kind: 'completed', taskId: 't-2', taskTitle: 'Guard interlock check' }),
        event({ kind: 'note', taskId: 't-3' }),
        event({ kind: 'blocked', taskId: 't-3' }),
        event({
          kind: 'routine',
          personId: 'u-2',
          personName: 'Nurizzah Aqilah',
          taskId: 't-9',
          taskTitle: 'Weekly extraction check',
        }),
      ],
    });

    const outcome = await teamActivity.run({ period: '7' }, caller);
    const rows = shownRows(outcome.evidence);

    const nagarajan = rows.find((one) => one.person === 'Nagarajan Munusamy')!;
    expect(nagarajan).toMatchObject({
      completed: 2,
      progress_updates: 1,
      barriers_raised: 1,
      routines_done: 0,
    });
    expect(nagarajan.completed_titles).toEqual([
      'Replace damaged fence panel',
      'Guard interlock check',
    ]);
    expect(rows.find((one) => one.person === 'Nurizzah Aqilah')).toMatchObject({
      routines_done: 1,
      completed: 0,
    });
    /* Finished work is linkable, which is what the "What I read" list shows. */
    expect(outcome.sources.length).toBeGreaterThan(0);
  });

  it('returns a person with nothing recorded, rather than leaving them out', async () => {
    /*
     * The whole point of the question. A quiet week for somebody is a finding
     * a head of department wants; dropping the row would hide it, and the
     * model cannot report an absence it was never shown.
     */
    getTeamActivity.mockResolvedValue({ team: TEAM, failed: false, events: [event({})] });

    const rows = shownRows((await teamActivity.run({ period: '7' }, caller)).evidence);

    expect(rows).toHaveLength(2);
    expect(rows.find((one) => one.person === 'Nurizzah Aqilah')).toMatchObject({
      completed: 0,
      progress_updates: 0,
      last_activity: null,
    });
  });

  it('carries the period with the rows', async () => {
    /*
     * Counts without a range are unattributable, and "last week" is exactly
     * what the answer has to be precise about.
     */
    getTeamActivity.mockResolvedValue({ team: TEAM, failed: false, events: [] });

    const body = payload((await teamActivity.run({ period: '30' }, caller)).evidence);

    expect(body.period).toBe('Last 30 days');
    expect(typeof body.since).toBe('string');
  });

  it('reads an exact range when one is given', async () => {
    getTeamActivity.mockResolvedValue({ team: TEAM, failed: false, events: [] });

    await teamActivity.run({ from: '2026-11-02', to: '2026-11-06' }, caller);

    const call = getTeamActivity.mock.calls[0]!;
    const period = call[1] as {
      since: string;
      until: string | null;
      label: string;
    };
    /*
     * The dates are the asker's local days, not UTC ones. Midnight on 2
     * November in Kuala Lumpur is 1 November at 16:00 UTC, and the range runs
     * to the last millisecond of the 6th. Read as UTC instead, "last week"
     * would quietly lose the first eight hours of Monday and gain eight of
     * the following Saturday - a whole shift, in a report about a shift.
     */
    expect(period.since).toBe('2026-11-01T16:00:00.000Z');
    expect(period.until).toBe('2026-11-06T15:59:59.999Z');
    expect(period.label).toBe('2 Nov to 6 Nov');
    expect(call[2]).toBe('Asia/Kuala_Lumpur');
  });

  it('counts one person finishing one piece of work once', async () => {
    /*
     * v304. The source merges three queries and a task can arrive from two
     * of them: `task_overview` as the owner's completion, and
     * `completed_contributions` as that same person's contribution to it.
     * Counted naively, three finished tasks read as six and the titles
     * repeat - a figure a head of department would take into a review.
     * `getTeamActivityCount` has always de-duplicated for this reason, so
     * this agrees with the screen instead of inventing a second arithmetic.
     */
    getTeamActivity.mockResolvedValue({
      team: TEAM,
      failed: false,
      events: [
        event({ kind: 'completed', taskId: 't-1', taskTitle: 'Replace damaged fence panel' }),
        event({ kind: 'contribution', taskId: 't-1', taskTitle: 'Replace damaged fence panel' }),
        event({ kind: 'completed', taskId: 't-2', taskTitle: 'Guard interlock check' }),
      ],
    });

    const rows = shownRows((await teamActivity.run({ period: '7' }, caller)).evidence);
    const nagarajan = rows.find((one) => one.person === 'Nagarajan Munusamy')!;

    expect(nagarajan).toMatchObject({ completed: 2, contributed: 0 });
    expect(nagarajan.completed_titles).toEqual([
      'Replace damaged fence panel',
      'Guard interlock check',
    ]);
  });

  it('keeps the completion when the same work also arrives as a contribution', async () => {
    /*
     * Order-independent: the queries are concatenated, so whichever ran
     * first must not decide how the work is described. A completion is the
     * stronger statement and wins either way round.
     */
    for (const events of [
      [
        event({ kind: 'contribution', taskId: 't-7', taskTitle: 'Noise survey' }),
        event({ kind: 'completed', taskId: 't-7', taskTitle: 'Noise survey' }),
      ],
      [
        event({ kind: 'completed', taskId: 't-7', taskTitle: 'Noise survey' }),
        event({ kind: 'contribution', taskId: 't-7', taskTitle: 'Noise survey' }),
      ],
    ]) {
      getTeamActivity.mockResolvedValue({ team: TEAM, failed: false, events });
      const rows = shownRows((await teamActivity.run({ period: '7' }, caller)).evidence);
      expect(rows.find((one) => one.person === 'Nagarajan Munusamy')).toMatchObject({
        completed: 1,
        contributed: 0,
      });
    }
  });

  it('reports the latest activity, not whichever query answered first', async () => {
    /*
     * v304. `getTeamActivity` concatenates three queries rather than merging
     * them in time order, so "the first event seen" was whichever query ran
     * first - which reported a fortnight-old audit event as somebody's most
     * recent activity, on a screen a manager reads to find out who has gone
     * quiet.
     */
    getTeamActivity.mockResolvedValue({
      team: TEAM,
      failed: false,
      events: [
        event({ kind: 'note', taskId: 't-3', at: '2026-11-02T01:00:00.000Z' }),
        event({ kind: 'completed', taskId: 't-4', at: '2026-11-06T08:30:00.000Z' }),
        event({ kind: 'evidence', taskId: 't-5', at: '2026-11-03T04:00:00.000Z' }),
      ],
    });

    const rows = shownRows((await teamActivity.run({ period: '7' }, caller)).evidence);
    expect(rows.find((one) => one.person === 'Nagarajan Munusamy')!.last_activity).toBe(
      '2026-11-06T08:30:00.000Z',
    );
  });

  it('ignores an event for somebody the caller may not see', async () => {
    /*
     * Visibility is the database's answer, not this tool's: `getTeamLoad`
     * decides who is in `team`. This asserts the tool cannot widen it - an
     * event whose person is outside that list adds no row and no count, so a
     * future change to the underlying query cannot leak a stranger's work
     * into a head of department's summary through the back door.
     */
    getTeamActivity.mockResolvedValue({
      team: TEAM,
      failed: false,
      events: [
        event({ kind: 'completed', personId: 'outsider-9', personName: 'Someone Else' }),
        event({ kind: 'completed', taskId: 't-2' }),
      ],
    });

    const rows = shownRows((await teamActivity.run({ period: '7' }, caller)).evidence);
    expect(rows.map((one) => one.person)).toEqual(
      expect.arrayContaining(['Nagarajan Munusamy', 'Nurizzah Aqilah']),
    );
    expect(rows).toHaveLength(2);
    expect(rows.some((one) => one.person === 'Someone Else')).toBe(false);
    expect(rows.find((one) => one.person === 'Nagarajan Munusamy')).toMatchObject({ completed: 1 });
  });

  it('a period that cannot be read fails, rather than reporting an idle team', async () => {
    getTeamActivity.mockResolvedValue({ team: TEAM, failed: true, events: [] });
    await expect(teamActivity.run({ period: '7' }, caller)).rejects.toThrow(
      'TEAM_ACTIVITY_UNAVAILABLE',
    );
  });
});
