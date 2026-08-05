import { describe, expect, it } from 'vitest';

import {
  ACTIVATION_REASON_OPTIONS,
  canOfferActivate,
  canOfferMoveOut,
  consumesFocusTarget,
  DEFAULT_FOCUS_TARGETS,
  focusBadge,
  overTargetDurationMs,
  overTargetQuestion,
  validateActivationReason,
  wouldExceedTarget,
} from '@/domain/focus';
import type { FocusSummary } from '@/domain/types';

function summary(overrides: Partial<FocusSummary> = {}): FocusSummary {
  return {
    userId: '00000000-0000-4000-b000-000000000001',
    bucket: 'operational',
    activeCount: 3,
    recommendedTarget: 5,
    isOverTarget: false,
    overTargetSince: null,
    ...overrides,
  };
}

describe('approved defaults (section 7.1)', () => {
  it('is 1 / 5 / 1', () => {
    expect(DEFAULT_FOCUS_TARGETS).toEqual({ major: 1, operational: 5, self_development: 1 });
  });
});

describe('soft targets never block activation (section 7.2)', () => {
  it('offers Activate for Available Work regardless of the count', () => {
    expect(canOfferActivate('backlog')).toBe(true);
  });

  it('offers Activate for paused work', () => {
    expect(canOfferActivate('paused')).toBe(true);
  });

  it('does not offer Activate for work that is already Active', () => {
    expect(canOfferActivate('active')).toBe(false);
  });

  it('offers Move out only for Active work', () => {
    expect(canOfferMoveOut('active')).toBe(true);
    expect(canOfferMoveOut('backlog')).toBe(false);
  });
});

describe('focus badge (section 7.4)', () => {
  it('renders count over target with no written label when within target', () => {
    const badge = focusBadge(summary({ activeCount: 3, recommendedTarget: 5 }));

    expect(badge.text).toBe('3 / 5');
    expect(badge.tone).toBe('neutral');
    expect(badge.writtenLabel).toBeNull();
  });

  it('renders 6 / 5 in red with the written Over focus target label', () => {
    const badge = focusBadge(summary({ activeCount: 6, recommendedTarget: 5, isOverTarget: true }));

    expect(badge.text).toBe('6 / 5');
    expect(badge.tone).toBe('red');
    expect(badge.writtenLabel).toBe('Over focus target');
  });

  it('carries the state in the accessible label, not only in colour', () => {
    const badge = focusBadge(summary({ activeCount: 6, recommendedTarget: 5, isOverTarget: true }));

    expect(badge.accessibleLabel).toContain('Over focus target');
    expect(badge.accessibleLabel).toContain('Operational Actions');
  });
});

describe('predicting the over-target question', () => {
  it('knows when the next activation crosses the target', () => {
    expect(wouldExceedTarget({ activeCount: 5, recommendedTarget: 5 })).toBe(true);
    expect(wouldExceedTarget({ activeCount: 4, recommendedTarget: 5 })).toBe(false);
  });

  it('asks exactly one question, stating both counts and the target', () => {
    const question = overTargetQuestion('operational', 5, 5);

    expect(question).toContain('You already have 5 active operational actions');
    expect(question).toContain('will make 6 active against a target of 5');
    expect(question).toContain('Why is this additional focus needed now?');
    // One question, not several.
    expect(question.split('?').filter((part) => part.trim().length > 0)).toHaveLength(1);
  });
});

describe('over-target reason validation (section 7.4)', () => {
  it('offers exactly the six approved reasons, in order', () => {
    expect(ACTIVATION_REASON_OPTIONS.map((option) => option.value)).toEqual([
      'urgent_deadline',
      'workload_peak',
      'cannot_move_out',
      'external_request',
      'dependency',
      'other',
    ]);
  });

  it('requires a reason to be chosen', () => {
    const result = validateActivationReason(null, null);

    expect(result.valid).toBe(false);
    expect(result.valid === false && result.field).toBe('reasonCode');
  });

  it('requires a note only when Other is selected', () => {
    expect(validateActivationReason('urgent_deadline', null).valid).toBe(true);
    expect(validateActivationReason('dependency', '').valid).toBe(true);

    const other = validateActivationReason('other', '   ');
    expect(other.valid).toBe(false);
    expect(other.valid === false && other.field).toBe('reasonNote');
  });

  it('accepts Other once a note is supplied', () => {
    expect(validateActivationReason('other', 'Covering for a colleague on leave.').valid).toBe(
      true,
    );
  });
});

describe('over-target duration (section 7.6)', () => {
  it('reports how long the bucket has been over target', () => {
    const now = new Date('2026-08-05T00:00:00Z');
    const result = overTargetDurationMs(
      summary({ isOverTarget: true, overTargetSince: '2026-08-02T00:00:00Z' }),
      now,
    );

    expect(result).toBe(3 * 86_400_000);
  });

  it('reports nothing when the bucket is within target', () => {
    expect(overTargetDurationMs(summary(), new Date())).toBeNull();
  });
});

describe('what consumes a focus target (section 6.3)', () => {
  it('counts the three sustained buckets and nothing else', () => {
    expect(consumesFocusTarget('operational')).toBe(true);
    expect(consumesFocusTarget('major')).toBe(true);
    expect(consumesFocusTarget('self_development')).toBe(true);
    // Quick Actions, routine occurrences, and collaborative contributions all
    // carry a null bucket.
    expect(consumesFocusTarget(null)).toBe(false);
  });
});
