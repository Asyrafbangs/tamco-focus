import { describe, expect, it } from 'vitest';

import { accessLinkUrl } from '@/domain/esh-guest';
import { renderWeeklyReportEmail } from '@/server/esh/email';

describe('v204 weekly report links and email', () => {
  it('uses its own access purpose and never resembles an owner action link', () => {
    const secret = 'x'.repeat(43);
    const url = new URL(accessLinkUrl('https://focus.example/', 'report_viewer', secret));
    expect(url.pathname).toBe('/respond/access');
    expect(url.search).toBe('?for=report');
    expect(url.hash).toBe(`#${secret}`);
  });

  it('keeps the delivery concise and leaves finding detail behind access', () => {
    const email = renderWeeklyReportEmail({
      reportName: 'Operations leadership',
      capturedAt: '2026-09-21T01:00:00Z',
      timeZone: 'Asia/Kuala_Lumpur',
      reportUrl: 'https://focus.example/respond/access?for=report#secret',
      expiresMinutes: 10080,
      counts: { open: 8, overdue: 2, awaiting: 1, closed: 3 },
    });
    expect(email.subject).toBe('Weekly ESH report: Operations leadership');
    expect(email.text).toContain('8 open · 2 overdue · 1 awaiting review · 3 closed last week');
    expect(email.text).toContain('read-only report');
    expect(email.text).not.toContain('finding description');
    expect(email.html).toContain('Open weekly report');
  });
});
