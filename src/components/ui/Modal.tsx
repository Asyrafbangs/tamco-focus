'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

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
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

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
      setMounted(false);
      triggerRef.current?.focus({ preventScroll: true });
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
        onClose();
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
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, visible]);

  if (!mounted) return null;
  return (
    <div className="modal-layer" data-open={visible}>
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
    </div>
  );
}
