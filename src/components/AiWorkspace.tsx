'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import type { Exchange as StoredExchange, SourceLink } from '@/domain/ai';

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

export interface ConversationRow {
  id: string;
  title: string;
  updatedAt: string;
}

const READ_LABELS: Record<string, string> = {
  list_my_tasks: 'your tasks',
  get_task_detail: 'a task in full',
  list_steps_i_owe: 'steps you owe',
  list_team_workload: 'the team’s work',
  search_findings: 'the finding register',
  get_finding_detail: 'a finding in full',
  list_verification_queue: 'the verification queue',
  get_hazard_distribution: 'hazard categories',
};

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
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

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
          if (payload.type === 'conversation') setThread(String(payload.id));
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
        {conversations.length === 0 ? (
          <p className="form-hint">Nothing yet. Ask something below.</p>
        ) : (
          <ul>
            {conversations.map((one) => (
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
                {(exchange.reads?.length ?? 0) > 0 && (
                  <span>
                    {' · read '}
                    {exchange.reads!.map((read) => READ_LABELS[read.name] ?? read.name).join(', ')}
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
