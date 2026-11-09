import { describe, expect, it } from 'vitest';

import { healthNotes, type OperationalHealth } from '@/domain/esh-health';

const RUNNING: OperationalHealth = {
  lastRunAt: '2026-09-23T01:00:00Z',
  lastRunOk: true,
  hoursSinceRun: 6,
  queued: 3,
  failing: 0,
  held: 0,
  reviewOverdue: 0,
  effectivenessDue: 0,
};

describe('v210 what is worth saying about the machinery (§27)', () => {
  it('says nothing while the work is flowing', () => {
    expect(healthNotes(RUNNING)).toEqual([]);
  });

  it('does not mistake a slow Monday for a stopped scheduler', () => {
    expect(healthNotes({ ...RUNNING, hoursSinceRun: 30 })).toEqual([]);
  });

  it('speaks up once a daily run has plainly missed one', () => {
    const notes = healthNotes({ ...RUNNING, hoursSinceRun: 48 });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain('2 days ago');
    expect(notes[0]?.exception).toBe(true);
  });

  it('is plainest of all when the scheduler has never reported at all', () => {
    const notes = healthNotes({
      ...RUNNING,
      lastRunAt: null,
      lastRunOk: null,
      hoursSinceRun: null,
    });
    expect(notes[0]?.text).toContain('never reported in');
    expect(notes[0]?.text).toContain('are not going out');
  });

  it('reports a run that ran and failed, which silence would hide', () => {
    const notes = healthNotes({ ...RUNNING, lastRunOk: false, hoursSinceRun: 2 });
    expect(notes[0]?.text).toBe('The scheduled run reported a failure 2 hours ago.');
  });

  it('sends bounced mail and held mail to where each is dealt with', () => {
    const notes = healthNotes({ ...RUNNING, failing: 1, held: 2 });
    expect(notes.map((note) => note.text)).toEqual([
      '1 notification bounced or gave up',
      '2 held because a contact is not cleared to receive mail',
    ]);
    expect(notes.every((note) => note.href === '/findings/register?filter=attention')).toBe(true);
  });

  it('treats a deep queue as information rather than as a fault', () => {
    expect(healthNotes({ ...RUNNING, queued: 20 })).toEqual([]);
    const notes = healthNotes({ ...RUNNING, queued: 21 });
    expect(notes[0]?.exception).toBe(false);
    expect(notes[0]?.href).toBeUndefined();
  });

  it('counts owners left waiting on ESH, and reads as English for one', () => {
    const one = healthNotes({ ...RUNNING, reviewOverdue: 1 });
    expect(one[0]?.text).toBe('1 submission has been waiting over a week for ESH');
    expect(one[0]?.href).toBe('/findings/verification');
    const several = healthNotes({ ...RUNNING, reviewOverdue: 4 });
    expect(several[0]?.text).toBe('4 submissions have been waiting over a week for ESH');
  });
});

describe('v308 effectiveness checks nobody is going to be reminded about', () => {
  /*
   * The tail of the lifecycle. A finding was closed, the fix was booked for a
   * re-check, and the date has come. No screen anywhere lists these: the only
   * thing that asks for one is `esh_run_effectiveness_due` behind the daily
   * cron. So when that run is not happening, the re-check never happens, and
   * the finding stays closed on a fix nobody confirmed held.
   */
  it('mentions them, and treats them as a problem while the run is stopped', () => {
    const notes = healthNotes({
      ...RUNNING,
      lastRunAt: null,
      hoursSinceRun: null,
      effectivenessDue: 3,
    });
    const note = notes.find((one) => one.text.includes('effectiveness check'));
    expect(note?.text).toContain('3 effectiveness checks are past the date');
    expect(note?.exception, 'nothing will mention these again while the run is stopped').toBe(true);
  });

  it('is a queue rather than a problem while the run is working', () => {
    const notes = healthNotes({ ...RUNNING, effectivenessDue: 2 });
    const note = notes.find((one) => one.text.includes('effectiveness check'));
    expect(note?.exception).toBe(false);
  });

  it('counts one in the singular', () => {
    const notes = healthNotes({ ...RUNNING, effectivenessDue: 1 });
    expect(notes.find((one) => one.text.includes('effectiveness'))?.text).toContain(
      '1 effectiveness check is past the date',
    );
  });

  it('says nothing when none has fallen due', () => {
    expect(healthNotes(RUNNING).some((one) => one.text.includes('effectiveness'))).toBe(false);
  });
});
