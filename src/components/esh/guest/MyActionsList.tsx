import Link from 'next/link';

/**
 * My Actions (§10) as a plain list: one row per action, the whole row a link.
 *
 * v227 - no selection, no tickboxes and no bulk operations. An Action Owner
 * works one finding at a time, and a page that offered to act on several at
 * once asked them a question they never had.
 */

export interface OwnerActionRow {
  id: string;
  reference: string;
  title: string;
  place: string;
  dueText: string;
  overdue: boolean;
  /** Urgent or High, said on the row; Normal is not worth a word. */
  priorityLabel: string | null;
  /** Whose turn it is, in the words the tabs use. */
  turn: 'Owner action' | 'Waiting for ESH';
}

export function MyActionsList({ rows }: { rows: OwnerActionRow[] }) {
  return (
    <ul className="guest-actions">
      {rows.map((row) => (
        <li key={row.id}>
          <Link href={`/respond/actions/${row.id}`} className="guest-action-row">
            <span className="guest-action-main">
              <strong>
                <span className="guest-action-ref">{row.reference}</span> {row.title}
              </strong>
              <small>
                {row.place ? `${row.place} · ` : ''}
                <span className={row.overdue ? 'esh-overdue' : undefined}>{row.dueText}</span>
                {row.priorityLabel ? ` · ${row.priorityLabel} priority` : ''}
              </small>
            </span>
            <span className={`guest-action-turn${row.turn === 'Owner action' ? ' is-owner' : ''}`}>
              {row.turn} <span aria-hidden="true">›</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
