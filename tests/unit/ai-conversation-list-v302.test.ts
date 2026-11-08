import { describe, expect, it } from 'vitest';

import { titleFrom, withConversation, type ConversationRow } from '@/domain/ai';

/**
 * v302 — the sidebar said "Nothing yet" beside the answer it had just shown.
 *
 * Reported from a live screen, with a conversation open on the right and the
 * panel on the left insisting there were none. Nothing was lost: the thread
 * was stored, and a reload showed it. But the one place that says "your work
 * with this assistant is kept" was saying the opposite, on the very first
 * question somebody asks — which is the moment they decide whether the
 * feature is real.
 *
 * The cause is an ordering nobody can see in the code: the sidebar is
 * rendered from a server read taken while the page was built, and the
 * conversation is created by the streaming route afterwards. The server was
 * never wrong; it was simply asked before there was anything to say.
 *
 * These tests cover the rules the overlay has to obey. The wiring itself —
 * that the component renders the merged list — is not testable here: this
 * repository has no DOM environment for unit tests, and the assistant cannot
 * run in CI without a key. It was verified on the live screen that reported
 * it.
 */

const row = (id: string, title: string, updatedAt: string): ConversationRow => ({
  id,
  title,
  updatedAt,
});

describe('v302 the conversation list after a thread is written to', () => {
  it('shows a conversation created after the page was rendered', () => {
    /* The reported bug, reduced: the server had nothing, the thread exists. */
    const list = withConversation([], {
      id: 'c1',
      title: titleFrom('how is my team doing last week'),
      updatedAt: '2026-11-08T06:00:00.000Z',
    });

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'c1', title: 'how is my team doing last week' });
  });

  it('moves an existing conversation to the top instead of adding it twice', () => {
    /*
     * The second question of a thread sends the same id. A list that appended
     * would grow one row per question, all with the same destination.
     */
    const existing = [
      row('c1', 'how is my team doing last week', '2026-11-08T06:00:00.000Z'),
      row('c2', 'what should I prioritise today', '2026-11-08T05:00:00.000Z'),
    ];

    const list = withConversation(existing, {
      id: 'c2',
      title: 'and what about the overdue ones',
      updatedAt: '2026-11-08T07:00:00.000Z',
    });

    expect(list.map((one) => one.id)).toEqual(['c2', 'c1']);
    expect(list).toHaveLength(2);
  });

  it('keeps the title a conversation already has', () => {
    /*
     * A title is made from the question that OPENED the conversation. Letting
     * each turn rewrite it would retitle the list under the reader, and the
     * thread they were looking for would stop being the one they remember.
     */
    const list = withConversation(
      [row('c2', 'what should I prioritise today', '2026-11-08T05:00:00.000Z')],
      row('c2', 'and what about the overdue ones', '2026-11-08T07:00:00.000Z'),
    );

    expect(list[0]).toMatchObject({
      id: 'c2',
      title: 'what should I prioritise today',
      updatedAt: '2026-11-08T07:00:00.000Z',
    });
  });

  it('does not change the list it was given', () => {
    /*
     * The displayed list is derived from the server prop on every render, so
     * mutating the input would corrupt the server's own copy and the overlay
     * would compound on itself.
     */
    const server = [row('c1', 'first', '2026-11-08T06:00:00.000Z')];
    const frozen = JSON.stringify(server);

    withConversation(server, row('c2', 'second', '2026-11-08T07:00:00.000Z'));

    expect(JSON.stringify(server)).toBe(frozen);
  });

  it('applies several in sequence, newest first and each one once', () => {
    /* How the component folds its overlay over the server's list. */
    const server = [row('c1', 'first', '2026-11-08T06:00:00.000Z')];
    const started = [
      row('c2', 'second', '2026-11-08T07:00:00.000Z'),
      row('c2', 'second again', '2026-11-08T07:30:00.000Z'),
      row('c3', 'third', '2026-11-08T08:00:00.000Z'),
    ];

    const list = started.reduce<ConversationRow[]>(
      (current, one) => withConversation(current, one),
      server,
    );

    expect(list.map((one) => one.id)).toEqual(['c3', 'c2', 'c1']);
    expect(list.find((one) => one.id === 'c2')?.title).toBe('second');
  });
});
