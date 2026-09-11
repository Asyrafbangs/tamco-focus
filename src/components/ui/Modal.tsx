'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Modal({
  open,
  title,
  onClose,
  size = 'default',
  className,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  size?: 'default' | 'wide';
  className?: string;
  children: ReactNode;
}) {
  /*
   * Always false on the first render, even when the modal is already open.
   *
   * The server cannot render a portal, so `typeof document === 'undefined'`
   * makes it emit nothing. Seeding this from `open` made the client's
   * hydration pass emit the portal instead, and React answered a mismatched
   * tree by regenerating it — silently discarding and remounting the drawer
   * underneath whoever had just arrived on a `?action=` link.
   *
   * The effect below mounts it on the next frame, which is also what makes the
   * open transition play instead of appearing fully formed.
   */
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  /*
   * v41 section 3 — the reason the Capture title box used to eat your typing.
   *
   * Callers pass `onClose` as an inline arrow, so its identity changes on every
   * render. The effect below both moves focus into the dialog and locks body
   * scrolling, and it used to list `onClose` as a dependency — so every single
   * keystroke re-ran it and pulled focus off the input the person was typing
   * into. The field kept the first character and dropped the rest.
   *
   * Holding the callback in a ref lets the effect depend only on `visible`,
   * which is what it is actually about: focus moves when the dialog appears,
   * once, and not again while somebody is using it.
   */
  const onCloseRef = useRef(onClose);
  // Written in an effect rather than during render: a ref assigned mid-render
  // is a side effect in a place React is free to re-run or discard.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const requestClose = useCallback(() => onCloseRef.current(), []);

  useEffect(() => {
    if (open) {
      triggerRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const mountFrame = requestAnimationFrame(() => {
        setMounted(true);
        requestAnimationFrame(() => setVisible(true));
      });
      return () => cancelAnimationFrame(mountFrame);
    }
    const hideFrame = requestAnimationFrame(() => setVisible(false));
    const timer = setTimeout(() => {
      /*
       * v164 — give the caret back only while it is still the dialog's to give.
       *
       * It is while it sits inside the closing layer — the dialog, or the
       * backdrop somebody pressed to dismiss it — or while nothing holds it.
       * It is not once the person has put it somewhere themselves. This used
       * to take it back regardless, 200ms after closing: close "Set a Goal",
       * open a goal inside that window, and the caret went from the goal's row
       * to "+ New goal" — which the goal drawer then recorded as its opener and
       * returned to on close. The same rule as `SideDrawer`'s `focusIsLoose`.
       */
      const owner = document.activeElement;
      const stillOurs =
        !owner ||
        owner === document.body ||
        owner === document.documentElement ||
        (layerRef.current?.contains(owner) ?? false);
      setMounted(false);
      if (stillOurs) triggerRef.current?.focus({ preventScroll: true });
    }, 200);
    return () => {
      cancelAnimationFrame(hideFrame);
      clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!visible) return;
    dialogRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        requestClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [requestClose, visible]);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={layerRef} className="modal-layer" data-open={visible}>
      <button
        type="button"
        className="modal-backdrop"
        onClick={onClose}
        aria-label={`Close ${title}`}
      />
      <div
        ref={dialogRef}
        className={`modal${size === 'wide' ? ' modal-wide' : ''}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
