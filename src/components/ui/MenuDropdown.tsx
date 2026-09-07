'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

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
 * Fixed positioning means the panel does not travel with the page by itself,
 * so it is re-measured as the page scrolls and closes only once its button has
 * scrolled out of sight.
 *
 * The panel is also PORTALLED to the body, because `position: fixed` resolves
 * against the nearest transformed ancestor rather than the viewport — and the
 * task drawer animates in with `transform: translateX()`. A menu opened inside
 * it was therefore positioned against the drawer's box while being measured
 * against the window's. Right-aligning happened to survive that, because the
 * drawer is flush to the right edge so the two right edges coincide; nothing
 * else did, and the admin menu ran 800px off the screen the moment the panel
 * was hung from its left edge instead.
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
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Measured before paint, so the panel never appears in the wrong place first.
  const measure = useCallback(() => {
    if (!buttonRef.current) return;
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
     * Aligned to whichever of the button's edges leaves the panel on screen.
     *
     * It used to be right-aligned always, which is correct only while the
     * button is near the right of the window. The period control put the same
     * menu on a button at the far LEFT of Records, and the panel then extended
     * leftward from it across the navigation rail — on screen, clamped, and
     * still obviously wrong. So: hang it from the left edge when it fits, fall
     * back to the right edge when it does not, and clamp either way.
     */
    const preferLeft = rect.left + width <= window.innerWidth - 8;
    const left = Math.min(
      Math.max(8, preferLeft ? rect.left : rect.right - width),
      window.innerWidth - width - 8,
    );
    setPosition({
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      left: Math.max(8, left),
      width,
      maxHeight: Math.max(160, room),
    });
  }, [minWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure]);

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
     * Scrolling repositions the panel; it does not close it.
     *
     * Closing was the old answer to a fixed panel being pinned to a button
     * that had moved. It costs more than it saves on a phone: the panel is
     * tall, so focusing the "From" box scrolls the page to reveal it, the
     * button moves, and the menu the person is filling in disappears between
     * one date field and the next. The custom range simply could not be used
     * on a touch device.
     *
     * Following the button is what a popover should do anyway. Measuring is
     * one `getBoundingClientRect` and a state write, throttled to a frame.
     * The menu still goes when the button itself has scrolled out of sight,
     * because a panel pointing at nothing is worse than no panel.
     */
    let frame = 0;
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && panelRef.current?.contains(target)) return;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const rect = buttonRef.current?.getBoundingClientRect();
        if (!rect) return;
        const offScreen = rect.bottom < 0 || rect.top > window.innerHeight;
        if (offScreen) setOpen(false);
        else measure();
      });
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', measure);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [open, measure]);

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
      {open &&
        position &&
        createPortal(
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
              left: position.left,
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
              /*
               * A submit closes on the NEXT tick, not this one.
               *
               * Closing immediately unmounts the panel, and the form lives
               * inside it — so the browser lost the element it was about to
               * submit and the navigation never happened. The period menu's
               * Apply button did nothing at all, on every screen that had one,
               * which is easy to miss because the menu closes either way and a
               * page that has not changed looks like a range that matched
               * nothing.
               */
              if (target.closest('button[type="submit"]')) {
                setTimeout(() => setOpen(false), 0);
                return;
              }
              if (target.closest('a, .menu-command')) setOpen(false);
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
