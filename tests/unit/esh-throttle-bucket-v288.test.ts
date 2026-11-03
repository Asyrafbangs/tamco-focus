import { describe, expect, it } from 'vitest';

import { throttleBucket } from '@/domain/esh-throttle';

/**
 * v288 — the rate-limit bucket, which must not become a log of who reported
 * what.
 *
 * The counter table holds a bucket and a count and nothing else: no report
 * refers to a bucket and no bucket refers to a report. These assertions hold
 * the properties that make that worth anything — the address is not recoverable
 * from the bucket, and the bucket changes daily — plus the one failure mode
 * that would be silently harmful: an absent address becoming a single shared
 * bucket for the whole site.
 */
const DAY = new Date('2026-11-03T08:00:00Z');

describe('v288 the throttle bucket', () => {
  it('is the same for the same caller on the same day', () => {
    expect(throttleBucket('203.0.113.7', DAY)).toBe(throttleBucket('203.0.113.7', DAY));
  });

  it('differs between callers', () => {
    expect(throttleBucket('203.0.113.7', DAY)).not.toBe(throttleBucket('203.0.113.8', DAY));
  });

  it('changes the next day, so yesterday cannot be counted against anybody', () => {
    expect(throttleBucket('203.0.113.7', DAY)).not.toBe(
      throttleBucket('203.0.113.7', new Date('2026-11-04T08:00:00Z')),
    );
  });

  it('does not carry the address it was made from', () => {
    const bucket = throttleBucket('203.0.113.7', DAY)!;
    expect(bucket).not.toContain('203.0.113.7');
    expect(bucket).toMatch(/^[0-9a-f]{48}$/);
  });

  // `x-forwarded-for` is a list; the caller is the first entry.
  it('takes the first address of a forwarded chain', () => {
    expect(throttleBucket('203.0.113.7, 10.0.0.1, 10.0.0.2', DAY)).toBe(
      throttleBucket('203.0.113.7', DAY),
    );
  });

  /*
   * The failure mode worth a test of its own. Returning a constant for an
   * absent header would put every anonymous reporter behind one counter and
   * rate-limit the whole site down to six reports in ten minutes.
   */
  it('has no bucket at all when there is no address', () => {
    expect(throttleBucket(null, DAY)).toBeNull();
    expect(throttleBucket('', DAY)).toBeNull();
    expect(throttleBucket('   ', DAY)).toBeNull();
  });
});
