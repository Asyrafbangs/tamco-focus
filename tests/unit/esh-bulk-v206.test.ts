import { describe, expect, it } from 'vitest';

import {
  BULK_OPERATIONS,
  bulkItemProblem,
  bulkProblem,
  bulkSummary,
  type BulkResult,
} from '@/domain/esh-bulk';

/**
 * v206 — what a batch says it did.
 *
 * The wording is the point of these: a partial batch that reads as a success
 * is how somebody comes to believe eleven actions are finished when nine are.
 */

function result(partial: Partial<BulkResult>): BulkResult {
  return {
    operationId: 'op',
    requested: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    items: [],
    ...partial,
  };
}

describe('what a batch says afterwards', () => {
  it('says where the update went', () => {
    expect(bulkSummary(result({ succeeded: 2 }), 'update')).toBe('Your update is on 2 actions.');
    expect(bulkSummary(result({ succeeded: 1 }), 'update')).toBe('Your update is on 1 action.');
  });

  it('never calls a partial batch a success', () => {
    expect(bulkSummary(result({ succeeded: 9, skipped: 1, failed: 1 }), 'submit')).toBe(
      '9 actions submitted for review, 1 skipped, 1 did not go through.',
    );
  });

  it('says plainly when nothing went at all', () => {
    expect(bulkSummary(result({ failed: 3 }), 'submit')).toBe(
      'Nothing went through, 3 did not go through.',
    );
  });

  it('keeps asking for more time an ask', () => {
    expect(bulkSummary(result({ succeeded: 3 }), 'extension')).toBe(
      'More time asked for on 3 actions.',
    );
  });
});

describe('what an item says about itself', () => {
  it('turns a reason into something an owner can act on', () => {
    expect(bulkItemProblem('evidence_incomplete')).toMatch(/file/i);
    expect(bulkItemProblem('not_available')).toMatch(/no longer yours/i);
    expect(bulkItemProblem(null)).toBe('Done.');
    expect(bulkItemProblem('something_new')).toMatch(/again/i);
  });

  it('explains a refusal of the whole operation', () => {
    expect(bulkProblem('nothing_selected')).toMatch(/choose/i);
    expect(bulkProblem('not_available')).toMatch(/My Actions/);
    expect(bulkProblem(undefined)).toMatch(/try again/i);
  });
});

describe('the operations offered', () => {
  it('offers no way to finish an action without ESH', () => {
    const labels = BULK_OPERATIONS.map((operation) => operation.label.toLowerCase());
    expect(labels.some((label) => /complete|done|close/.test(label))).toBe(false);
    expect(BULK_OPERATIONS.map((operation) => operation.key)).toEqual([
      'update',
      'extension',
      'submit',
    ]);
  });

  it('says of the update that it submits nothing', () => {
    const update = BULK_OPERATIONS.find((operation) => operation.key === 'update');
    expect(update?.lead).toMatch(/does not submit/i);
  });
});
