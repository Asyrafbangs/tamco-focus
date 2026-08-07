import { describe, expect, it } from 'vitest';

import { escapeHtml, renderSummary } from '@/server/workers/weekly-summary';

/**
 * The weekly summary is the only place user-entered text is rendered into HTML
 * that leaves the application, so the escaping is tested as a security control
 * rather than as formatting.
 *
 * The section selection is tested against PRODUCTION_LOGIC.md "V30 — Weekly
 * email preference logic", items 4 to 7: a focused summary is a shorter set,
 * a standard summary is the full personal set, and a manager's team sections
 * appear only when their team preference is on.
 */

const NOW = new Date('2026-08-06T02:00:00.000Z');

type Task = Parameters<typeof renderSummary>[0]['tasks'][number];
type Goal = NonNullable<Parameters<typeof renderSummary>[0]['goals']>[number];

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: 'Sample work',
    status: 'active',
    work_class: 'operational_action',
    due_at: '2026-08-10T09:00:00.000Z',
    completed_at: null,
    is_overdue: false,
    is_stale: false,
    is_mandatory: false,
    over_focus_target: false,
    last_meaningful_update_at: '2026-08-05T02:00:00.000Z',
    ...overrides,
  } as Task;
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: crypto.randomUUID(),
    owner_name: 'Izzah Nurul',
    title: 'Safety Digitalisation',
    status: 'active',
    reported_progress: 20,
    open_support_count: 0,
    needs_attention: false,
    is_checkin_due: false,
    is_update_requested: false,
    is_target_approaching: false,
    has_recent_milestone_completion: false,
    pending_version_id: null,
    last_meaningful_update_at: '2026-08-05T02:00:00.000Z',
    ...overrides,
  } as Goal;
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    full_name: 'Izzah Nurul',
    email: 'izzah@tamco.local',
    personal_summary_mode: 'standard',
    team_summary_mode: 'off',
    ...overrides,
  } as Parameters<typeof renderSummary>[0]['profile'];
}

function render(overrides: Partial<Parameters<typeof renderSummary>[0]> = {}) {
  return renderSummary({
    profile: profile(),
    mode: 'standard',
    tasks: [],
    changes: 0,
    teamTasks: [],
    teamChanges: 0,
    teamBarriers: 0,
    appBaseUrl: 'http://localhost:3000',
    now: NOW,
    ...overrides,
  });
}

describe('escapeHtml (section 14.4)', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes the ampersand first, so entities are not double-encoded', () => {
    // Escaping < before & would turn "<" into "&lt;" and then "&amp;lt;".
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('neutralises a script payload', () => {
    const payload = '<script>alert("xss")</script>';
    const escaped = escapeHtml(payload);

    expect(escaped).not.toContain('<script>');
    expect(escaped).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('neutralises an attribute-breakout payload', () => {
    const escaped = escapeHtml(`" onerror="alert(1)`);

    expect(escaped).not.toContain('"');
    expect(escaped).toContain('&quot;');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Close out corrective actions from the June audit')).toBe(
      'Close out corrective actions from the June audit',
    );
  });
});

describe('a hostile task title cannot escape the email body', () => {
  it('is escaped wherever it appears in the HTML', () => {
    const { html, text } = render({
      tasks: [
        task({
          title: '<img src=x onerror=alert(1)>',
          status: 'completed',
          completed_at: '2026-08-04T02:00:00.000Z',
        }),
      ],
    });

    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    // The plain-text part carries the raw title, which is correct: there is no
    // markup context to break out of.
    expect(text).toContain('<img src=x onerror=alert(1)>');
  });

  it('escapes a hostile display name in the greeting', () => {
    const { html } = render({ profile: profile({ full_name: '</p><script>bad()</script>' }) });

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('preference modes (PRODUCTION_LOGIC.md "V30", items 4 and 5)', () => {
  it('focused mode omits the fuller standard sections', () => {
    const { text } = render({ mode: 'focused', changes: 3 });

    expect(text).toContain('Wins from last week');
    expect(text).toContain('Needs attention');
    expect(text).toContain('Due this week');
    expect(text).toContain('Recommended starting point');

    expect(text).not.toContain('Meaningful changes');
    expect(text).not.toContain('Routine work due');
  });

  it('standard mode adds meaningful changes and routine work', () => {
    const { text } = render({ mode: 'standard', changes: 3 });

    expect(text).toContain('Meaningful changes');
    expect(text).toContain('3 recorded task changes last week.');
    expect(text).toContain('Routine work due');
  });

  it('counts a single change in the singular', () => {
    const { text } = render({ mode: 'standard', changes: 1 });
    expect(text).toContain('1 recorded task change last week.');
  });
});

describe('team sections (PRODUCTION_LOGIC.md "V30", item 6)', () => {
  it('are absent when the manager preference is off', () => {
    const { text } = render({ profile: profile({ team_summary_mode: 'off' }) });

    expect(text).not.toContain('Team wins and changes');
    expect(text).not.toContain('Manager decisions and support');
  });

  it('appear when the manager preference is on', () => {
    const { text } = render({
      profile: profile({ team_summary_mode: 'leadership' }),
      teamTasks: [
        task({ title: 'Team item', status: 'completed', completed_at: '2026-08-04T02:00:00.000Z' }),
      ],
      teamBarriers: 2,
      teamChanges: 5,
    });

    expect(text).toContain('Team wins and changes');
    expect(text).toContain('Team exceptions');
    expect(text).toContain('2 open barriers and 5 recorded team changes.');
  });

  it('keeps the team section separate from the personal one (section 31B.4)', () => {
    const { text } = render({ profile: profile({ team_summary_mode: 'leadership' }) });

    expect(text.indexOf('Wins from last week')).toBeLessThan(text.indexOf('Team wins and changes'));
  });
});

describe('meaningful Goal email inclusion (v33)', () => {
  it('includes employee Goals only when a progress or exception signal is meaningful', () => {
    const { text } = render({
      goals: [
        goal({ title: 'Progressed Goal' }),
        goal({
          title: 'Quiet Goal',
          last_meaningful_update_at: '2026-07-01T02:00:00.000Z',
        }),
      ],
    });

    expect(text).toContain('Goal progress and check-ins');
    expect(text).toContain('Progressed Goal — 20% overall');
    expect(text).not.toContain('Quiet Goal');
  });

  it('surfaces support and pending alignment in the manager leadership section', () => {
    const { text } = render({
      profile: profile({ team_summary_mode: 'leadership' }),
      teamGoals: [
        goal({
          owner_name: 'Amer Hakim',
          open_support_count: 1,
          pending_version_id: '00000000-0000-4000-a000-000000000099',
          last_meaningful_update_at: '2026-07-01T02:00:00.000Z',
        }),
      ],
    });

    expect(text).toContain('Team Goal coaching');
    expect(text).toContain('Amer Hakim: Safety Digitalisation');
    expect(text).toContain('support requested');
    expect(text).toContain('changes awaiting agreement');
  });
});

describe('recommended starting point', () => {
  it('ranks mandatory work above everything else', () => {
    const { text } = render({
      tasks: [
        task({ title: 'Ordinary active work' }),
        task({ title: 'Overdue work', is_overdue: true }),
        task({ title: 'Mandatory isolation', is_mandatory: true }),
      ],
    });

    const section = text.slice(text.indexOf('Recommended starting point'));
    expect(section).toContain('Mandatory isolation');
  });

  it('ranks overdue above stale, and stale above ordinary active work', () => {
    const overdueFirst = render({
      tasks: [
        task({ title: 'Stale work', is_stale: true }),
        task({ title: 'Overdue work', is_overdue: true }),
      ],
    }).text;
    expect(overdueFirst.slice(overdueFirst.indexOf('Recommended starting point'))).toContain(
      'Overdue work',
    );

    const staleFirst = render({
      tasks: [task({ title: 'Ordinary work' }), task({ title: 'Stale work', is_stale: true })],
    }).text;
    expect(staleFirst.slice(staleFirst.indexOf('Recommended starting point'))).toContain(
      'Stale work',
    );
  });

  it('explains how long stale work has gone without an update', () => {
    const { text } = render({
      tasks: [
        task({
          title: 'Neglected work',
          is_stale: true,
          status: 'active',
          last_meaningful_update_at: '2026-07-27T02:00:00.000Z',
        }),
      ],
    });

    expect(text).toContain('no meaningful update for 10 days');
  });

  it('says so plainly when nothing needs recommending', () => {
    expect(render().text).toContain('No recommendation is needed right now.');
  });

  it('never recommends completed or cancelled work', () => {
    const { text } = render({
      tasks: [
        task({ title: 'Finished', status: 'completed', completed_at: '2026-08-04T02:00:00.000Z' }),
        task({ title: 'Abandoned', status: 'cancelled' }),
      ],
    });

    expect(text.slice(text.indexOf('Recommended starting point'))).toContain(
      'No recommendation is needed right now.',
    );
  });
});

describe('empty states', () => {
  it('explains each empty section rather than showing a blank list', () => {
    const { text } = render({ mode: 'standard' });

    expect(text).toContain('No completed work was recorded last week.');
    expect(text).toContain('No overdue or stale active work needs attention.');
    expect(text).toContain('No dated commitments are due this week.');
    expect(text).toContain('No routine occurrences are due this week.');
  });
});

describe('message envelope', () => {
  it('names the recipient in the subject', () => {
    expect(render().subject).toBe('TAMCO Focus weekly summary — Izzah Nurul');
  });

  it('links to My Day in both parts (section 31B.3)', () => {
    const { html, text } = render();

    expect(text).toContain('Open My Day: http://localhost:3000/today');
    expect(html).toContain('href="http://localhost:3000/today"');
  });
});
