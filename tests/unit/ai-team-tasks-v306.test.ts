import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v306 — the team's actual work, which no tool could see.
 *
 * The assistant was asked to help manage a team and could only count. Every
 * team tool returned figures per person — four overdue, two stale, three
 * routines — and none returned a task. So "what is my team's workload this
 * week" had one shape of answer available to it: rank the people by their
 * numbers and suggest chasing the worst. It was not being unhelpful; it was
 * describing the only thing it had been shown.
 *
 * `getVisibleTeamTasks` already existed and is what the My Team screen reads.
 * What these tests pin is the judgement in putting it in front of a model:
 * which fields a decision needs, what order survives truncation, and the two
 * distinctions a manager must never have blurred for them.
 */

const getVisibleTeamTasks = vi.fn();

vi.mock('@/server/esh/queries', () => ({
  listRegister: vi.fn(),
  getFindingDetail: vi.fn(),
  getHazardDistribution: vi.fn(),
  listVerificationQueue: vi.fn(),
}));
vi.mock('@/server/esh/access', () => ({ getEshAccess: vi.fn() }));
vi.mock('@/server/team-activity', () => ({ getTeamActivity: vi.fn() }));
vi.mock('@/server/queries', () => ({
  getMyTasks: vi.fn(),
  getStepsIOwe: vi.fn(),
  getTaskDetail: vi.fn(),
  getTeamLoad: vi.fn(),
  getVisibleTeamTasks: (...args: unknown[]) => getVisibleTeamTasks(...args),
}));

const { toolByName } = await import('@/server/ai/tools');
const teamTasks = toolByName('list_team_tasks')!;
const caller = { userId: 'hod-1', fullName: 'Izzul', timezone: 'Asia/Kuala_Lumpur' };

const task = (over: Record<string, unknown> = {}) => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`,
  title: 'A task',
  description: null,
  status: 'active',
  workClass: 'operational',
  urgency: 'normal',
  isMandatory: false,
  progressPercent: 0,
  reviewStatus: 'not_required',
  ownerName: 'Amer Syazwan Mansoor',
  assignedByName: null,
  dueAt: '2026-11-20',
  isOverdue: false,
  isStale: false,
  openBarrierCount: 0,
  checklistTotal: 0,
  checklistCompleted: 0,
  delegatedOpenCount: 0,
  delegatedOverdueCount: 0,
  evidenceCount: 0,
  completionEvidenceRule: 'none',
  ...over,
});

function shownRows(evidence: string): Array<Record<string, unknown>> {
  const line = evidence.split('\n').find((one) => one.startsWith('{'));
  if (!line) throw new Error('no record set in the evidence block');
  return JSON.parse(line).rows as Array<Record<string, unknown>>;
}

function payload(evidence: string): Record<string, unknown> {
  return JSON.parse(evidence.split('\n').find((one) => one.startsWith('{'))!) as Record<
    string,
    unknown
  >;
}

beforeEach(() => {
  getVisibleTeamTasks.mockReset();
});

describe('v306 the team’s work, as work', () => {
  it('returns the task, its owner and what a decision about it needs', async () => {
    getVisibleTeamTasks.mockResolvedValue([
      task({
        title: 'Replace guarding on press 2 and re-commission',
        ownerName: 'Nagarajan Munusamy',
        urgency: 'high',
        isMandatory: true,
        progressPercent: 20,
        openBarrierCount: 1,
        checklistTotal: 9,
        checklistCompleted: 2,
        completionEvidenceRule: 'photo',
        delegatedOpenCount: 2,
        delegatedOverdueCount: 1,
        dueAt: '2026-11-11',
      }),
    ]);

    const rows = shownRows((await teamTasks.run({ scope: 'all' }, caller)).evidence);

    expect(rows[0]).toMatchObject({
      task: 'Replace guarding on press 2 and re-commission',
      owner: 'Nagarajan Munusamy',
      urgency: 'high',
      mandatory: true,
      progress_percent: 20,
      open_barriers: 1,
      checklist: '2/9',
      evidence_required: 'photo',
      delegated_steps_overdue: 1,
    });
  });

  it('says plainly that no effort estimate exists, rather than leaving a gap to fill', async () => {
    /*
     * The product records no effort, duration or capacity anywhere. A model
     * asked which job is heaviest will otherwise supply a number, and a
     * manager will plan a week around it.
     */
    getVisibleTeamTasks.mockResolvedValue([task()]);
    const body = payload((await teamTasks.run({ scope: 'all' }, caller)).evidence);
    expect(String(body.note)).toMatch(/no effort, duration or capacity estimate/i);
  });

  it('keeps the rows a manager would have wanted when the list is truncated', async () => {
    /*
     * Twenty-five rows out of five hundred, so the order IS the selection.
     * Due date alone would put a dated trifle above an undated mandatory
     * job; what is already late comes first, then what is compulsory.
     */
    getVisibleTeamTasks.mockResolvedValue([
      task({ title: 'Tidy the noticeboard', dueAt: '2026-11-09' }),
      task({ title: 'Statutory lift inspection', isMandatory: true, dueAt: '2026-11-30' }),
      task({ title: 'Submit the overdue permit review', isOverdue: true, dueAt: '2026-10-28' }),
    ]);

    const rows = shownRows((await teamTasks.run({ scope: 'all' }, caller)).evidence);
    expect(rows.map((one) => one.task)).toEqual([
      'Submit the overdue permit review',
      'Statutory lift inspection',
      'Tidy the noticeboard',
    ]);
  });

  it('separates work awaiting a decision from work that is finished', async () => {
    /*
     * `in_review` is the distinction a manager must never have blurred: a
     * submission is not a completion, and counting it as one is how a week
     * gets planned around work nobody has accepted.
     */
    getVisibleTeamTasks.mockResolvedValue([
      task({ title: 'Noise survey report', reviewStatus: 'pending', progressPercent: 100 }),
      task({ title: 'Replace torn hose', reviewStatus: 'not_required' }),
    ]);

    const rows = shownRows((await teamTasks.run({ scope: 'in_review' }, caller)).evidence);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ task: 'Noise survey report', awaiting_review: true });
  });

  it('finds what is in the way, including a step somebody else owes', async () => {
    getVisibleTeamTasks.mockResolvedValue([
      task({ title: 'Blocked by a barrier', openBarrierCount: 1 }),
      task({ title: 'Waiting on another person’s step', delegatedOverdueCount: 2 }),
      task({ title: 'Running fine' }),
    ]);

    const rows = shownRows((await teamTasks.run({ scope: 'blocked' }, caller)).evidence);
    expect(rows.map((one) => one.task)).toEqual([
      'Blocked by a barrier',
      'Waiting on another person’s step',
    ]);
  });

  it('gives every row a record to open', async () => {
    /* So a priority table has a link behind each line rather than a name. */
    getVisibleTeamTasks.mockResolvedValue([task({ id: 't-77', title: 'Replace torn hose' })]);
    const outcome = await teamTasks.run({ scope: 'all' }, caller);
    expect(outcome.sources).toEqual([
      { kind: 'task', id: 't-77', label: 'Replace torn hose', href: '/work?task=t-77' },
    ]);
  });

  it('a team whose work cannot be read fails rather than reading as an idle team', async () => {
    getVisibleTeamTasks.mockRejectedValue(new Error('TEAM_TASKS_UNAVAILABLE'));
    await expect(teamTasks.run({ scope: 'all' }, caller)).rejects.toThrow('TEAM_TASKS_UNAVAILABLE');
  });
});
