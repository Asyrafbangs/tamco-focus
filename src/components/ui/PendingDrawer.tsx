'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { LoadingSkeleton } from '@/components/ui/ParityPrimitives';
import {
  clearPendingDrawer,
  pendingDrawer,
  type PendingDrawer as PendingDrawerState,
  registerPendingPanel,
  showPendingDrawer,
  subscribePendingDrawer,
} from '@/components/ui/drawer-handoff';
import { lockBodyScroll } from '@/components/ui/scroll-lock';
import { drawerOpenedBy, drawerTitleFrom } from '@/domain/drawer-links';

/** However slow the answer, a placeholder does not outstay this. */
const GIVE_UP_AFTER_MS = 20_000;

/**
 * The drawer, before its content has arrived (v195).
 *
 * Reported 18 September 2026: pressing a task "loading slow and taking time,
 * not as smooth". Opening a drawer is a navigation, and the page stayed exactly
 * as it was until the server had rendered all of it again — half a second on
 * a good day, longer from a cold start — and only then did the drawer begin to
 * slide in. So the press now starts the slide at once, titled from the row that
 * was pressed, and the real drawer takes its place the moment it arrives,
 * carrying on from wherever this one had got to (`SideDrawer`).
 *
 * It is a stand-in, not a second dialog: it takes no focus, leaves the caret
 * on the row that was pressed, and shares the drawer's box but none of its
 * classes, so nothing that looks for the drawer finds this instead. Escape, its
 * backdrop and its Cancel button abandon the open; a navigation that arrives
 * without a drawer — the task was deleted, or is not the viewer's to see —
 * clears it the moment it lands.
 */
export function PendingDrawer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pending = useSyncExternalStore(subscribePendingDrawer, pendingDrawer, () => null);
  // Which placeholder has been given its frame to slide in from off-screen.
  const [slidInFor, setSlidInFor] = useState<PendingDrawerState | null>(null);
  const slidIn = pending !== null && slidInFor === pending;
  const panelRef = useRef<HTMLDivElement>(null);

  /*
   * Listen after the link has handled the press, not before. A link that
   * navigates in the page prevents the browser's own navigation, so a click
   * that arrives here prevented is one the router has taken; one that is not
   * prevented is a new tab, a download or a full page load, and gets nothing.
   */
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement)) return;

      const opened = drawerOpenedBy(new URL(link.href), new URL(window.location.href));
      if (!opened) return;
      showPendingDrawer({
        ...opened,
        title: drawerTitleFrom(link.getAttribute('aria-label'), link.textContent),
        from: window.location.href,
      });
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  /*
   * Any navigation that lands clears it. The drawer it was waiting for, when
   * there is one, has already taken its place by now: that happens as the
   * drawer mounts, before this runs.
   */
  const location = `${pathname}?${searchParams.toString()}`;
  const landedAt = useRef(location);
  useEffect(() => {
    if (landedAt.current === location) return;
    landedAt.current = location;
    clearPendingDrawer();
  }, [location]);

  const cancel = useCallback(() => {
    const abandoned = pendingDrawer();
    if (!abandoned) return;
    clearPendingDrawer();
    // A newer navigation discards the one still on its way, so the drawer that
    // was asked for never arrives.
    const back = new URL(abandoned.from);
    router.replace(`${back.pathname}${back.search}`, { scroll: false });
  }, [router]);

  useEffect(() => {
    if (!pending) return;
    registerPendingPanel(panelRef.current);
    const releaseScroll = lockBodyScroll();
    const frame = requestAnimationFrame(() => setSlidInFor(pending));
    const giveUp = setTimeout(() => {
      if (pendingDrawer() === pending) clearPendingDrawer();
    }, GIVE_UP_AFTER_MS);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') cancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(giveUp);
      document.removeEventListener('keydown', onKeyDown);
      releaseScroll();
    };
  }, [pending, cancel]);

  if (!pending) return null;

  const heading = pending.title ?? 'Opening';
  return (
    <div className="drawer-pending-layer" data-open={slidIn} data-kind={pending.kind}>
      <button
        className="drawer-pending-backdrop"
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={cancel}
      />
      <div ref={panelRef} className="drawer-pending" data-open={slidIn} aria-busy="true">
        <div className="drawer-pending-head">
          <div>
            <span className="skeleton drawer-pending-eyebrow" aria-hidden="true" />
            <p className="drawer-pending-title">{heading}</p>
          </div>
          <button type="button" className="btn small ghost" onClick={cancel}>
            Cancel
          </button>
        </div>
        <div className="drawer-pending-body">
          <LoadingSkeleton
            rows={5}
            label={pending.title ? `Opening ${pending.title}` : 'Opening'}
          />
        </div>
      </div>
    </div>
  );
}
