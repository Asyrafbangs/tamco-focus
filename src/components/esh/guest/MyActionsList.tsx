'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import {
  BULK_MAX,
  BULK_OPERATIONS,
  bulkItemProblem,
  bulkProblem,
  bulkSummary,
  type BulkPurpose,
  type BulkResult,
} from '@/domain/esh-bulk';
import { requestBulkExtension, sendBulkUpdate, submitBulkActions } from '@/server/esh/bulk-actions';

/**
 * My Actions, with the option of doing several at once (v206, §40).
 *
 * Selection is opt-in: the list is the list until somebody presses Select
 * actions, because most of the time one action is what is wanted and a page
 * full of tickboxes is in the way. Nothing here closes an action; the
 * operations are an update, a request for more time, and submitting each
 * chosen action separately for review.
 */

export interface OwnerActionRow {
  id: string;
  reference: string;
  title: string;
  place: string;
  dueText: string;
  overdue: boolean;
  priorityLabel: string | null;
  stateLabel: string;
}

export function MyActionsList({
  rows,
  filter,
}: {
  rows: OwnerActionRow[];
  filter: 'needs' | 'review';
}) {
  const router = useRouter();
  const [selecting, setSelecting] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [sheet, setSheet] = useState<BulkPurpose | null>(null);
  const [busy, start] = useTransition();
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<{ purpose: BulkPurpose; value: BulkResult } | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);
  const date = useRef<HTMLInputElement>(null);
  const results = useRef<Record<string, string>>({});
  const clientKey = useRef('');

  const selectable = filter === 'needs' ? rows : [];
  const chosenRows = rows.filter((row) => chosen.includes(row.id));

  function key() {
    if (!clientKey.current) clientKey.current = window.crypto.randomUUID();
    return clientKey.current;
  }

  function done(purpose: BulkPurpose, outcome: Awaited<ReturnType<typeof sendBulkUpdate>>) {
    if (!outcome.ok) {
      setProblem(bulkProblem(outcome.code));
      return;
    }
    clientKey.current = '';
    setResult({ purpose, value: outcome.result });
    setSheet(null);
    setChosen([]);
    setSelecting(false);
    router.refresh();
  }

  return (
    <>
      {filter === 'needs' && rows.length > 1 && (
        <div className="guest-bulk-bar">
          <button
            type="button"
            className="btn small ghost"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((current) => !current);
              setChosen([]);
              setSheet(null);
            }}
          >
            {selecting ? 'Done selecting' : 'Select actions'}
          </button>
          {selecting && (
            <>
              <span aria-live="polite">
                {chosen.length} of {selectable.length} chosen
              </span>
              <button
                type="button"
                className="btn small ghost"
                onClick={() =>
                  setChosen(
                    chosen.length === selectable.length ? [] : selectable.map((row) => row.id),
                  )
                }
              >
                {chosen.length === selectable.length ? 'Clear' : 'Choose all on this page'}
              </button>
            </>
          )}
        </div>
      )}

      {problem && (
        <div className="notice error" role="alert">
          <p>{problem}</p>
        </div>
      )}

      {result && (
        <div className="notice success guest-bulk-result" role="status">
          <p>{bulkSummary(result.value, result.purpose)}</p>
          {result.value.items.some((item) => item.state !== 'succeeded') && (
            <ul>
              {result.value.items
                .filter((item) => item.state !== 'succeeded')
                .map((item) => (
                  <li key={item.actionId}>
                    {rows.find((row) => row.id === item.actionId)?.title ?? 'An action'} —{' '}
                    {bulkItemProblem(item.code)}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <ul className="guest-actions">
        {rows.map((row) => (
          <li key={row.id}>
            {selecting && filter === 'needs' ? (
              <label className="guest-action-choose">
                <input
                  type="checkbox"
                  checked={chosen.includes(row.id)}
                  onChange={(event) =>
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, row.id]
                        : current.filter((id) => id !== row.id),
                    )
                  }
                />
                <span className="guest-action-main">
                  <small>{[row.reference, row.place].filter(Boolean).join(' · ')}</small>
                  <strong>{row.title}</strong>
                  <small className={row.overdue ? 'esh-overdue' : undefined}>
                    {row.dueText}
                    {row.priorityLabel ? ` · ${row.priorityLabel} priority` : ''}
                  </small>
                </span>
              </label>
            ) : (
              <Link href={`/respond/actions/${row.id}`} className="guest-action-row">
                <span className="guest-action-main">
                  <small>{[row.reference, row.place].filter(Boolean).join(' · ')}</small>
                  <strong>{row.title}</strong>
                  <small className={row.overdue ? 'esh-overdue' : undefined}>
                    {row.dueText}
                    {row.priorityLabel ? ` · ${row.priorityLabel} priority` : ''}
                  </small>
                </span>
                <span className={`flag ${row.overdue ? 'amber' : 'neutral'} guest-action-state`}>
                  {row.stateLabel}
                </span>
              </Link>
            )}
          </li>
        ))}
      </ul>

      {selecting && chosen.length > 0 && (
        <div className="guest-bulk-actions">
          {BULK_OPERATIONS.map((operation) => (
            <button
              key={operation.key}
              type="button"
              className="btn small"
              onClick={() => {
                setProblem(null);
                setResult(null);
                setSheet(operation.key);
              }}
            >
              {operation.label}
            </button>
          ))}
        </div>
      )}

      {sheet && (
        <section className="guest-card guest-bulk-sheet" aria-labelledby="bulk-sheet-title">
          <h2 id="bulk-sheet-title">
            {BULK_OPERATIONS.find((operation) => operation.key === sheet)?.label}
          </h2>
          <p className="guest-lead">
            {BULK_OPERATIONS.find((operation) => operation.key === sheet)?.lead}
          </p>
          <ul className="guest-bulk-chosen">
            {chosenRows.map((row) => (
              <li key={row.id}>
                <strong>{row.title}</strong>
                <small>
                  {row.reference} · {row.dueText}
                </small>
                {sheet === 'submit' && (
                  <label>
                    <span className="visually-hidden">Result for {row.title}</span>
                    <textarea
                      rows={2}
                      maxLength={2000}
                      placeholder="What you did"
                      onChange={(event) => {
                        results.current[row.id] = event.target.value;
                      }}
                    />
                  </label>
                )}
              </li>
            ))}
          </ul>

          {sheet !== 'submit' && (
            <label className="esh-field">
              <span>{sheet === 'extension' ? 'Why you need longer' : 'Your update'}</span>
              <textarea ref={body} rows={4} maxLength={4000} />
            </label>
          )}
          {sheet === 'extension' && (
            <label className="esh-field">
              <span>The date you are asking for</span>
              <input ref={date} type="date" />
            </label>
          )}

          <div className="guest-bulk-confirm">
            <button type="button" className="btn ghost small" onClick={() => setSheet(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || chosen.length > BULK_MAX}
              onClick={() =>
                start(async () => {
                  setProblem(null);
                  if (sheet === 'update') {
                    done(
                      'update',
                      await sendBulkUpdate({
                        actionIds: chosen,
                        body: body.current?.value ?? '',
                        clientKey: key(),
                      }),
                    );
                  } else if (sheet === 'extension') {
                    done(
                      'extension',
                      await requestBulkExtension({
                        actionIds: chosen,
                        body: body.current?.value ?? '',
                        proposedDate: date.current?.value ?? '',
                        clientKey: key(),
                      }),
                    );
                  } else {
                    done(
                      'submit',
                      await submitBulkActions({
                        rows: chosenRows.map((row) => ({
                          actionId: row.id,
                          resultText: results.current[row.id] ?? '',
                          assetIds: [],
                        })),
                        clientKey: key(),
                      }),
                    );
                  }
                })
              }
            >
              {BULK_OPERATIONS.find((operation) => operation.key === sheet)?.confirm} (
              {chosen.length})
            </button>
          </div>
        </section>
      )}
    </>
  );
}
