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

describe('v210 the weekly letter carries its department summary', () => {
  const base = {
    reportName: 'Operations leadership',
    capturedAt: '2026-09-21T01:00:00Z',
    timeZone: 'Asia/Kuala_Lumpur',
    reportUrl: 'https://focus.example/respond/access?for=report#secret',
    expiresMinutes: 10080,
    counts: { open: 8, overdue: 2, awaiting: 1, closed: 3 },
  };

  it('reads as a summary without opening anything', () => {
    const email = renderWeeklyReportEmail({
      ...base,
      departments: [
        { department: 'Operations', open: 5, overdue: 2, awaiting: 1, closed: 1 },
        { department: 'Administration', open: 3, overdue: 0, awaiting: 0, closed: 2 },
      ],
      departmentTotal: 2,
      overdue: [
        {
          reference: 'ESH-0007',
          title: 'Replace the guard',
          owner: 'owner@example.com',
          dueLabel: 'Due 11 Sept 2026',
        },
      ],
      closedFrom: '2026-09-13T16:00:00Z',
      closedTo: '2026-09-20T16:00:00Z',
    });
    expect(email.text).toContain('Operations: 5 open, 2 overdue, 1 awaiting review, 1 closed');
    expect(email.text).toContain('ESH-0007 · Replace the guard · owner@example.com · Due 11 Sept');
    expect(email.text).toContain('Closed: 14 Sept 2026 to 21 Sept 2026');
    // Everything shown, so nothing claims to be hiding departments.
    expect(email.text).not.toContain('Showing');
    expect(email.html).toContain('Administration');
  });

  it('says how many departments it left out rather than trailing off', () => {
    const email = renderWeeklyReportEmail({
      ...base,
      departments: [{ department: 'Operations', open: 5, overdue: 2, awaiting: 1, closed: 1 }],
      departmentTotal: 9,
    });
    expect(email.text).toContain('Showing 1 of 9 departments.');
    expect(email.html).toContain('Showing 1 of 9 departments.');
  });

  it('is the v204 letter again when a run carries no summary', () => {
    const email = renderWeeklyReportEmail(base);
    expect(email.text).not.toContain('By department:');
    expect(email.text).not.toContain('Showing');
    expect(email.html).not.toContain('Overdue and waiting on their owner');
  });
});
