'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

export function SideDrawer({
  closeHref,
  closeLabel = 'Close detail',
  title,
  eyebrow,
  meta,
  actions,
  className,
  titleId,
  children,
}: {
  closeHref: string;
  closeLabel?: string;
  title: string;
  eyebrow?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    triggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      setOpen(true);
      /*
       * v46 §41 — let the content name where the caret belongs.
       *
       * The drawer focuses its own panel so a keyboard user starts inside the
       * dialog rather than behind it. But when the drawer opens *because*
       * somebody was asked to act, the useful place is the box they are here
       * to type in — and a child focusing itself loses this race every time,
       * since parent effects run last. Deciding it here keeps focus in one
       * place instead of two components taking it from each other.
       */
      const requested = panelRef.current?.querySelector<HTMLElement>('[data-initial-focus]');
      (requested ?? panelRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (closeTimer.current) clearTimeout(closeTimer.current);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const close = useCallback(() => {
    if (!open) return;
    setOpen(false);
    closeTimer.current = setTimeout(() => {
      triggerRef.current?.focus({ preventScroll: true });
      router.push(closeHref, { scroll: false });
    }, 245);
  }, [closeHref, open, router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return (
    <div className="task-detail-layer" data-open={open} role="presentation">
      <button
        className="task-detail-backdrop"
        type="button"
        onClick={close}
        aria-label={closeLabel}
      />
      <div
        ref={panelRef}
        className={`task-detail${className ? ` ${className}` : ''}`}
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="task-detail-head">
          <div className="task-detail-heading">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h2 id={titleId}>{title}</h2>
            {meta && <div className="task-detail-head-meta">{meta}</div>}
          </div>
          <div className="task-detail-head-actions">
            {actions}
            <button
              type="button"
              className="btn small ghost"
              onClick={close}
              aria-label={closeLabel}
            >
              Close
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
