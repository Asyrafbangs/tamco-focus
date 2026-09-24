'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * The register's occasional tools, out of the way (§24).
 *
 * Export and the backlog import sat beside New finding as equals. One of them
 * is pressed several times a day; the other two are pressed during a migration
 * and then perhaps twice a year. They keep their place in the module, just not
 * the width.
 */
export function RegisterTools({ canCoordinate }: { canCoordinate: boolean }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="esh-register-tools" ref={wrap}>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="More register tools"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open && (
        <div className="esh-register-menu" role="menu">
          <Link role="menuitem" href="/findings/register/export" onClick={() => setOpen(false)}>
            Export register (CSV)
          </Link>
          {canCoordinate && (
            <Link role="menuitem" href="/findings/import" onClick={() => setOpen(false)}>
              Import backlog
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
