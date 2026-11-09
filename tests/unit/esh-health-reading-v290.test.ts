import { describe, expect, it } from 'vitest';

import { readingNotes, type OperationalHealth } from '@/domain/esh-health';
import { reportingWords } from '@/domain/esh-intake';

/**
 * v290 — an unreadable monitor is not a quiet one.
 *
 * `getOperationalHealth` returned null both when the read failed and when
 * there was nothing to report, and the panel renders nothing for null. So a
 * monitoring query that could not run made Finding Management look healthy —
 * the same defect class v282 and v283 removed from the access and finding
 * reads, left in the one place whose entire job is to say when something is
 * wrong. I relied on it myself while verifying production, and reported a
 * scheduler as working on the strength of a panel that was absent for the
 * other reason.
 */

const healthy: OperationalHealth = {
  lastRunAt: new Date().toISOString(),
  lastRunOk: true,
  hoursSinceRun: 2,
  queued: 0,
  failing: 0,
  held: 0,
  reviewOverdue: 0,
  effectivenessDue: 0,
};

describe('v290 what the health panel says', () => {
  it('says nothing when the machinery is running', () => {
    expect(readingNotes({ available: true, health: healthy })).toEqual([]);
  });

  // The case this exists for.
  it('says so when the monitor itself could not be read', () => {
    const notes = readingNotes({ available: false });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.exception).toBe(true);
    expect(notes[0]!.text).toMatch(/could not be read/i);
    // And does not leave the reader thinking the silence meant health.
    expect(notes[0]!.text).toMatch(/nothing on this page says whether/i);
  });

  it('still distinguishes a late run from one that never reported', () => {
    expect(
      readingNotes({ available: true, health: { ...healthy, hoursSinceRun: 40 } })[0]!.text,
    ).toMatch(/last reported/i);
    expect(
      readingNotes({
        available: true,
        health: { ...healthy, lastRunAt: null, hoursSinceRun: null },
      })[0]!.text,
    ).toMatch(/never reported/i);
  });

  it('still reports a run that failed', () => {
    const notes = readingNotes({
      available: true,
      health: { ...healthy, lastRunOk: false, hoursSinceRun: 3 },
    });
    expect(notes[0]!.text).toMatch(/reported a failure/i);
  });
});

describe('v290 what the Today page says about public reporting', () => {
  /*
   * The page carried "Public QR reporting is not enabled" in hard-coded text.
   * It stayed there after the channel was opened, telling the team watching
   * the queue that nothing could arrive while the form was live.
   */
  it('says open when it is open', () => {
    expect(reportingWords({ enabled: true })).toMatch(/public reporting is open/i);
  });

  it('says closed when it is closed, and why that matters', () => {
    const said = reportingWords({ enabled: false });
    expect(said).toMatch(/closed/i);
    expect(said).toMatch(/no sticker can submit/i);
  });

  // Unreadable is a third state. Reporting it as either of the other two is
  // how a screen comes to lie about the channel it is watching.
  it('says it could not be read rather than guessing', () => {
    const said = reportingWords(null);
    expect(said).toMatch(/could not be read/i);
    expect(said).not.toMatch(/\bis open\b|\bis closed\b/i);
  });
});
