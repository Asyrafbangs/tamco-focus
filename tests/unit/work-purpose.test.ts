import { describe, expect, it } from 'vitest';

import {
  toWorkPurpose,
  WORK_PURPOSE_LABELS,
  WORK_PURPOSE_MEANINGS,
  WORK_PURPOSE_OPTIONS,
  WORK_PURPOSE_SHORT_LABELS,
  WORK_PURPOSE_VALUES,
} from '@/domain/purpose';

/**
 * v145 §11 — the vocabulary itself.
 *
 * Tested because the wording is the feature. §11 rules out two specific
 * alternatives by name, and both are the kind of thing a later edit reaches
 * for: "Firefighting" reads more naturally than "Reactive work" until you
 * remember that at TAMCO firefighting is also a job, and Q1/Q2 is shorter than
 * either until you remember nobody outside the room knows the grid.
 */

describe('the three purposes', () => {
  it('is exactly the approved list, in the approved order', () => {
    expect(WORK_PURPOSE_VALUES).toEqual([
      'reactive',
      'planned_operations',
      'improvement_development',
    ]);
  });

  it('uses the approved words and none of the rejected ones', () => {
    expect(WORK_PURPOSE_LABELS.reactive).toBe('Reactive work');
    expect(WORK_PURPOSE_LABELS.planned_operations).toBe('Planned operations');
    expect(WORK_PURPOSE_LABELS.improvement_development).toBe('Improvement & development');

    const everything = [
      ...Object.values(WORK_PURPOSE_LABELS),
      ...Object.values(WORK_PURPOSE_SHORT_LABELS),
      ...Object.values(WORK_PURPOSE_MEANINGS),
    ].join(' ');

    // §11 names both of these as wrong, and for different reasons.
    expect(everything).not.toMatch(/firefighting/i);
    expect(everything).not.toMatch(/\bQ[1-4]\b/);
  });

  it('gives every purpose a meaning, because the labels alone do not settle it', () => {
    for (const value of WORK_PURPOSE_VALUES) {
      expect(WORK_PURPOSE_MEANINGS[value].length).toBeGreaterThan(20);
      expect(WORK_PURPOSE_SHORT_LABELS[value].length).toBeGreaterThan(0);
    }
    expect(WORK_PURPOSE_OPTIONS.map((option) => option.value)).toEqual([...WORK_PURPOSE_VALUES]);
  });
});

describe('reading a purpose that arrived from outside', () => {
  it('accepts the three, and nothing else', () => {
    expect(toWorkPurpose('reactive')).toBe('reactive');
    expect(toWorkPurpose('planned_operations')).toBe('planned_operations');
    expect(toWorkPurpose('improvement_development')).toBe('improvement_development');
  });

  it('reads anything else as not recorded rather than guessing', () => {
    // Null is the honest answer for old work, a typo, and a value from a
    // future release this build does not know about.
    expect(toWorkPurpose(null)).toBeNull();
    expect(toWorkPurpose(undefined)).toBeNull();
    expect(toWorkPurpose('')).toBeNull();
    expect(toWorkPurpose('firefighting')).toBeNull();
    expect(toWorkPurpose('operational_action')).toBeNull();
    expect(toWorkPurpose(3)).toBeNull();
  });
});
