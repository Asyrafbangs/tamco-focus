'use client';

import { useEffect } from 'react';

/**
 * Exposes when client-side interaction handlers are ready.
 *
 * Server-rendered controls remain usable where they have native behaviour,
 * while browser journeys can wait for this marker before exercising controls
 * whose behaviour depends on React state, focus management, or keyboard
 * listeners. The attribute is intentionally diagnostic and has no styling.
 *
 * v195 — not before the page itself is ready. This component hydrates with
 * the application shell, and every workspace streams in afterwards behind its
 * loading state, so the marker used to go up while the page underneath was
 * still a skeleton: measured, a drawer opened by its address became usable
 * 320-430ms after it. v195 made the shell faster, which widened that gap until,
 * under a loaded full suite, a test's Escape reached a drawer that was not yet
 * listening.
 *
 * So it waits for the document to finish streaming, and then for the browser
 * to be idle: React hydrates what streamed in as a run of short tasks, and an
 * idle period mostly comes once they have run. Measured on the same drawer, the
 * marker now lands within a frame of it at normal speed, and after it seven
 * times in eight with the CPU slowed six-fold.
 *
 * Mostly, not always: the browser is also idle while the page's scripts are
 * still downloading. So this is a floor, not a promise. A journey that needs a
 * particular control listening waits for that control's own state — a drawer
 * is listening once it is `data-open="true"`. The timeout keeps a page that
 * never goes idle from never marking.
 */
export function AppHydration() {
  useEffect(() => {
    // Safari has no idle callback; a short timeout is the nearest thing.
    const canIdle = typeof window.requestIdleCallback === 'function';
    let idle = 0;
    let frame = 0;
    const mark = () => {
      frame = requestAnimationFrame(() => {
        document.documentElement.setAttribute('data-app-hydrated', 'true');
      });
    };
    const whenIdle = () => {
      idle = canIdle
        ? window.requestIdleCallback(mark, { timeout: 3_000 })
        : window.setTimeout(mark, 50);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', whenIdle, { once: true });
    } else {
      whenIdle();
    }
    return () => {
      document.removeEventListener('DOMContentLoaded', whenIdle);
      if (canIdle) window.cancelIdleCallback(idle);
      else clearTimeout(idle);
      cancelAnimationFrame(frame);
    };
  }, []);

  return null;
}
