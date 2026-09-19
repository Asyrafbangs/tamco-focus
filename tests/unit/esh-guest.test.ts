import { describe, expect, it } from 'vitest';

import {
  accessLinkUrl,
  approvedLinkOrigin,
  conversationDay,
  dueLine,
  myActionsFilterFrom,
  recoveryFor,
  secretFromFragment,
} from '@/domain/esh-guest';
import { newAccessSecret } from '@/server/esh/dispatch';
import { emailDueLabel, renderEshEmail } from '@/server/esh/email';

/**
 * v198 — an Action Owner's email links, and what their pages say.
 *
 * The rules that matter for security (single use, scope, live assignment)
 * are in the database and tested in supabase/tests/esh_guest_access_v198;
 * these hold the parts that live in the application: the shape of the link,
 * where it may point, and what the email and My Actions say.
 */

describe('v198 — the link', () => {
  it('mints 256 random bits as 43 URL-safe characters, never the same twice', () => {
    const secrets = new Set(Array.from({ length: 200 }, () => newAccessSecret()));
    expect(secrets.size).toBe(200);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('carries the secret in the fragment, which no request sends to a server', () => {
    const secret = newAccessSecret();
    const url = new URL(accessLinkUrl('https://tamco-focus.vercel.app/', 'owner_action', secret));
    expect(url.origin + url.pathname).toBe('https://tamco-focus.vercel.app/respond/access');
    expect(url.search).toBe('?for=action');
    expect(url.hash).toBe(`#${secret}`);
    expect(secretFromFragment(url.hash)).toBe(secret);
    expect(new URL(accessLinkUrl('http://x', 'owner_inbox', secret)).search).toBe('?for=actions');
  });

  it('ignores a fragment that is not one of ours', () => {
    expect(secretFromFragment('')).toBeNull();
    expect(secretFromFragment('#short')).toBeNull();
    expect(secretFromFragment(`#${'a'.repeat(42)}!`)).toBeNull();
  });

  it('points only at an approved origin, whatever Host a request claims', () => {
    const production = { appBaseUrl: null, productionHost: 'tamco-focus.vercel.app' };
    expect(approvedLinkOrigin({ ...production, requestOrigin: 'https://evil.example' })).toBe(
      'https://tamco-focus.vercel.app',
    );
    expect(
      approvedLinkOrigin({ ...production, requestOrigin: 'https://tamco-focus.vercel.app' }),
    ).toBe('https://tamco-focus.vercel.app');
    // Locally there is no production host; the configured base is the one.
    expect(
      approvedLinkOrigin({
        requestOrigin: 'http://localhost:3200',
        appBaseUrl: 'http://localhost:3200',
        productionHost: null,
      }),
    ).toBe('http://localhost:3200');
    expect(approvedLinkOrigin({ requestOrigin: null, appBaseUrl: 'http://localhost:3000/' })).toBe(
      'http://localhost:3000',
    );
  });

  it('offers a fresh link for a link it recognises, and asks for an email otherwise', () => {
    expect(recoveryFor('expired')).toBe('send_fresh');
    expect(recoveryFor('used')).toBe('send_fresh');
    expect(recoveryFor('invalid')).toBe('ask_email');
  });
});

describe('v198 — the owner email', () => {
  const base = {
    reference: 'F-026',
    actionTitle: 'Clear the obstructed walkway',
    location: 'BR2 Warehouse',
    dueLabel: 'Due 18 Sept 2026',
    eshContactName: 'Izzul Asyraf',
    eshContactEmail: 'izzul@tamco.local',
    expiresMinutes: 1440,
  };

  it('has both links, each its own, and says no account is needed', () => {
    const email = renderEshEmail({
      ...base,
      eventType: 'owner_assignment',
      actionUrl: 'https://x/respond/access?for=action#AAA',
      inboxUrl: 'https://x/respond/access?for=actions#BBB',
    });
    expect(email.subject).toBe('Action assigned: F-026 · Clear the obstructed walkway');
    expect(email.html).toContain('View finding &amp; respond');
    expect(email.html).toContain('View All My Actions');
    expect(email.html).toContain('href="https://x/respond/access?for=action#AAA"');
    expect(email.html).toContain('href="https://x/respond/access?for=actions#BBB"');
    expect(email.text).toContain('View finding & respond: https://x/respond/access?for=action#AAA');
    expect(email.text).toContain('View All My Actions: https://x/respond/access?for=actions#BBB');
    expect(email.text).toContain('No account creation or password is needed.');
    expect(email.text).toContain('ESH verifies the correction before the finding is closed.');
    expect(email.text).toContain('Email replies are not added to the conversation.');
    expect(email.text).not.toMatch(/set password|create account|log ?in/i);
  });

  it('escapes what people typed', () => {
    const email = renderEshEmail({
      ...base,
      actionTitle: '<img src=x onerror=alert(1)> & "guard"',
      eventType: 'owner_assignment',
      actionUrl: 'https://x/a',
      inboxUrl: null,
    });
    expect(email.html).not.toContain('<img');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;guard&quot;');
  });

  it('keeps a subject on one line', () => {
    const email = renderEshEmail({
      ...base,
      actionTitle: 'Line one\r\nBcc: someone@example.com',
      eventType: 'esh_reply',
      actionUrl: 'https://x/a',
      inboxUrl: null,
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.subject.startsWith('ESH replied: F-026')).toBe(true);
  });

  it('says how long a requested link lasts', () => {
    const email = renderEshEmail({
      ...base,
      eventType: 'access_link',
      reference: null,
      actionTitle: null,
      dueLabel: null,
      actionUrl: null,
      inboxUrl: 'https://x/i',
      expiresMinutes: 30,
    });
    expect(email.subject).toBe('Your TAMCO ESH link');
    expect(email.text).toContain('Open my actions: https://x/i');
    expect(email.text).toContain('for 30 minutes');
  });

  it('gives a date-only due date as the day, and a timed one with its time', () => {
    const zone = 'Asia/Kuala_Lumpur';
    expect(emailDueLabel('2026-09-18T09:00:00Z', true, zone)).toBe('Due 18 Sept 2026');
    expect(emailDueLabel('2026-09-18T02:30:00Z', false, zone)).toBe('Due 18 Sept 2026, 10:30');
    expect(emailDueLabel(null, true, zone)).toBeNull();
  });
});

describe('v198 — My Actions and the conversation', () => {
  const zone = 'Asia/Kuala_Lumpur';
  const now = new Date('2026-09-20T02:00:00Z'); // 10:00 on the 20th in Kuala Lumpur

  it('defaults to Needs my action', () => {
    expect(myActionsFilterFrom('review')).toBe('review');
    expect(myActionsFilterFrom('anything')).toBe('needs');
    expect(myActionsFilterFrom(undefined)).toBe('needs');
  });

  it('gives late work an explicit age and the rest a date', () => {
    expect(
      dueLine(
        { dueAt: '2026-09-18T09:00:00Z', dueIsDateOnly: true, state: 'in_progress' },
        now,
        zone,
      ),
    ).toEqual({ text: 'Overdue 2 days', overdue: true });
    expect(
      dueLine({ dueAt: '2026-09-25T09:00:00Z', dueIsDateOnly: true, state: 'assigned' }, now, zone),
    ).toEqual({ text: 'Due 25 Sept', overdue: false });
    expect(
      dueLine({ dueAt: '2026-09-25T06:00:00Z', dueIsDateOnly: false, state: 'assigned' }, now, zone)
        .text,
    ).toBe('Due 25 Sept 14:00');
  });

  it('never calls work awaiting ESH review overdue for the owner', () => {
    expect(
      dueLine(
        { dueAt: '2026-09-18T09:00:00Z', dueIsDateOnly: true, state: 'awaiting_verification' },
        now,
        zone,
      ),
    ).toEqual({ text: 'Submitted — ESH is reviewing', overdue: false });
  });

  it('heads each day of the conversation in the reader’s zone', () => {
    expect(conversationDay('2026-09-20T01:00:00Z', now, zone)).toBe('Today');
    expect(conversationDay('2026-09-19T01:00:00Z', now, zone)).toBe('Yesterday');
    expect(conversationDay('2026-09-10T01:00:00Z', now, zone)).toBe('10 Sept 2026');
  });
});
