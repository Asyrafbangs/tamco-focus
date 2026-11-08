import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v302 — the assistant's two reads said "you have nothing" when they failed.
 *
 * The same rule as `esh-swallowed-reads-v285`, in the module that did not get
 * it. Both reads returned `[]` on error, and `[]` already meant something
 * specific at every call site:
 *
 *   * the sidebar renders an empty list as "Nothing yet. Ask something
 *     below." - a statement about that person's history, made from a query
 *     that never answered;
 *   * the page renders an empty thread as the opening screen, which tells
 *     somebody the conversation they just clicked is empty;
 *   * the route treats an empty thread as an id that is not theirs and
 *     answers 404 "That conversation is not available" - a database error
 *     delivered as a verdict about their own conversation.
 *
 * The third had a worse near-miss behind it. Had the route not refused, a
 * failed read would have reached `historyFor` as an empty history, and the
 * assistant would have answered "and what about the overdue ones?" having
 * silently forgotten the conversation it was in - a confident answer to a
 * question it could no longer see.
 *
 * What these tests pin is the distinction, in both directions: a successful
 * read of nothing must stay `failed: false`, or the screens would start
 * announcing a fault to everybody who has not used the assistant yet.
 */

type Answer = { data: unknown; error: { code?: string; message: string } | null };

/** What PostgREST hands back when the gateway, not the query, is the problem. */
const UPSTREAM_502: Answer = {
  data: null,
  error: { code: 'PGRST000', message: 'An invalid response was received from the upstream server' },
};

const state = vi.hoisted(() => ({
  tables: new Map<string, Answer>(),
}));

vi.mock('@/lib/supabase/server', () => {
  const builderFor = (table: string) => {
    const answer = (): Answer => state.tables.get(table) ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const step of ['select', 'eq', 'neq', 'in', 'is', 'order', 'limit']) {
      builder[step] = () => builder;
    }
    builder.maybeSingle = async () => answer();
    builder.then = (resolve: (value: Answer) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(answer()).then(resolve, reject);
    return builder;
  };

  return {
    createSupabaseServerClient: async () => ({ from: (table: string) => builderFor(table) }),
  };
});

const { listConversations, loadThread } = await import('@/server/ai/conversations');

beforeEach(() => {
  state.tables.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v302 listConversations', () => {
  it('reports a failed read instead of an empty history', () => {
    state.tables.set('ai_conversations', UPSTREAM_502);
    return listConversations().then((result) => {
      expect(result.failed).toBe(true);
      expect(result.rows).toEqual([]);
    });
  });

  it('a person who has asked nothing yet is not a failure', async () => {
    /*
     * The other half, and the one that would make this change worse than the
     * defect: every new user would be told their conversations are
     * unreadable.
     */
    state.tables.set('ai_conversations', { data: [], error: null });
    const result = await listConversations();
    expect(result).toEqual({ rows: [], failed: false });
  });

  it('returns the conversations when the read works', async () => {
    state.tables.set('ai_conversations', {
      data: [
        { id: 'c1', title: 'how is my team doing last week', updated_at: '2026-11-08T06:00:00Z' },
      ],
      error: null,
    });
    const result = await listConversations();
    expect(result.failed).toBe(false);
    expect(result.rows).toEqual([
      { id: 'c1', title: 'how is my team doing last week', updatedAt: '2026-11-08T06:00:00Z' },
    ]);
  });
});

describe('v302 loadThread', () => {
  it('reports a failed read instead of an empty conversation', async () => {
    state.tables.set('ai_messages', UPSTREAM_502);
    const result = await loadThread('11111111-1111-1111-1111-111111111111');
    expect(result.failed).toBe(true);
    expect(result.messages).toEqual([]);
  });

  it('keeps empty meaning "not yours", which the route refuses on', async () => {
    /*
     * The policy filters another person's rows out, so an empty successful
     * read is how a stolen id looks. That behaviour is deliberate and must
     * survive: it is only the FAILED read that had to stop impersonating it.
     */
    state.tables.set('ai_messages', { data: [], error: null });
    const result = await loadThread('22222222-2222-2222-2222-222222222222');
    expect(result).toEqual({ messages: [], failed: false });
  });

  it('returns the turns when the read works', async () => {
    state.tables.set('ai_messages', {
      data: [
        { role: 'user', content: { content: 'how is my team doing last week' }, seq: 1 },
        {
          role: 'assistant',
          content: { content: 'Two people are carrying overdue work.' },
          seq: 2,
        },
      ],
      error: null,
    });
    const result = await loadThread('33333333-3333-3333-3333-333333333333');
    expect(result.failed).toBe(false);
    expect(result.messages.map((one) => one.content)).toEqual([
      'how is my team doing last week',
      'Two people are carrying overdue work.',
    ]);
  });
});
