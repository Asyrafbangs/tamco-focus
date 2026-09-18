import { describe, expect, it } from 'vitest';

import { drawerOpenedBy, drawerTitleFrom } from '@/domain/drawer-links';

/**
 * v195 — which presses may start a drawer before its content has arrived.
 *
 * Reported 18 September 2026: opening a task was "loading slow and taking
 * time, not as smooth". The placeholder that now slides in at once must appear
 * only for a press that really will put a drawer on this page, or it would
 * sit on screen waiting for something that never comes.
 */

const origin = 'https://focus.example';
const at = (path: string) => new URL(path, origin);

describe('v195 — drawerOpenedBy', () => {
  it('names the task a row on My Work opens', () => {
    expect(drawerOpenedBy(at('/work?tab=active&task=t-1'), at('/work?tab=active'))).toEqual({
      kind: 'task',
      id: 't-1',
    });
  });

  it('names a proposal on My Work and a goal on Goals', () => {
    expect(drawerOpenedBy(at('/work?proposal=p-1'), at('/work'))).toEqual({
      kind: 'proposal',
      id: 'p-1',
    });
    expect(drawerOpenedBy(at('/goals?goal=g-1'), at('/goals'))).toEqual({
      kind: 'goal',
      id: 'g-1',
    });
  });

  it('opens a different task from inside the one already open', () => {
    expect(drawerOpenedBy(at('/work?task=t-2'), at('/work?task=t-1&tab=active'))).toEqual({
      kind: 'task',
      id: 't-2',
    });
  });

  it('ignores a link that stays on the drawer already open', () => {
    // A section of the same task, or pressing the row of a drawer that is
    // closing: the same drawer stays, and nothing new would replace a stand-in.
    expect(drawerOpenedBy(at('/work?task=t-1&section=updates'), at('/work?task=t-1'))).toBeNull();
  });

  it('ignores a link to another page, which swaps the page underneath first', () => {
    expect(drawerOpenedBy(at('/work?task=t-1&from=today'), at('/today'))).toBeNull();
    expect(drawerOpenedBy(at('/work?task=t-1'), at('/goals'))).toBeNull();
  });

  it('ignores links that open no drawer, and other origins', () => {
    expect(drawerOpenedBy(at('/work?tab=shared'), at('/work'))).toBeNull();
    expect(drawerOpenedBy(at('/plan?task=t-1'), at('/plan'))).toBeNull();
    expect(
      drawerOpenedBy(new URL('https://elsewhere.example/work?task=t-1'), at('/work')),
    ).toBeNull();
  });
});

describe('v195 — drawerTitleFrom', () => {
  it('reads the title out of a row label', () => {
    expect(drawerTitleFrom('Open Replace conveyor belt', 'ignored')).toBe('Replace conveyor belt');
  });

  it('falls back to the words of the link', () => {
    expect(drawerTitleFrom(null, '  Finalise\n   vendor drawing  ')).toBe(
      'Finalise vendor drawing',
    );
    expect(drawerTitleFrom('Close', 'Weekly check')).toBe('Weekly check');
  });

  it('says nothing when there is nothing to say', () => {
    expect(drawerTitleFrom(null, '   ')).toBeNull();
    expect(drawerTitleFrom('Open ', null)).toBeNull();
  });

  it('keeps a very long title to a heading', () => {
    expect(drawerTitleFrom(null, 'x'.repeat(400))).toHaveLength(160);
  });
});
