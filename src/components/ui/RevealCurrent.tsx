'use client';

import { useEffect, useRef } from 'react';

/**
 * Brings the item you are on into view inside a strip that scrolls.
 *
 * A strip that scrolls hides whichever item does not fit, and the item that
 * does not fit can be the one you are standing on — so the screen shows no sign
 * of where you are. That was the settings menu on a phone (v243, eleven
 * sections at 132px in a 362px box) and the Goals people strip (v250, five
 * people at 210px), and it will be the next one somebody builds.
 *
 * `inline: 'nearest'` scrolls the strip by the least that reveals the item, and
 * `block: 'nearest'` stops it scrolling the page underneath — so on a wider
 * screen, where the strip is a column and the item is already visible, this
 * does nothing at all.
 */
export function RevealCurrent({
  /** The strip to scroll, as a selector resolved from this component's parent. */
  within,
  /** What marks the current item inside it. */
  current = '[aria-current]',
  /** Re-runs when this changes, which is what makes it follow a selection. */
  watch,
}: {
  within: string;
  current?: string;
  watch?: string | null;
}) {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const root = anchor.current?.closest('main, body');
    const strip = root?.querySelector(within);
    if (!strip) return;
    // Only when it actually scrolls: elsewhere this would be a no-op that still
    // moved the page.
    if (strip.scrollWidth <= strip.clientWidth + 2) return;
    strip.querySelector(current)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [within, current, watch]);

  return <span ref={anchor} hidden />;
}
