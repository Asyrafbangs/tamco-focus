import { describe, expect, it } from 'vitest';

import {
  exposureWords,
  rankExposure,
  todayStages,
  type ExposureRow,
  type TodayInput,
} from '@/domain/esh-today';

/**
 * v303 — the Today board, worked out where it can be checked.
 *
 * Two rules from the screens this replaces are load-bearing here, and both
 * have cost something before: a figure that could not be read is `null` and
 * not nought (v291), and a count is only ever a count of something counted
 * (v4101). The third is new: a queue states how long its oldest item has been
 * waiting, because a count says there is work and an age says it is stuck.
 */

const TZ = 'Asia/Kuala_Lumpur';
/** 09:00 on 9 November in Kuala Lumpur, which is +8. */
const NOW = new Date('2026-11-09T01:00:00Z');

function input(over: Partial<TodayInput> = {}): TodayInput {
  return {
    triage: { total: 4, oldest: '2026-11-04T01:00:00Z' },
    pastDue: { total: 1, oldest: '2026-10-16T09:00:00Z' },
    checking: { total: 0, oldest: null },
    openTotal: 12,
    oldestOpenDays: 94,
    timeZone: TZ,
    now: NOW,
    ...over,
  };
}

describe('v303 the strip across the top of Today', () => {
  it('counts a wait in calendar days, with the one helper that counts them', () => {
    /*
     * Received on 4 November, read on the 9th, is five days — counted from
     * local date to local date. Dividing elapsed time is what made the same
     * work read as a different age on two screens in v185, and this board
     * must not reopen that.
     */
    const triage = todayStages(input()).find((stage) => stage.key === 'triage');
    expect(triage?.dwell).toBe('Oldest waiting 5 days');
  });

  it('says a day, not days, when it has been one', () => {
    const triage = todayStages(
      input({ triage: { total: 1, oldest: '2026-11-08T01:00:00Z' } }),
    ).find((stage) => stage.key === 'triage');
    expect(triage?.dwell).toBe('Oldest waiting 1 day');
  });

  it('says today in words, because nought days is not a number anybody says', () => {
    /*
     * The arithmetic produces "Oldest waiting 0 days". On a board where an
     * age exists to say work is stuck, a nought reads as a fault rather than
     * as the good news it is, so each queue says its own version of today.
     */
    const stages = todayStages(
      input({
        triage: { total: 2, oldest: '2026-11-09T00:30:00Z' },
        pastDue: { total: 1, oldest: '2026-11-09T00:10:00Z' },
        checking: { total: 3, oldest: '2026-11-09T00:20:00Z' },
      }),
    );
    const dwell = Object.fromEntries(stages.map((stage) => [stage.key, stage.dwell]));
    expect(dwell.triage).toBe('All arrived today');
    expect(dwell.pastDue).toBe('Due earlier today');
    expect(dwell.checking).toBe('All sent in today');
  });

  it('gives an empty queue no age, because nothing is waiting in it', () => {
    const checking = todayStages(input()).find((stage) => stage.key === 'checking');
    expect(checking?.value).toBe(0);
    expect(checking?.dwell).toBeNull();
    expect(checking?.exception).toBe(false);
  });

  it('keeps a figure that could not be read as not known, never as none', () => {
    /*
     * v291 closed this on two counters: a failed dashboard read rendered as 0,
     * which is the safest-looking board in the module produced by knowing
     * nothing at all. A stage that cannot be read must not claim to be empty,
     * and must not offer a link to a list that would disagree with it.
     */
    const stages = todayStages(input({ pastDue: { total: null, oldest: null }, openTotal: null }));
    const pastDue = stages.find((stage) => stage.key === 'pastDue');
    const open = stages.find((stage) => stage.key === 'open');
    expect(pastDue?.value).toBeNull();
    expect(pastDue?.detail).toContain('could not be read');
    expect(pastDue?.detail).toContain('not a count of none');
    expect(pastDue?.exception).toBe(false);
    expect(pastDue?.href).toBeUndefined();
    expect(open?.href).toBeUndefined();
  });

  it('leaves the triage stage out entirely for somebody who may not triage', () => {
    // Not a disabled tile leading somewhere they would be refused: §43.3 says
    // a reader is not shown work they cannot see.
    const keys = todayStages(input({ triage: null })).map((stage) => stage.key);
    expect(keys).not.toContain('triage');
    expect(keys).toEqual(['pastDue', 'checking', 'open']);
  });

  it('names whose desk each stage is on', () => {
    const desks = Object.fromEntries(todayStages(input()).map((stage) => [stage.key, stage.desk]));
    expect(desks).toEqual({ triage: 'esh', pastDue: 'owner', checking: 'esh', open: 'none' });
  });

  it('derives no figure from another, and the backlog says it is a total', () => {
    /*
     * The tempting stage here is "with an owner", got by subtracting the
     * verification queue from the open findings. Nobody counts that number,
     * the two reads are not even of the same unit - findings against actions -
     * and a board that prints it has invented a measurement. The fourth tile
     * is the backlog, labelled as the backlog.
     */
    const open = todayStages(input()).find((stage) => stage.key === 'open');
    expect(open?.value).toBe(12);
    expect(open?.label).toBe('Open findings in total');
    expect(open?.dwell).toBe('Oldest open 94 days');
  });

  it('drops the backlog age when nothing has been open a whole day', () => {
    const open = todayStages(input({ oldestOpenDays: 0 })).find((stage) => stage.key === 'open');
    expect(open?.dwell).toBeNull();
  });
});

describe('v303 the band for findings nobody is protected from', () => {
  const row = (over: Partial<ExposureRow>): ExposureRow => ({
    findingId: 'f-1',
    actionId: 'a-1',
    reference: 'ESH-0001',
    title: 'A guard fence',
    riskLevel: 'high',
    departmentName: 'Fabrication',
    location: 'BR2',
    dueAt: '2026-11-01T09:00:00Z',
    isOverdue: true,
    ...over,
  });

  it('puts a critical risk above a high one that is later', () => {
    const ranked = rankExposure(
      [
        row({
          findingId: 'f-high',
          reference: 'ESH-0002',
          riskLevel: 'high',
          dueAt: '2026-09-01T09:00:00Z',
        }),
        row({ findingId: 'f-crit', reference: 'ESH-0003', riskLevel: 'critical' }),
      ],
      TZ,
      NOW,
    );
    expect(ranked.map((one) => one.reference)).toEqual(['ESH-0003', 'ESH-0002']);
  });

  it('puts the longest overdue first within a risk level', () => {
    const ranked = rankExposure(
      [
        row({ reference: 'ESH-0010', dueAt: '2026-11-05T09:00:00Z' }),
        row({ reference: 'ESH-0011', dueAt: '2026-10-10T09:00:00Z' }),
      ],
      TZ,
      NOW,
    );
    expect(ranked.map((one) => one.reference)).toEqual(['ESH-0011', 'ESH-0010']);
    expect(ranked[0]!.overdueDays).toBe(30);
  });

  it('sorts a finding with no date after one whose date has passed', () => {
    /*
     * A date that has gone by is a fact. An absent date is not a smaller
     * number, so it must not sort as one.
     */
    const ranked = rankExposure(
      [
        row({ reference: 'ESH-0020', dueAt: null, isOverdue: false }),
        row({ reference: 'ESH-0021', dueAt: '2026-11-08T09:00:00Z' }),
      ],
      TZ,
      NOW,
    );
    expect(ranked.map((one) => one.reference)).toEqual(['ESH-0021', 'ESH-0020']);
    expect(ranked[1]!.overdueDays).toBeNull();
  });

  it('links to the action when there is one, so the band lands on the work', () => {
    const [withAction, withoutAction] = rankExposure(
      [
        row({ findingId: 'f-9', actionId: 'a-9', reference: 'ESH-0030' }),
        row({
          findingId: 'f-8',
          actionId: null,
          reference: 'ESH-0031',
          isOverdue: false,
          dueAt: null,
        }),
      ],
      TZ,
      NOW,
    );
    expect(withAction!.href).toBe('/findings/f-9?action=a-9');
    expect(withoutAction!.href).toBe('/findings/f-8');
  });

  it('names the finding when there is one, and counts them when there are more', () => {
    const one = rankExposure([row({ reference: 'ESH-0142' })], TZ, NOW);
    expect(exposureWords(one)).toBe('Nothing is recorded protecting anybody from ESH-0142.');

    const several = rankExposure(
      [row({ reference: 'ESH-1' }), row({ findingId: 'f-2', reference: 'ESH-2' })],
      TZ,
      NOW,
    );
    expect(exposureWords(several)).toContain('2 significant findings');
  });

  it('says nothing at all when nobody is exposed', () => {
    expect(exposureWords([])).toBe('');
  });
});
