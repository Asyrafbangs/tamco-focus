'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  TOOL_LABELS,
  titleFrom,
  withConversation,
  type ConversationRow,
  type Exchange as StoredExchange,
  type SourceLink,
} from '@/domain/ai';

/**
 * The conversation workspace.
 *
 * One column of exchanges and a box to type in — deliberately not an agent
 * dashboard. What it adds beyond a chat window is honesty about what is
 * happening: which step the investigation is on, which records it has
 * actually read, and links to those records under the answer so a claim can
 * be checked rather than believed.
 */

export interface Exchange extends StoredExchange {
  /** Live progress, kept only while the answer is being written. */
  steps?: string[];
  reads?: { name: string; rows: number; ok: boolean }[];
  /** A rate-limit wait or similar: said out loud rather than hidden. */
  notice?: string | null;
  failed?: string | null;
}

export type { ConversationRow };

/*
 * The labels now live in the domain, beside the scrubber that takes these
 * same names out of an answer. Two copies of this map would drift, and the
 * one that drifted would show somebody `list_team_workload`.
 */

const SUGGESTIONS = [
  'Why are my corrective actions delayed?',
  'What should I prioritise today?',
  'Challenge my plan for this week.',
];

export function AiWorkspace({
  conversations,
  initial,
  conversationId,
  enabled,
  disabledReason,
}: {
  conversations: ConversationRow[];
  initial: Exchange[];
  conversationId: string | null;
  enabled: boolean;
  disabledReason: string;
}) {
  const [exchanges, setExchanges] = useState<Exchange[]>(initial);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<string | null>(conversationId);
  /*
   * Conversations started in this browser since the page was rendered, kept
   * apart from the server's own list rather than replacing it. Seeding state
   * from the prop would freeze the sidebar at whatever the first render saw,
   * so a navigation or a refresh could never correct it again; derived this
   * way, the server stays the source of truth and these are an overlay on it
   * that `withConversation` de-duplicates by id.
   */
  const [started, setStarted] = useState<ConversationRow[]>([]);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const threads = started.reduce<ConversationRow[]>(
    (list, row) => withConversation(list, row),
    conversations,
  );

  async function ask(text: string) {
    const asked = text.trim();
    if (!asked || busy) return;
    setQuestion('');
    setBusy(true);
    const id = crypto.randomUUID();
    setExchanges((current) => [
      ...current,
      { id, question: asked, answer: '', sources: [], steps: [], reads: [] },
    ]);
    const update = (change: (one: Exchange) => Exchange) =>
      setExchanges((current) => current.map((one) => (one.id === id ? change(one) : one)));

    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: asked, conversationId: thread }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const problem = (await response.json().catch(() => null)) as { error?: string } | null;
        update((one) => ({
          ...one,
          failed: problem?.error ?? 'The assistant could not answer that.',
        }));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = JSON.parse(line.slice(6)) as Record<string, unknown>;
          if (payload.type === 'conversation') {
            const id = String(payload.id);
            setThread(id);
            /*
             * The title the server stored, computed rather than guessed:
             * `titleFrom` is the same function `startConversation` uses. A
             * thread already in the list keeps its own title, because that
             * one was made from the question that opened it.
             */
            setStarted((current) =>
              withConversation(current, {
                id,
                title: threads.find((one) => one.id === id)?.title ?? titleFrom(asked),
                updatedAt: new Date().toISOString(),
              }),
            );
          }
          if (payload.type === 'step') {
            update((one) => ({ ...one, steps: [...(one.steps ?? []), String(payload.label)] }));
          }
          if (payload.type === 'tool') {
            update((one) => ({
              ...one,
              reads: [
                ...(one.reads ?? []),
                {
                  name: String(payload.name),
                  rows: Number(payload.rows ?? 0),
                  ok: Boolean(payload.ok),
                },
              ],
            }));
          }
          if (payload.type === 'text') {
            update((one) => ({
              ...one,
              answer: one.answer + (one.answer ? '\n\n' : '') + String(payload.delta),
            }));
          }
          if (payload.type === 'notice') {
            update((one) => ({ ...one, notice: String(payload.message) }));
          }
          if (payload.type === 'sources') {
            update((one) => ({ ...one, sources: payload.sources as SourceLink[] }));
          }
          if (payload.type === 'error') {
            update((one) => ({ ...one, failed: String(payload.message) }));
          }
        }
      }
    } catch (cause) {
      if ((cause as Error)?.name !== 'AbortError') {
        update((one) => ({ ...one, failed: 'The connection dropped before the answer finished.' }));
      }
    } finally {
      setBusy(false);
      abort.current = null;
      bottom.current?.scrollIntoView({ behavior: 'smooth' });
      /*
       * And then let the server say what the list really holds - the stored
       * title, the real `updated_at` order, anything opened in another tab.
       * The overlay above is what makes the row appear at once; this is what
       * keeps it honest. Safe after the stream rather than during it, and
       * safe at all only because the list is derived from the prop: a
       * refreshed prop flows straight through.
       */
      router.refresh();
    }
  }

  return (
    <div className="ai-workspace">
      <section className="ai-threads" aria-labelledby="ai-threads-title">
        <div className="ai-threads-head">
          <h2 id="ai-threads-title">Conversations</h2>
          <Link className="btn small" href="/ai">
            New
          </Link>
        </div>
        {threads.length === 0 ? (
          <p className="form-hint">Nothing yet. Ask something below.</p>
        ) : (
          <ul>
            {threads.map((one) => (
              <li key={one.id}>
                <Link
                  href={`/ai?c=${one.id}`}
                  className="ai-thread"
                  aria-current={one.id === thread ? 'true' : undefined}
                  data-selected={one.id === thread || undefined}
                >
                  {one.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ai-conversation" aria-label="Conversation">
        {exchanges.length === 0 && (
          <div className="ai-opening">
            <h2>Ask about your work</h2>
            <p>
              I read the tasks and findings you are authorised to see, and answer from those
              records. I will tell you what I could not establish rather than guess, and I will not
              agree with you just because you said it.
            </p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="btn small"
                  disabled={!enabled || busy}
                  onClick={() => void ask(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {exchanges.map((exchange) => (
          <article key={exchange.id} className="ai-exchange">
            <p className="ai-question">{exchange.question}</p>

            {(exchange.steps?.length ?? 0) > 0 && !exchange.answer && !exchange.failed && (
              <p className="ai-progress" role="status">
                {exchange.steps![exchange.steps!.length - 1]}
                {/*
                 * Only the reads that worked.
                 *
                 * This listed every attempt, so a read that failed - a record
                 * the person is not allowed to see, a register that would not
                 * answer - was shown as "read the finding register". The
                 * progress line was claiming evidence the answer did not
                 * have, which is the one thing this feature must never do.
                 */}
                {(exchange.reads ?? []).some((read) => read.ok) && (
                  <span>
                    {' · read '}
                    {(exchange.reads ?? [])
                      .filter((read) => read.ok)
                      .map((read) => TOOL_LABELS[read.name] ?? 'your records')
                      .join(', ')}
                  </span>
                )}
                {(exchange.reads ?? []).some((read) => !read.ok) && (
                  <span>
                    {' · could not read '}
                    {(exchange.reads ?? [])
                      .filter((read) => !read.ok)
                      .map((read) => TOOL_LABELS[read.name] ?? 'one record')
                      .join(', ')}
                  </span>
                )}
              </p>
            )}

            {exchange.notice && !exchange.answer && (
              <p className="ai-progress" role="status">
                {exchange.notice}
              </p>
            )}

            {exchange.answer && (
              <div className="ai-answer">
                {exchange.answer.split('\n\n').map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            )}

            {exchange.sources.length > 0 && (
              <div className="ai-sources">
                <p>What I read</p>
                <ul>
                  {exchange.sources.map((source) => (
                    <li key={`${source.kind}-${source.id}`}>
                      <Link href={source.href}>{source.label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {exchange.failed && (
              <p className="notice error" role="alert">
                {exchange.failed}
              </p>
            )}
          </article>
        ))}
        <div ref={bottom} />
      </section>

      <form
        className="ai-ask"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          void ask(question);
        }}
      >
        <label htmlFor="ai-question" className="visually-hidden">
          Ask the assistant
        </label>
        <textarea
          id="ai-question"
          value={question}
          rows={2}
          maxLength={4000}
          disabled={!enabled}
          placeholder={enabled ? 'Ask about your work…' : disabledReason}
          onChange={(changeEvent) => setQuestion(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            // Enter sends; Shift+Enter writes a new line. A question is
            // usually one sentence, and reaching for a button each time is
            // the thing that makes somebody stop asking.
            if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
              keyEvent.preventDefault();
              void ask(question);
            }
          }}
        />
        {busy ? (
          <button
            type="button"
            className="btn"
            onClick={() => {
              abort.current?.abort();
            }}
          >
            Stop
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!enabled || !question.trim()}>
            Ask
          </button>
        )}
      </form>
    </div>
  );
}
