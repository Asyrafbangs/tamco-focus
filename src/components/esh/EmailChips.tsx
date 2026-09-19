'use client';

import { useId, useState, type KeyboardEvent } from 'react';

import { canonicalEmail, looksLikeEmail, splitEmails } from '@/domain/esh-findings';

/**
 * Email addresses as chips (§7): type or paste, press Enter or a comma, and
 * each address becomes a chip that can be removed. Addresses need not belong
 * to anybody in the directory — that is the point — and a repeat at the same
 * level is kept once.
 *
 * The chips travel in a hidden field as a JSON list; the database procedure
 * validates them again, so this editor is convenience, not the rule.
 */
export function EmailChips({
  name,
  label,
  initial = [],
  describedBy,
}: {
  name: string;
  label: string;
  initial?: string[];
  describedBy?: string;
}) {
  const inputId = useId();
  const errorId = useId();
  const [addresses, setAddresses] = useState<string[]>(initial);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  function commit(text: string): boolean {
    const found = splitEmails(text);
    if (found.length === 0) return true;
    const bad = found.filter((address) => !looksLikeEmail(address));
    const good = found.filter((address) => looksLikeEmail(address));
    setAddresses((current) => {
      const known = new Set(current.map(canonicalEmail));
      const next = [...current];
      for (const address of good) {
        if (known.has(canonicalEmail(address))) continue;
        known.add(canonicalEmail(address));
        next.push(address);
      }
      return next;
    });
    if (bad.length) {
      setError(`${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not an email address.`);
      setDraft(bad.join(' '));
      return false;
    }
    setError(null);
    setDraft('');
    return true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
      if (!draft.trim()) {
        // An empty Enter must not submit the whole form from here.
        if (event.key === 'Enter') event.preventDefault();
        return;
      }
      event.preventDefault();
      commit(draft);
    } else if (event.key === 'Backspace' && !draft && addresses.length) {
      setAddresses((current) => current.slice(0, -1));
    }
  }

  const describedByIds =
    [describedBy, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className="esh-chips-field">
      <label htmlFor={inputId}>
        <span>{label}</span>
      </label>
      <div className="esh-chips" data-invalid={error ? 'true' : undefined}>
        <ul aria-label={`${label} addresses`}>
          {addresses.map((address) => (
            <li key={canonicalEmail(address)} className="esh-chip">
              <span>{address}</span>
              <button
                type="button"
                aria-label={`Remove ${address}`}
                onClick={() =>
                  setAddresses((current) =>
                    current.filter((entry) => canonicalEmail(entry) !== canonicalEmail(address)),
                  )
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="off"
          value={draft}
          placeholder={addresses.length ? 'Add another address' : 'name@company.com'}
          aria-describedby={describedByIds}
          aria-invalid={error ? 'true' : undefined}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          onPaste={(event) => {
            const text = event.clipboardData.getData('text');
            if (/[\s,;]/.test(text.trim())) {
              event.preventDefault();
              commit(`${draft} ${text}`);
            }
          }}
        />
      </div>
      {error && (
        <p id={errorId} className="esh-field-error" role="alert">
          {error}
        </p>
      )}
      <input type="hidden" name={name} value={JSON.stringify(addresses)} />
    </div>
  );
}
