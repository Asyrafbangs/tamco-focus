'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * ESH Home and the module switcher, in the shared chrome (§4).
 *
 * Switching modules replaces the local navigation rather than adding another
 * menu: TAMCO Focus keeps its own, Finding Management has its own, and this is
 * the one control between them. It is rendered only for somebody with more
 * than one module to switch between — during the restricted rollout, everybody
 * else sees TAMCO Focus exactly as before (§43.3).
 */
export function ModuleSwitcher({ focusHref }: { focusHref: string }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const current = pathname.startsWith('/findings')
    ? 'Finding Management'
    : pathname.startsWith('/esh')
      ? 'Choose a module'
      : 'TAMCO Focus';

  // Choosing a module closes the menu behind it.
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="esh-switcher-bar">
      {/* Named explicitly: on a phone the words are hidden and the mark is
          decorative, which left the link with no name at all. */}
      <Link href="/esh" className="esh-home-link" aria-label="ESH Home">
        <span className="esh-brand-mark" aria-hidden="true">
          E
        </span>
        <span>ESH Home</span>
      </Link>
      <details className="esh-switcher" ref={menu}>
        <summary aria-label={`Module: ${current}. Switch module`}>
          {/* On a phone, TAMCO Focus's own bar has room for "Focus" only. */}
          {current === 'TAMCO Focus' ? (
            // One box, so the summary's gap falls before the arrow only.
            <span>
              <span className="esh-switcher-prefix">TAMCO </span>Focus
            </span>
          ) : (
            current
          )}
        </summary>
        <ul>
          <li>
            <Link href={focusHref} aria-current={current === 'TAMCO Focus' ? 'page' : undefined}>
              <strong>TAMCO Focus</strong>
              <small>Tasks, routines and team priorities</small>
            </Link>
          </li>
          <li>
            <Link
              href="/findings"
              aria-current={current === 'Finding Management' ? 'page' : undefined}
            >
              <strong>Finding Management</strong>
              <small>Corrective actions, follow-up and verified closure</small>
            </Link>
          </li>
        </ul>
      </details>
    </div>
  );
}
