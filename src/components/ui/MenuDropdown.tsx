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
  const [position, setPosition] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Measured before paint, so the panel never appears in the wrong place first.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    /*
     * Opens upward when there is no room below.
     *
     * A menu on a button at the foot of a drawer has nowhere to go downward,
     * and an absolutely positioned panel that opens up instead slides under
     * whatever sticky header is above it - where it is visible but cannot be
     * clicked, because the header takes the pointer. Choosing the side with
     * room, and capping the height to it, is what stops that.
     */
    const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
    const room = (openUp ? spaceAbove : spaceBelow) - 16;
    /*
     * The window is the last word on how wide the panel gets.
     *
     * `minWidth` is what the caller would like; the task admin menu asks for
     * 320 because it holds forms rather than links. On a narrow phone that is
     * wider than the screen, and a min-width always beats a max-width in CSS,
     * so no stylesheet could have rescued it - the panel simply hung off the
     * edge with its buttons unreachable.
     */
    const width = Math.min(Math.max(minWidth, rect.width), window.innerWidth - 16);
    /*
     * Right-aligned to its button, but never pushed off either edge.
     *
     * Aligning to the button alone is only safe while the button is near the
     * right of the window. A wide panel on a button near the left has to slide
     * back inward, or it opens off-screen to the left - visible in the layout,
     * unreadable on the display.
     */
    const right = Math.min(
      Math.max(8, window.innerWidth - rect.right),
      window.innerWidth - width - 8,
    );
    setPosition({
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      right: Math.max(8, right),
      width,
      maxHeight: Math.max(160, room),
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
    /*
     * Scrolling the page moves the button the panel is pinned to, so the panel
     * has to go. Scrolling INSIDE the panel does not - and closing on that
     * makes a long menu impossible to read past its first screen, which is
     * what a capture listener with no origin check did.
     */
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      setOpen(false);
    };

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
          style={{
            top: position.top,
            bottom: position.bottom,
            right: position.right,
            minWidth: position.width,
            maxHeight: position.maxHeight,
          }}
          /* A choice inside is a navigation, a submit, or a command; any of
             them means the menu has done its job and should not still be
             sitting there when the new page or dialog paints.

             `.menu-command` is named explicitly rather than closing on every
             button, because a panel may still hold a form — the period menu's
             custom range has date inputs — and a control inside one is being
             filled in, not chosen. */
          onClick={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest('a, button[type="submit"], .menu-command')) setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
