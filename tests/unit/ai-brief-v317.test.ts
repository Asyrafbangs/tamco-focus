import { describe, expect, it } from 'vitest';

import {
  aiBriefFilename,
  buildAiBrief,
  redactIdentifiers,
  type AiBriefSnapshot,
  type BriefTask,
} from '@/domain/ai-brief';

/**
 * v317 — the AI brief, and the five things it must never get wrong.
 *
 * The owner analyses their team's week in an assistant of their own choosing,
 * and was doing it by reading screens and retyping. This exports the facts in
 * one press. Because the output leaves the building, what the tests pin is
 * mostly what it must REFUSE to carry: no invented hours, no restricted
 * finding, no identifier out of free text, and no gap that is not stated.
 */

const task = (over: Partial<BriefTask> = {}): BriefTask => ({
  id: 'f0c05300-0000-4000-a000-000000000008',
  title: 'Replace guarding on press 2 and re-commission',
  description: 'Fixed guarding is damaged. Replace it and re-commission before production.',
  owner: 'Nagarajan Munusamy',
  status: 'active',
  workClass: 'operational',
  urgency: 'high',
  mandatory: true,
  dueAt: '2026-11-11',
  isOverdue: false,
  progressPercent: 20,
  checklistCompleted: 2,
  checklistTotal: 9,
  openBarrierCount: 1,
  delegatedOpenCount: 2,
  delegatedOverdueCount: 1,
  evidenceRule: 'file',
  reviewStatus: 'not_required',
  link: 'https://focus.example/work?task=f0c05300-0000-4000-a000-000000000008',
  actions: [
    { action: 'Design the replacement guard', state: 'ready', evidenceRule: 'not_required' },
    {
      action: 'Fabricate and install the new guard',
      state: 'waiting',
      blockedBy: 'another step on this task',
    },
  ],
  latestUpdate: {
    author: 'Nagarajan Munusamy',
    at: '2026-11-04',
    body: 'Waiting on the contractor quotation, chased on 4 November.',
  },
  ...over,
});

const snapshot = (over: Partial<AiBriefSnapshot> = {}): AiBriefSnapshot => ({
  takenAt: '2026-11-09T06:32:00.000Z',
  timezone: 'Asia/Kuala_Lumpur',
  preparedFor: 'Izzul Asyraf',
  viewerRole: 'manager view',
  teamTasks: [task()],
  myTasks: [],
  findings: [
    {
      id: 'f-2101',
      reference: 'ESH-2101',
      title: 'Interlock defeated on press 2',
      riskLevel: 'critical',
      status: 'open',
      actionState: 'in_progress',
      owner: 'fadli@tamco.local',
      dueAt: '2026-11-13',
      isOverdue: false,
      noVerifiedInterimControl: true,
    },
  ],
  coverage: [
    { source: 'Team tasks (open)', included: 1, available: 1, failure: null },
    { source: 'ESH findings (open)', included: 1, available: 1, failure: null },
  ],
  restrictedFindingsExcluded: 0,
  eshUnavailable: null,
  ...over,
});

describe('v317 completeness: nothing missing, nothing silent', () => {
  it('carries every task it was given, with its record id and link', () => {
    const brief = buildAiBrief(snapshot());
    expect(brief).toContain('Replace guarding on press 2 and re-commission');
    expect(brief).toContain('f0c05300-0000-4000-a000-000000000008');
    expect(brief).toContain('https://focus.example/work?task=');
  });

  it('carries the operational facts a decision needs', () => {
    const brief = buildAiBrief(snapshot());
    for (const fact of [
      'Owner: Nagarajan Munusamy',
      'status active',
      'urgency high',
      'mandatory',
      '2026-11-11',
      'checklist 2/9',
      'evidence to close: file',
      '1 open barrier(s)',
      '2 step(s) owed by somebody else (1 overdue)',
    ]) {
      expect(brief).toContain(fact);
    }
  });

  it('carries the checklist actions and what each one is waiting on', () => {
    const brief = buildAiBrief(snapshot());
    expect(brief).toContain('Design the replacement guard');
    expect(brief).toContain('Fabricate and install the new guard');
    expect(brief).toContain('waiting on: another step on this task');
  });

  it('quotes the employee update with its author and date', () => {
    /*
     * The whole reason the owner wanted updates in here: "waiting on the
     * contractor quotation" is the difference between somebody who is behind
     * and a job that is blocked on a third party.
     */
    const brief = buildAiBrief(snapshot());
    expect(brief).toContain('Latest update — Nagarajan Munusamy, 2026-11-04');
    expect(brief).toContain('Waiting on the contractor quotation');
  });

  it('says so when a task has no update and no checklist, rather than omitting the lines', () => {
    const bare = buildAiBrief(
      snapshot({ teamTasks: [task({ actions: [], latestUpdate: null, description: null })] }),
    );
    expect(bare).toContain('Open checklist actions: none listed');
    expect(bare).toContain('Latest update: none written');
    expect(bare).toContain('Scope as written: nothing recorded');
  });

  it('distinguishes an empty team from an unreadable one', () => {
    /*
     * The failure mode that matters most in a document somebody reasons from:
     * a register that would not load reads exactly like a team with nothing
     * wrong, and the two must never look the same.
     */
    const empty = buildAiBrief(snapshot({ teamTasks: [] }));
    expect(empty).toContain('No open team task is visible to this account');
    expect(empty).not.toContain('NOT READ');

    const failed = buildAiBrief(
      snapshot({
        teamTasks: [],
        coverage: [
          {
            source: 'Team tasks (open)',
            included: 0,
            failure: 'The team task list could not be read.',
          },
        ],
      }),
    );
    expect(failed).toContain('NOT READ');
    expect(failed).toContain('Retrieval failures');
    expect(failed).toContain('Treat each as **unknown**, never as empty');
  });

  it('states the snapshot time in the reader’s own zone, and the instant too', () => {
    /*
     * The first draft printed the UTC instant under the viewer's zone label,
     * so a brief taken at half past two in Kuala Lumpur said 06:32. Both are
     * given now: the local time somebody recognises, and the instant that
     * settles any argument about it.
     */
    const brief = buildAiBrief(snapshot());
    expect(brief).toContain('9 Nov 2026, 14:32');
    expect(brief).toContain('(Asia/Kuala_Lumpur)');
    expect(brief).toContain('2026-11-09T06:32:00.000Z UTC');
    expect(brief).toContain('Izzul Asyraf — manager view');
  });

  it('falls back to the instant rather than throwing on a zone the runtime rejects', () => {
    const brief = buildAiBrief(snapshot({ timezone: 'Mars/Olympus_Mons' }));
    expect(brief).toContain('2026-11-09T06:32:00.000Z');
  });

  it('gives each source as included against available, so a cap cannot hide', () => {
    const brief = buildAiBrief(
      snapshot({
        coverage: [{ source: 'Team tasks (open)', included: 25, available: 112, failure: null }],
      }),
    );
    expect(brief).toContain('| Team tasks (open) | 25 | 112 | complete');
  });
});

describe('v317 redaction: the product’s own confidentiality rule', () => {
  it('reports restricted findings as excluded, including from the counts', () => {
    /*
     * The finding form says a restricted finding is "kept out of leadership
     * reports and their counts". A brief a manager pastes into an assistant
     * for analysis is such a report, so the rule is the product's and not a
     * judgement of mine.
     */
    const brief = buildAiBrief(snapshot({ restrictedFindingsExcluded: 3 }));
    expect(brief).toContain('3 restricted ESH finding(s), excluded from this document');
    expect(brief).toContain('and from every count in it');
  });

  it('says plainly when there were none, rather than leaving the reader to wonder', () => {
    expect(buildAiBrief(snapshot())).toContain(
      'Restricted ESH findings. None were present in this snapshot.',
    );
  });

  it('removes identifiers from free text and counts what it removed', () => {
    const brief = buildAiBrief(
      snapshot({
        teamTasks: [
          task({
            description: 'Call the contractor on 012-345 6789 or fitter@vendor.example to arrange.',
            latestUpdate: {
              author: 'Amer',
              at: '2026-11-05',
              body: 'Gate pass needs his IC, 880101-07-5432, before Monday.',
            },
          }),
        ],
      }),
    );
    expect(brief).toContain('[phone number removed]');
    expect(brief).toContain('[email removed]');
    expect(brief).toContain('[identity number removed]');
    expect(brief).not.toContain('880101-07-5432');
    expect(brief).not.toContain('fitter@vendor.example');
    expect(brief).toContain('3 identifier(s) matched a known pattern');
  });

  it('leaves ordinary text and reference numbers alone', () => {
    /*
     * Over-redaction is its own failure: a brief with ESH-2101 and 2/9 taken
     * out of it is useless, and a reader who sees the product mangling normal
     * words stops trusting the parts that matter.
     */
    const { text, removed } = redactIdentifiers(
      'ESH-2101 is 2/9 done, due 2026-11-11, press 2, bay 3, 20% reported.',
    );
    expect(removed).toBe(0);
    expect(text).toContain('ESH-2101');
    expect(text).toContain('2026-11-11');
  });

  it('is honest that patterns are not a guarantee', () => {
    expect(buildAiBrief(snapshot())).toContain('free text can carry things no pattern catches');
  });

  it('names what it never includes at all', () => {
    const brief = buildAiBrief(snapshot());
    expect(brief).toContain('Attachments, photographs and their contents.');
    expect(brief).toContain('Medical, personal or disciplinary detail');
  });
});

describe('v317 it invents nothing', () => {
  it('states that the product records no hours, and gives none', () => {
    const brief = buildAiBrief(snapshot());
    expect(brief).toContain('**There are no hours in this product.**');
    /* No figure anywhere may read as an effort or duration estimate. */
    expect(brief).not.toMatch(/\d+(\.\d+)?\s*(?:-|–)\s*\d+(\.\d+)?\s*h\b/);
    expect(brief).not.toMatch(/\b\d+\s*(?:hours?|hrs?|man-days?)\b/i);
  });

  it('warns that a short list is not spare capacity', () => {
    expect(buildAiBrief(snapshot())).toContain('not evidence of spare capacity');
  });

  it('calls a reported percentage what it is', () => {
    expect(buildAiBrief(snapshot())).toContain('20% reported by the owner');
  });

  it('proposes no dates of its own', () => {
    expect(buildAiBrief(snapshot())).toContain(
      'Nothing in this document proposes a date of its own',
    );
  });
});

describe('v317 permissions', () => {
  it('says the register was not asked for when the account is not authorised', () => {
    const brief = buildAiBrief(
      snapshot({
        findings: [],
        eshUnavailable: 'this account is not authorised for the ESH register.',
      }),
    );
    expect(brief).toContain('Not included: this account is not authorised for the ESH register.');
    /* And no finding leaks through the section that was not read. */
    expect(brief).not.toContain('ESH-2101');
  });

  it('states that anything outside the viewer’s permission is simply absent', () => {
    /*
     * An export that listed what it could not show would itself disclose
     * something. It says the scope is permission-bound and does not enumerate
     * the gap.
     */
    expect(buildAiBrief(snapshot())).toContain(
      'only the people and records this account is permitted to see',
    );
  });
});

describe('v317 safety ordering survives the export', () => {
  it('flags a significant finding with no verified interim control, and says what comes first', () => {
    const brief = buildAiBrief(snapshot());
    expect(brief).toContain('**none verified**');
    expect(brief).toContain('1 significant finding(s) have no verified interim control');
    expect(brief).toContain('isolation, a lock-out, a barrier, a stand-down');
    expect(brief).toContain('comes before the corrective action');
  });

  it('does not raise the alarm when nothing is flagged', () => {
    const brief = buildAiBrief(
      snapshot({
        findings: [
          {
            id: 'f-1',
            reference: 'ESH-1',
            title: 'Housekeeping in the store',
            riskLevel: 'low',
            status: 'open',
            noVerifiedInterimControl: false,
          },
        ],
      }),
    );
    expect(brief).toContain('not flagged');
    expect(brief).not.toContain('have no verified interim control');
  });
});

describe('v317 formatting', () => {
  it('is markdown a table survives: a pipe in a title cannot break the row', () => {
    const brief = buildAiBrief(
      snapshot({
        findings: [
          {
            id: 'f-1',
            reference: 'ESH-9',
            title: 'Guard missing | interlock bypassed',
            riskLevel: 'high',
            status: 'open',
          },
        ],
      }),
    );
    expect(brief).toContain('Guard missing \\| interlock bypassed');
  });

  it('keeps a multi-line update on one line, so the list stays a list', () => {
    const brief = buildAiBrief(
      snapshot({
        teamTasks: [
          task({
            latestUpdate: { author: 'Amer', at: '2026-11-05', body: 'Line one\nLine two' },
          }),
        ],
      }),
    );
    expect(brief).toContain('Line one ⏎ Line two');
  });

  it('ends with the read-only statement, because that is the question somebody will ask', () => {
    expect(buildAiBrief(snapshot()).trimEnd()).toMatch(
      /Read-only: producing this brief changed no record, and no part of it was sent anywhere by the product\._$/,
    );
  });

  it('produces the same document twice from the same snapshot', () => {
    /* Deterministic, so two briefs a week apart can be diffed. */
    expect(buildAiBrief(snapshot())).toBe(buildAiBrief(snapshot()));
  });

  it('counts redactions per document rather than accumulating across calls', () => {
    /*
     * The count lives in a module-level counter that `buildAiBrief` resets.
     * Without the reset the second brief of a session reports the first
     * one's removals as well, which is a number nobody could explain.
     */
    const dirty = snapshot({
      teamTasks: [task({ description: 'Ring 012-345 6789 about the guard.' })],
    });
    const first = buildAiBrief(dirty);
    const second = buildAiBrief(dirty);
    expect(first).toContain('1 identifier(s) matched');
    expect(second).toContain('1 identifier(s) matched');
  });

  it('names the file by the minute it was taken, sortably', () => {
    expect(aiBriefFilename(new Date(2026, 10, 9, 14, 32))).toBe(
      'tamco-ai-brief-2026-11-09-1432.md',
    );
  });
});
