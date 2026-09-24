'use client';

import { useState, useTransition } from 'react';

import { enableContacts, type BulkContactAccessResult } from '@/server/esh/conversation-actions';

export interface PendingContact {
  id: string;
  email: string;
  displayName: string | null;
  openActions: number;
  heldNotifications: number;
}

/**
 * Clearing the people who will own work, in one act (§43.2).
 *
 * The rollout gate stays exactly as strict: an administrator names the
 * contacts and says why, each one is switched on by the same audited
 * procedure, and switching a contact on still sends nothing. What changes is
 * that an ESH coordinator assigning twelve actions on a Monday no longer needs
 * an administrator to visit this screen twelve times.
 */
export function BulkContactAccess({ contacts }: { contacts: PendingContact[] }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<BulkContactAccessResult | null>(null);
  const [pending, startTransition] = useTransition();

  /*
   * Clearing the last waiting contact empties this list, and the page
   * revalidates. Unmounting then would take the confirmation with it, so the
   * answer outlives the thing it answered: an administrator who presses the
   * button sees what happened rather than a panel that silently vanishes.
   */
  if (contacts.length === 0 && !result) return null;
  const refusedIds = new Set((result?.refused ?? []).map((row) => row.email));

  return (
    <section className="esh-form-card esh-bulk-access" aria-labelledby="esh-bulk-access-title">
      <h2 id="esh-bulk-access-title" className="esh-form-card-title">
        Contacts waiting to be cleared
      </h2>
      {contacts.length > 0 && (
        <p className="form-hint">
          {contacts.length} email contact{contacts.length === 1 ? ' has' : 's have'} work or a held
          notice and cannot be written to yet. Clearing them sends nothing: each finding still
          releases its own held notice.
        </p>
      )}

      {result && (
        <div className={`notice ${result.ok ? 'success' : 'error'} compact`} role="status">
          <strong>{result.message}</strong>
          {result.refused.length > 0 && (
            <ul>
              {result.refused.map((row) => (
                <li key={row.email}>{row.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {contacts.length === 0 && (
        <p className="form-hint">Every contact with work waiting is now cleared.</p>
      )}
      <ul className="esh-bulk-list">
        {contacts.map((contact) => (
          <li key={contact.id} data-refused={refusedIds.has(contact.id) ? 'true' : undefined}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={chosen.includes(contact.id)}
                onChange={(event) => {
                  setResult(null);
                  setChosen((current) =>
                    event.target.checked
                      ? [...current, contact.id]
                      : current.filter((id) => id !== contact.id),
                  );
                }}
              />
              <span>
                {contact.displayName ? `${contact.displayName} · ` : ''}
                {contact.email}
                <small>
                  {[
                    contact.openActions > 0
                      ? `${contact.openActions} open action${contact.openActions === 1 ? '' : 's'}`
                      : null,
                    contact.heldNotifications > 0
                      ? `${contact.heldNotifications} held notice${contact.heldNotifications === 1 ? '' : 's'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {contacts.length > 0 && (
        <>
          <label className="esh-field" htmlFor="esh-bulk-reason">
            <span>Why these contacts may be written to</span>
          </label>
          <input
            id="esh-bulk-reason"
            value={reason}
            maxLength={200}
            placeholder="Supervisors who own corrective actions"
            onChange={(event) => {
              setReason(event.target.value);
              setResult(null);
            }}
          />

          <div className="esh-form-actions">
            <span className="form-hint">
              {chosen.length === 0
                ? 'Nobody chosen yet.'
                : `${chosen.length} chosen of ${contacts.length}.`}
            </span>
            <button
              type="button"
              className="btn primary"
              disabled={pending || chosen.length === 0}
              onClick={() =>
                startTransition(async () => {
                  const answer = await enableContacts({ principalIds: chosen, reason });
                  setResult(answer);
                  if (answer.enabled > 0) setChosen([]);
                })
              }
            >
              {pending ? 'Clearing…' : 'Clear selected contacts'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
