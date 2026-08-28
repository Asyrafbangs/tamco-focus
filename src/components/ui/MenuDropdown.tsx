'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A small menu that opens from a button and closes when you look away.
 *
 * Two reasons this is not a `<details>` element, which is what it replaced.
 *
 * First, `<details>` stays open until its own summary is clicked again, so
 * clicking anywhere else left the menu hanging over the page. Closing on an
 * outside press, on Escape, and on scroll is what people expect of a menu, and
 * none of it is available without script.
 *
 * Second, and worse: the panel is inside `.focus-panel`, which sets
 * `overflow: hidden` to keep its rounded corners. An absolutely positioned
 * child of a clipping ancestor is clipped no matter what z-index it carries,
 * so the period list was cut off halfway through its options. This positions
 * the panel with `position: fixed` against the button's own rectangle, which
 * no ancestor can crop.
 *
 * The trade-off of fixed positioning is that the panel does not travel with
 * the page, so scrolling closes it rather than leaving it stranded.
 */
export function MenuDropdown({
  label,
  ariaLabel,
  className,
  panelClassName,
  minWidth = 200,
  children,
}: {
  label: ReactNode;
  ariaLabel: string;
  className?: string;
  panelClassName?: string;
  /** Floor for the panel width; it still grows to match a wider button. */
  minWidth?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number; width: number } | null>(
    null,
  );
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Measured before paint, so the panel never appears in the wrong place first.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPosition({
      top: rect.bottom + 4,
      right: Math.max(8, window.innerWidth - rect.right),
      width: Math.max(minWidth, rect.width),
    });
  }, [open, minWidth]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    // Capture, so a scroll inside any container closes it and not only the page.
    const onScroll = () => setOpen(false);

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <div className={className ? `menu-dropdown ${className}` : 'menu-dropdown'}>
      <button
        ref={buttonRef}
        type="button"
        className="menu-dropdown-toggle"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <span className="menu-dropdown-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && position && (
        <div
          ref={panelRef}
          role="menu"
          aria-label={ariaLabel}
          className={
            panelClassName ? `menu-dropdown-panel ${panelClassName}` : 'menu-dropdown-panel'
          }
          style={{ top: position.top, right: position.right, minWidth: position.width }}
          /* A choice inside is a navigation or a submit; either way the menu
             has done its job and should not still be sitting there when the
             new page paints. */
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('a, button[type="submit"]')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
