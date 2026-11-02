'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { relateFinding, unrelateFinding } from '@/server/esh/link-actions';

export interface RelatedFinding {
  id: string;
  reference: string;
  title: string;
  note: string | null;
}

/**
 * The findings that inform this one (v279, §6).
 *
 * Undirected on purpose: the same guard on a different machine, two reports
 * from one walk, a correction whose scope turned out to cover both. Neither
 * finding replaces the other, so neither row owns the link and removing it
 * from either end removes the one row there is.
 */
export function RelatedFindings({
  findingId,
  related,
  canCoordinate,
}: {
  findingId: string;
  related: RelatedFinding[];
  canCoordinate: boolean;
}) {
  const router = useRouter();
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function add() {
    setProblem(null);
    start(async () => {
      const result = await relateFinding({ findingId, related: reference, note });
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setReference('');
      setNote('');
      router.refresh();
    });
  }

  function remove(relatedFindingId: string) {
    setProblem(null);
    start(async () => {
      const result = await unrelateFinding({ findingId, relatedFindingId });
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="esh-related">
      {related.length === 0 ? (
        <p className="form-hint">No other finding is related to this one.</p>
      ) : (
        <ul className="esh-link-list">
          {related.map((item) => (
            <li key={item.id}>
              <div className="esh-link-row">
                <Link href={`/findings/${item.id}`}>
                  {item.reference} — {item.title}
                </Link>
                {canCoordinate && (
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending}
                    onClick={() => remove(item.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
              {item.note && <p className="esh-link-note">{item.note}</p>}
            </li>
          ))}
        </ul>
      )}

      {canCoordinate && (
        <div className="esh-related-add">
          <div className="esh-field">
            <label htmlFor="esh-relate-reference">
              <span>Relate another finding</span>
            </label>
            <input
              id="esh-relate-reference"
              value={reference}
              placeholder="Its reference, or paste its address"
              onChange={(event) => {
                setReference(event.target.value);
                setProblem(null);
              }}
            />
          </div>
          <div className="esh-field">
            <label htmlFor="esh-relate-note">
              <span>How they are related (optional)</span>
            </label>
            <input
              id="esh-relate-note"
              value={note}
              placeholder="Same guard design on the sister press"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn primary small"
            disabled={pending || reference.trim() === ''}
            onClick={add}
          >
            {pending ? 'Relating…' : 'Relate'}
          </button>
        </div>
      )}

      {problem && (
        <p className="notice warn" role="status">
          {problem}
        </p>
      )}
    </div>
  );
}
