import { describe, expect, it } from 'vitest';

import { escapeHtml, renderSummary, runWeeklySummaryWorker } from '@/server/workers/weekly-summary';

const NOW = new Date('2026-08-31T02:00:00.000Z');
const WINDOW = {
  due: true,
  reportingStart: new Date('2026-08-23T16:00:00.000Z'),
  reportingEnd: new Date('2026-08-30T16:00:00.000Z'),
  planningEnd: new Date('2026-09-06T16:00:00.000Z'),
};

type Input = Parameters<typeof renderSummary>[0];
type Task = Input['tasks'][number];
type Goal = NonNullable<Input['goals']>[number];
type Barrier = NonNullable<Input['barriers']>[number];
type Shared = NonNullable<Input['sharedContributions']>[number];
type Review = NonNullable<Input['completionReviews']>[number];
type RoutineOutcome = NonNullable<Input['routineOutcomes']>[number];

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: 'Sample work',
    status: 'active',
    work_class: 'operational_action',
    due_at: '2026-09-02T09:00:00.000Z',
    due_is_date_only: false,
    completed_at: null,
    is_overdue: false,
    is_stale: false,
    is_mandatory: false,
    over_focus_target: false,
    last_meaningful_update_at: '2026-08-30T02:00:00.000Z',
    primary_owner_id: 'person-1',
    owner_name: 'Izzah Nurul',
    review_at: null,
    review_status: 'not_required',
    reviewer_id: null,
    urgency: 'normal',
    ...overrides,
  } as Task;
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: crypto.randomUUID(),
    owner_id: 'person-1',
    owner_name: 'Izzah Nurul',
    title: 'Safety Digitalisation',
    status: 'active',
    open_support_count: 0,
    needs_attention: false,
    manager_needs_attention: false,
    is_checkin_due: false,
    is_update_requested: false,
    quarterly_requires_manager_action: false,
    pending_version_id: null,
    ...overrides,
  } as Goal;
}

function barrier(overrides: Partial<Barrier> = {}): Barrier {
  return {
    id: crypto.randomUUID(),
    action_pending: true,
    action_required_from: 'person-1',
    action_type: 'decision',
    add_to_meeting_queue: false,
    description: 'Supplier access is blocked',
    goal_id: null,
    impact: 'may_delay',
    raised_at: '2026-08-30T02:00:00.000Z',
    raised_by: 'manager-1',
    resolution_note: null,
    resolved_at: null,
    resolved_by: null,
    source_active: true,
    source_inactive_at: null,
    status: 'open',
    support_needed: 'Confirm the revised access date',
    task_id: null,
    version: 1,
    ...overrides,
  } as Barrier;
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: crypto.randomUUID(),
    task_id: 'review-task',
    submitted_at: '2026-08-28T02:00:00.000Z',
    submitted_by: 'person-1',
    reviewer_id: 'manager-1',
    decision: 'changes_requested',
    decision_note: 'Add the final verification photo',
    decided_at: '2026-08-29T02:00:00.000Z',
    second_reviewer_id: null,
    second_decision: null,
    second_decided_at: null,
    ...overrides,
  } as Review;
}

function routineOutcome(overrides: Partial<RoutineOutcome> = {}): RoutineOutcome {
  return {
    cancelled_at: null,
    completed_at: null,
    decided_at: null,
    decided_by: null,
    decided_by_name: null,
    decision_note: null,
    exception_id: null,
    exception_state: null,
    occurrence_date: '2026-08-29',
    outcome: 'open',
    primary_owner_id: 'person-1',
    raised_at: null,
    raised_by: null,
    raised_by_name: null,
    reason_code: null,
    reason_note: null,
    routine_template_id: 'routine-template-1',
    status: 'backlog',
    task_id: 'routine-task',
    title: 'Weekly fire-pump check',
    ...overrides,
  };
}

function shared(overrides: Partial<Shared> = {}): Shared {
  return {
    checklist_item_id: crypto.randomUUID(),
    task_id: 'parent-task',
    title: 'Verify isolation points',
    assignee_id: 'person-1',
    evidence_rule: 'optional',
    item_due_at: '2026-09-03T09:00:00.000Z',
    depends_on_item_id: null,
    state: 'ready',
    completed_at: null,
    position: 1,
    parent_title: 'Substation outage preparation',
    parent_status: 'active',
    parent_work_class: 'major_project',
    parent_due_at: '2026-09-05T09:00:00.000Z',
    parent_due_is_date_only: false,
    primary_owner_id: 'manager-1',
    primary_owner_name: 'Amer Hakim',
    prerequisite_title: null,
    readiness: 'ready',
    ...overrides,
  } as Shared;
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'person-1',
    full_name: 'Izzah Nurul',
    email: 'izzah@tamco.local',
    role: 'employee',
    personal_summary_mode: 'standard',
    team_summary_mode: 'off',
    ...overrides,
  } as unknown as Input['profile'];
}

function render(overrides: Partial<Input> = {}) {
  return renderSummary({
    profile: profile(),
    mode: 'standard',
    tasks: [],
    teamTasks: [],
    appBaseUrl: 'http://localhost:3000',
    now: NOW,
    window: WINDOW,
    timeZone: 'Asia/Kuala_Lumpur',
    ...overrides,
  });
}

describe('weekly email HTML safety and envelope', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('neutralises hostile titles and display names in the HTML part', () => {
    const { html, text } = render({
      profile: profile({ full_name: '</p><script>bad()</script>' }),
      tasks: [
        task({
          title: '<img src=x onerror=alert(1)>',
          status: 'completed',
          completed_at: '2026-08-29T02:00:00.000Z',
        }),
      ],
    });

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(text).toContain('<img src=x onerror=alert(1)>');
  });

  it('uses exception-aware and healthy subjects', () => {
    expect(render().subject).toBe('TAMCO Focus — Your week ahead · 0 commitments');
    expect(
      render({
        tasks: [
          task({ title: 'Overdue one', due_at: '2026-08-28T02:00:00.000Z', is_overdue: true }),
          task({ title: 'Due this week' }),
        ],
      }).subject,
    ).toBe('TAMCO Focus — 1 needs attention · 1 due this week');
  });

  it('uses a compact table-based design with safe links to My Day and completed work', () => {
    const { html, text } = render({
      tasks: [
        task({
          title: 'Finished work',
          status: 'completed',
          completed_at: '2026-08-29T02:00:00.000Z',
        }),
      ],
    });

    expect(html).toContain('role="presentation"');
    expect(html).toContain('max-width:620px');
    expect(html).toContain('Your week at a glance');
    expect(html).not.toContain('linear-gradient');
    expect(html).toContain('href="http://localhost:3000/today"');
    expect(html).toContain('href="http://localhost:3000/more/records?state=completed"');
    expect(text).toContain('Open My Day: http://localhost:3000/today');
  });
});

describe('lean personal selection', () => {
  it('removes the old report-like sections and hides empty sections', () => {
    const { text, html } = render();

    expect(text).toContain('NEEDS ATTENTION');
    expect(text).toContain('Nothing urgent needs your attention.');
    expect(text).not.toContain('THIS WEEK');
    expect(text).not.toContain('COMPLETED LAST WEEK');
    expect(text).not.toContain('Meaningful changes');
    expect(text).not.toContain('Recommended starting point');
    expect(text).not.toContain('Routine work due');
    expect(html).not.toContain('email-kpi');
  });

  it('surfaces overdue work, returned routines, action barriers and requested changes', () => {
    const { text } = render({
      tasks: [
        task({
          id: 'overdue-task',
          title: 'Close corrective action',
          due_at: '2026-08-28T02:00:00.000Z',
          is_overdue: true,
        }),
        task({
          id: 'routine-task',
          title: 'Weekly fire-pump check',
          work_class: 'routine_occurrence',
          due_at: '2026-08-29T02:00:00.000Z',
          is_overdue: true,
          status: 'backlog',
        }),
        task({ id: 'review-task', title: 'Inspection close-out', due_at: null }),
      ],
      routineOutcomes: [routineOutcome({ exception_state: 'returned' })],
      completionReviews: [review()],
      barriers: [barrier()],
    });

    expect(text).toContain('Close corrective action — Overdue');
    expect(text).toContain('Returned by manager · Still due');
    expect(text).toContain('Changes requested after completion review');
    expect(text).toContain('Supplier access is blocked — Action requested');
  });

  it('does not call a routine overdue while its not-required request awaits review', () => {
    const { text } = render({
      tasks: [
        task({
          id: 'routine-task',
          title: 'Routine legitimately awaiting review',
          work_class: 'routine_occurrence',
          due_at: '2026-08-28T02:00:00.000Z',
          is_overdue: true,
          status: 'backlog',
        }),
      ],
      routineOutcomes: [
        routineOutcome({ exception_state: 'pending', outcome: 'awaiting_decision' }),
      ],
    });

    expect(text).not.toContain('Routine legitimately awaiting review');
    expect(text).toContain('Nothing urgent needs your attention.');
  });

  it('excludes Available Work by default and includes only urgent, due or review-bound exceptions', () => {
    const { text } = render({
      tasks: [
        task({ id: 'quiet', title: 'Quiet available item', status: 'backlog', due_at: null }),
        task({
          id: 'urgent',
          title: 'Critical available item',
          status: 'backlog',
          urgency: 'critical',
          due_at: null,
        }),
        task({ id: 'dated', title: 'Dated available item', status: 'backlog' }),
        task({
          id: 'review',
          title: 'Manager review this week',
          status: 'backlog',
          due_at: null,
          review_at: '2026-09-04T02:00:00.000Z',
        }),
      ],
    });

    expect(text).not.toContain('Quiet available item');
    expect(text).toContain('Critical available item');
    expect(text).toContain('Dated available item');
    expect(text).toContain('Manager review this week');
    expect(text).not.toContain('THIS WEEK');
  });

  it('merges Focus, current-week Routine and Shared contributions into This week', () => {
    const { text } = render({
      tasks: [
        task({ title: 'Monthly monitoring', work_class: 'operational_action' }),
        task({
          title: 'Weekly condition check',
          work_class: 'routine_occurrence',
          status: 'backlog',
        }),
        task({
          title: 'Future generated routine',
          work_class: 'routine_occurrence',
          due_at: '2026-09-09T09:00:00.000Z',
        }),
      ],
      sharedContributions: [shared()],
    });

    expect(text).toContain('THIS WEEK');
    expect(text).toContain('[Operational] Monthly monitoring');
    expect(text).toContain('[Routine] Weekly condition check');
    expect(text).toContain('[Shared] Verify isolation points');
    expect(text).toContain('Substation outage preparation');
    expect(text).not.toContain('Future generated routine');
    expect(text).not.toContain('Routine work due');
  });

  it('shows only the latest five completions in standard mode and keeps the history link', () => {
    const tasks = Array.from({ length: 7 }, (_, index) =>
      task({
        id: `done-${index}`,
        title: `Completed item ${index}`,
        status: 'completed',
        completed_at: `2026-08-${String(24 + index).padStart(2, '0')}T02:00:00.000Z`,
        due_at: null,
      }),
    );
    const { text } = render({ tasks });

    expect(text).toContain('Completed item 6');
    expect(text).toContain('Completed item 2');
    expect(text).not.toContain('Completed item 1');
    expect(text).toContain('View completed: http://localhost:3000/more/records?state=completed');
  });

  it('surfaces only Goal signals that require the employee to respond', () => {
    const { text } = render({
      goals: [
        goal({ title: 'Update requested Goal', is_update_requested: true }),
        goal({ title: 'Healthy Goal' }),
      ],
    });

    expect(text).toContain('[Goal] Update requested Goal — Update requested');
    expect(text).not.toContain('Healthy Goal');
    expect(text).not.toContain('% overall');
  });
});

describe('manager intervention digest', () => {
  it('aggregates actionable team signals by person without dumping team work', () => {
    const teamTask = task({
      id: 'team-overdue',
      primary_owner_id: 'employee-2',
      owner_name: 'Amer Hakim',
      title: 'Sensitive internal task title',
      is_overdue: true,
      due_at: '2026-08-28T02:00:00.000Z',
      over_focus_target: true,
      review_status: 'pending',
      reviewer_id: 'manager-1',
    });
    const { text, html } = render({
      profile: profile({
        id: 'manager-1',
        role: 'manager',
        team_summary_mode: 'leadership',
      }),
      teamTasks: [teamTask],
      teamPeople: [{ userId: 'employee-2', fullName: 'Amer Hakim' }],
      teamRoutineOutcomes: [
        routineOutcome({
          task_id: 'routine-2',
          primary_owner_id: 'employee-2',
          exception_state: 'pending',
          outcome: 'awaiting_decision',
        }),
      ],
      teamBarriers: [barrier({ task_id: 'team-overdue', action_required_from: 'manager-1' })],
      teamGoals: [
        goal({ owner_id: 'employee-2', owner_name: 'Amer Hakim', open_support_count: 1 }),
      ],
    });

    expect(text).toContain('TEAM NEEDS ATTENTION');
    expect(text).toContain('Amer Hakim — 1 overdue item');
    expect(text).toContain('1 completion awaiting review');
    expect(text).toContain('1 routine exception awaiting review');
    expect(text).toContain('1 barrier waiting on your decision');
    expect(text).toContain('1 Goal decision or support request');
    expect(text).toContain('workload review needed');
    expect(text).not.toContain('Sensitive internal task title');
    expect(text).not.toContain('Team wins');
    expect(text).not.toContain('Meaningful team changes');
    expect(text).not.toMatch(/performance score|ranking/i);
    expect(html).toContain('/work?scope=team&amp;filter=attention');
  });

  it('does not count a pending routine exception as an overdue team item', () => {
    const { text } = render({
      profile: profile({
        id: 'manager-1',
        role: 'manager',
        team_summary_mode: 'leadership',
      }),
      teamTasks: [
        task({
          id: 'routine-2',
          primary_owner_id: 'employee-2',
          owner_name: 'Amer Hakim',
          work_class: 'routine_occurrence',
          is_overdue: true,
          status: 'backlog',
        }),
      ],
      teamRoutineOutcomes: [
        routineOutcome({
          task_id: 'routine-2',
          primary_owner_id: 'employee-2',
          exception_state: 'pending',
          outcome: 'awaiting_decision',
        }),
      ],
    });

    expect(text).toContain('1 routine exception awaiting review');
    expect(text).not.toContain('overdue item');
  });

  it('keeps a terminal task visible only when its completion awaits this manager', () => {
    const { text } = render({
      profile: profile({
        id: 'manager-1',
        role: 'manager',
        team_summary_mode: 'leadership',
      }),
      teamTasks: [
        task({
          id: 'completed-review',
          primary_owner_id: 'employee-2',
          owner_name: 'Amer Hakim',
          title: 'Completed task title stays out of the digest',
          status: 'completed',
          completed_at: '2026-08-29T02:00:00.000Z',
          review_status: 'pending',
          reviewer_id: 'manager-1',
        }),
      ],
    });

    expect(text).toContain('Amer Hakim — 1 completion awaiting review');
    expect(text).not.toContain('Completed task title stays out of the digest');
  });
});

describe('sending transports must be able to send', () => {
  const client = {} as Parameters<typeof runWeeklySummaryWorker>[0];

  it.each(['smtp', 'inbucket'] as const)(
    'refuses to run under %s with no send function',
    async (transport) => {
      await expect(
        runWeeklySummaryWorker(client, { now: NOW, force: true, transport }),
      ).rejects.toThrow(/no send function was supplied/i);
    },
  );

  it('still allows the log transport, whose delivery record is the local output', async () => {
    await expect(
      runWeeklySummaryWorker(client, { now: NOW, force: true, transport: 'log' }),
    ).rejects.not.toThrow(/no send function was supplied/i);
  });
});
