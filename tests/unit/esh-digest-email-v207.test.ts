import { describe, expect, it } from 'vitest';

import { renderEshDigestEmail, type DigestItem } from '@/server/esh/email';

/**
 * v207 — the letter that covers several actions.
 *
 * Consolidation is packaging, so the test is about what the packaging still
 * says: which actions exactly, with their own dates and their own links, and
 * never "and others".
 */

function item(partial: Partial<DigestItem>): DigestItem {
  return { reference: 'F-001', title: 'A guard', dueLabel: 'Due 10 Dec 2026', ...partial };
}

describe('an owner digest', () => {
  const rendered = renderEshDigestEmail({
    eventType: 'owner_digest',
    items: [
      item({ reference: 'F-001', title: 'Refit the guard' }),
      item({ reference: 'F-002', title: 'Restock the spill kit', dueLabel: 'Overdue 4 days' }),
    ],
    inboxUrl: 'https://focus.example/respond/access?for=actions#secret',
    expiresMinutes: 1440,
    eshContactName: 'Izzul',
    eshContactEmail: 'izzul@tamco.com.my',
  });

  it('counts what it carries in the subject', () => {
    expect(rendered.subject).toBe('2 actions need your attention');
  });

  it('names every action rather than summarising them away', () => {
    expect(rendered.text).toContain('F-001 · Refit the guard');
    expect(rendered.text).toContain('F-002 · Restock the spill kit');
    expect(rendered.text).toContain('Overdue 4 days');
    expect(rendered.text).not.toMatch(/and \d+ others/);
  });

  it('gives one link to the owner’s own list, and no action links', () => {
    expect(rendered.text).toContain(
      'View All My Actions: https://focus.example/respond/access?for=actions#secret',
    );
    expect(rendered.text.match(/https:\/\/focus\.example/g)).toHaveLength(1);
  });

  it('still says who to talk to and that replies are not read', () => {
    expect(rendered.text).toContain('izzul@tamco.com.my');
    expect(rendered.text).toMatch(/replies are not read/i);
  });
});

describe('an escalation digest', () => {
  const rendered = renderEshDigestEmail({
    eventType: 'escalation_digest',
    items: [
      item({
        reference: 'F-010',
        title: 'Clear the walkway',
        escalationLevel: 2,
        actionUrl: 'https://focus.example/respond/access?for=action#one',
      }),
      item({
        reference: 'F-011',
        title: 'Service the extinguisher',
        escalationLevel: 1,
        actionUrl: 'https://focus.example/respond/access?for=action#two',
      }),
    ],
    inboxUrl: null,
    expiresMinutes: 1440,
  });

  it('leads with the highest level reached', () => {
    expect(rendered.subject).toBe('Escalation level 2: 2 overdue actions');
  });

  it('gives each action its own link and never an inbox one', () => {
    expect(rendered.text).toContain('https://focus.example/respond/access?for=action#one');
    expect(rendered.text).toContain('https://focus.example/respond/access?for=action#two');
    expect(rendered.text).not.toContain('View All My Actions');
  });

  it('says the work stays with its owner', () => {
    expect(rendered.text).toMatch(/stays with its owner/i);
    expect(rendered.text).toMatch(/not being asked to do the work/i);
  });
});

describe('a released backlog', () => {
  it('does not pretend the dates are new', () => {
    const rendered = renderEshDigestEmail({
      eventType: 'import_assignment',
      items: [item({ dueLabel: 'Overdue 174 days' })],
      inboxUrl: 'https://focus.example/respond/access?for=actions#secret',
      expiresMinutes: 1440,
    });
    expect(rendered.subject).toBe('1 action assigned to you');
    expect(rendered.text).toMatch(/already agreed/i);
    expect(rendered.text).toContain('Overdue 174 days');
  });
});
