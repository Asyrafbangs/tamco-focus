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
import { parseAnswer, type Span } from '@/domain/answer-format';

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

/**
 * The answer, as the model formatted it.
 *
 * Elements, never HTML. Everything here came from a model that reads records
 * written by other people, so `dangerouslySetInnerHTML` would be a direct
 * path from a task title to script on this page. React escapes the text in a
 * structure, so the worst a malformed answer can do is look wrong.
 */
function renderSpans(spans: Span[]) {
  return spans.map((span, index) => {
    if (span.bold) return <strong key={index}>{span.text}</strong>;
    if (span.code) return <code key={index}>{span.text}</code>;
    return <span key={index}>{span.text}</span>;
  });
}

function renderAnswer(answer: string) {
  return parseAnswer(answer).map((block, index) => {
    if (block.kind === 'heading') return <h3 key={index}>{renderSpans(block.spans)}</h3>;
    if (block.kind === 'list') {
      const items = block.items.map((item, at) => <li key={at}>{renderSpans(item)}</li>);
      return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    if (block.kind === 'table') {
      return (
        <div className="table-scroll" key={index}>
          <table className="ai-table">
            <thead>
              <tr>
                {block.head.map((cell, at) => (
                  <th key={at}>{renderSpans(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, at) => (
                <tr key={at}>
                  {row.map((cell, cellAt) => (
                    <td key={cellAt}>{renderSpans(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    return <p key={index}>{renderSpans(block.spans)}</p>;
  });
}

/**
 * Cited records, grouped and folded.
 *
 * A long answer cites thirty records, and listing them all under every answer
 * made the evidence several times taller than the reasoning it supports. The
 * count is the part that belongs on screen unprompted — it is the claim this
 * feature makes about itself — and the records themselves are one press away,
 * grouped by what they are so a reader looking for the finding behind a
 * sentence is not reading task titles to get to it.
 */
const SOURCE_GROUPS: { kind: SourceLink['kind']; title: string }[] = [
  { kind: 'task', title: 'Tasks' },
  { kind: 'finding', title: 'Findings' },
  { kind: 'action', title: 'Actions' },
];

function AiSources({ sources }: { sources: SourceLink[] }) {
  const groups = SOURCE_GROUPS.map((group) => ({
    ...group,
    items: sources.filter((source) => source.kind === group.kind),
  })).filter((group) => group.items.length > 0);

  return (
    <details className="ai-sources">
      <summary>{sources.length === 1 ? 'Read 1 record' : `Read ${sources.length} records`}</summary>
      {groups.map((group) => (
        <div className="ai-sources-group" key={group.kind}>
          <h4>{group.title}</h4>
          <ul>
            {group.items.map((source) => (
              <li key={`${source.kind}-${source.id}`}>
                {/* The title attribute carries what the one-line clamp cuts. */}
                <Link href={source.href} title={source.label}>
                  {source.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </details>
  );
}

const SUGGESTIONS = [
  'Why are my corrective actions delayed?',
  'What should I prioritise today?',
  'Challenge my plan for this week.',
];

export function AiWorkspace({
  conversations,
  conversationsFailed = false,
  initial,
  threadFailed = false,
  conversationId,
  enabled,
  disabledReason,
}: {
  conversations: ConversationRow[];
  /** The list could not be read. Not the same as having none. */
  conversationsFailed?: boolean;
  initial: Exchange[];
  /** This thread could not be read. Not the same as it being empty. */
  threadFailed?: boolean;
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
          <Link className="btn small" href="/ai/chat">
            New
          </Link>
        </div>
        {/*
         * v302 — "Nothing yet" is a claim about this person's history, and a
         * failed read does not support it. The notice replaces that sentence
         * rather than sitting beside it, because the two together would say
         * both things at once. Anything started in this browser since is
         * still listed below: the list is incomplete, not absent.
         */}
        {conversationsFailed && (
          <p className="notice error" role="status">
            <strong>Your conversations could not be read</strong> — nothing has been lost. Reload in
            a moment to see them.
          </p>
        )}
        {threads.length === 0 ? (
          !conversationsFailed && <p className="form-hint">Nothing yet. Ask something below.</p>
        ) : (
          <ul>
            {threads.map((one) => (
              <li key={one.id}>
                <Link
                  href={`/ai/chat?c=${one.id}`}
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
        {/*
         * And the same for the thread itself. The opening screen means "this
         * conversation has nothing in it yet"; shown after a failed read it
         * tells somebody their conversation is empty, which is the one thing
         * the page does not know.
         */}
        {threadFailed && exchanges.length === 0 && (
          <div className="notice error" role="status">
            <strong>This conversation could not be read</strong>
            <p>
              Nothing from it is shown here, and nothing has been deleted. Reload to try again, or
              ask a new question below.
            </p>
          </div>
        )}

        {exchanges.length === 0 && !threadFailed && (
          <div className="ai-opening">
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

            {exchange.answer && <div className="ai-answer">{renderAnswer(exchange.answer)}</div>}

            {exchange.sources.length > 0 && <AiSources sources={exchange.sources} />}

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
