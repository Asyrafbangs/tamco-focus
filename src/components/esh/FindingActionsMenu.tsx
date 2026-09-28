'use client';

import Link from 'next/link';
import { useState } from 'react';

export interface FindingMenuItem {
  key: string;
  label: string;
  /** The form this item opens, alone. */
  panel?: React.ReactNode;
  /** Or a place on the page it goes to. */
  href?: string;
}

/**
 * The finding's administrative controls, out of sight until wanted (§13).
 *
 * v227 - a short menu of named things rather than every form at once: Change
 * due date, Change owner, Edit finding, Change risk, Review submission,
 * Cancel / mark duplicate. Choosing one opens that form and only that form.
 *
 * The form opens as a panel in the flow rather than floating: these are whole
 * forms, and a form taller than the screen floated above a header that
 * scrolls away puts its own submit button where nothing can reach it (v220).
 */
export function FindingActionsMenu({ items }: { items: FindingMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const chosen = items.find((item) => item.key === active) ?? null;

  if (items.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-label="More actions for this finding"
        onClick={() => {
          setOpen((current) => !current);
          setActive(null);
        }}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open && (
        <div className="esh-finding-menu-panel">
          {chosen?.panel ? (
            <div className="esh-finding-menu-form">
              <div className="esh-finding-menu-form-head">
                <h2 className="esh-subheading">{chosen.label}</h2>
                <button type="button" className="btn ghost small" onClick={() => setActive(null)}>
                  Back
                </button>
              </div>
              {chosen.panel}
            </div>
          ) : (
            <ul className="esh-finding-menu-list" aria-label="Finding actions">
              {items.map((item) => (
                <li key={item.key}>
                  {item.href ? (
                    <Link href={item.href} onClick={() => setOpen(false)}>
                      {item.label}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => setActive(item.key)}>
                      {item.label}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
