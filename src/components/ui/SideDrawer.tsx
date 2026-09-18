'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { pendingDrawer, takeOverPendingDrawer } from '@/components/ui/drawer-handoff';
import { lockBodyScroll } from '@/components/ui/scroll-lock';

/**
 * A way to find the trigger again after a re-render has replaced it.
 *
 * `data-focus-return` first, because a caller that knows its own identity
 * should say so; then an id; then the href, which every row link has and which
 * is unique per row because it is the address that row opens.
 */
function identifyTrigger(element: HTMLElement | null): string | null {
  if (!element) return null;
  const marked = element.dataset.focusReturn;
  if (marked) return `[data-focus-return="${CSS.escape(marked)}"]`;
  if (element.id) return `#${CSS.escape(element.id)}`;
  const href = element.getAttribute('href');
  if (href) return `[href="${CSS.escape(href)}"]`;
  return null;
}

export function SideDrawer({
  closeHref,
  closeLabel = 'Close detail',
  returnFocusTo,
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
  /**
   * The `data-focus-return` value of the row this drawer belongs to.
   *
   * Used when nothing meaningful held the caret at mount — a drawer opened by
   * its address, from a notification or a bookmark, or by a press that did not
   * leave the caret on the row. Without it the restore "succeeds" onto the
   * body and the person is dropped at the top of the document.
   */
  returnFocusTo?: string;
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
  /**
   * How to find the trigger again, when the node itself is gone.
   *
   * Holding the element alone is not enough: opening this drawer is a
   * navigation, and so is closing it, and either re-render can replace the row
   * that was clicked. Focusing a detached node does nothing and reports
   * nothing, so the caret quietly ended up on the body — the one outcome a
   * dialog must not have when it closes.
   */
  const triggerQuery = useRef<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleStop = useRef<(() => void) | null>(null);
  /** v194 - stops waiting to navigate away, when this drawer goes first. */
  const closeWatchStop = useRef<(() => void) | null>(null);
  /*
   * Closing is guarded by its own flag, not by the transition state.
   *
   * `open` is false for one animation frame after mount — it drives the slide-
   * in, nothing more — while the drawer's content is already rendered and
   * focused. Guarding `close()` on it therefore made Escape a no-op during
   * that frame: the drawer was on screen, had the caret, and silently ignored
   * the first Escape. Rare by hand, reproducible under load, and it failed the
   * team-visibility spec about one run in three.
   */
  const closing = useRef(false);
  /*
   * v195 — arriving onto a placeholder, the drawer is already on screen.
   *
   * The press started the slide before this drawer's content existed
   * (`PendingDrawer`), so it must not start it again from off-screen: it
   * renders open, and the layout effect below finishes whatever part of the
   * movement the placeholder had not.
   */
  const [open, setOpen] = useState(() => pendingDrawer() !== null);

  useLayoutEffect(() => {
    const reached = takeOverPendingDrawer();
    const panel = panelRef.current;
    if (!reached || reached === 'none' || !panel) return;
    // Start exactly where the placeholder was, then let the transition run to
    // the open position. Before paint, so the two are never seen side by side.
    panel.style.transition = 'none';
    panel.style.transform = reached;
    void panel.offsetWidth;
    panel.style.transition = '';
    panel.style.transform = '';
  }, []);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    triggerRef.current = opener;
    triggerQuery.current = identifyTrigger(opener);
    const releaseScroll = lockBodyScroll();
    const frame = requestAnimationFrame(() => {
      // Escape can arrive before this frame. If it has, do not slide a drawer
      // in that is already on its way out.
      if (closing.current) return;
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
      closeWatchStop.current?.();
      settleStop.current?.();
      releaseScroll();
    };
  }, []);

  /**
   * Is the caret still the drawer's to give back?
   *
   * It is while it sits inside the closing panel, which is the normal case, or
   * while nothing holds it at all. It is not once the person has put it
   * somewhere themselves — press Escape, click into search, and the restore
   * fired 245ms later and took the box away from under them.
   */
  const focusIsLoose = useCallback(() => {
    const owner = document.activeElement;
    if (!owner || owner === document.body) return true;
    return panelRef.current?.contains(owner) ?? false;
  }, []);

  /**
   * The trigger as it exists NOW.
   *
   * The node captured on mount is the right answer until a re-render replaces
   * it, after which focusing it does nothing and reports nothing. The address
   * recorded alongside it survives that.
   */
  const liveTrigger = useCallback((): HTMLElement | null => {
    const captured = triggerRef.current;
    /*
     * The body is not a trigger.
     *
     * Focusing it "succeeds" — `document.activeElement` really does become the
     * body — so a drawer opened by its address, where nothing held the caret,
     * restored onto nothing and reported that it had worked. Rejecting it here
     * is what lets the row below be the answer.
     */
    const meaningful =
      captured !== null &&
      captured.isConnected &&
      captured !== document.body &&
      captured !== document.documentElement;
    if (meaningful) return captured;

    const byAddress = triggerQuery.current
      ? document.querySelector<HTMLElement>(triggerQuery.current)
      : null;
    if (byAddress) return byAddress;

    // The row this drawer belongs to, whether or not it opened it.
    return returnFocusTo
      ? document.querySelector<HTMLElement>(`[data-focus-return="${CSS.escape(returnFocusTo)}"]`)
      : null;
  }, [returnFocusTo]);

  /** Put the caret back on the trigger, wherever that element is now. */
  const restoreFocus = useCallback(() => {
    const live = liveTrigger();
    if (!live) return false;
    live.focus({ preventScroll: true });
    return document.activeElement === live;
  }, [liveTrigger]);

  const close = useCallback(() => {
    // Re-entrancy only: two Escapes in quick succession must not queue two
    // navigations. Whether the opening transition has run is irrelevant to
    // whether this drawer can be dismissed.
    if (closing.current) return;
    closing.current = true;
    setOpen(false);
    /*
     * v194 - a close that is overtaken is dropped.
     *
     * The push below runs 245ms later, whatever happened in between, and a
     * client navigation only changes the address once it commits — later than
     * that. Opening another task inside the window was therefore undone by
     * this close: the task flashed and vanished, and after a few tries the
     * page looked like it had stopped responding. So a press on any internal
     * link cancels it, and a press on the link this drawer is already showing
     * brings it back rather than leaving an invisible drawer behind.
     *
     * v195 - and that holds until this drawer has actually gone, not only
     * until the push. Between the push and the moment it lands, a press on
     * this same row sends the router straight back to this address: the close
     * never lands, so this drawer is never removed — and it stayed on the page
     * closed, invisible, and deaf to every further press on that row. Found by
     * v194's own test once the page answered a little faster.
     */
    const shownAt = window.location.href;
    const onNavigationIntent = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[href]');
      const href = link?.getAttribute('href');
      if (!href || !href.startsWith('/')) return;
      const goingBackHere = new URL(href, window.location.origin).href === shownAt;
      stopWaiting();
      if (goingBackHere) {
        settleStop.current?.();
        closing.current = false;
        setOpen(true);
      }
    };
    const stopWaiting = () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
      closeTimer.current = null;
      closeWatchStop.current = null;
      document.removeEventListener('click', onNavigationIntent, true);
      window.removeEventListener('popstate', stopWaiting);
    };
    document.addEventListener('click', onNavigationIntent, true);
    window.addEventListener('popstate', stopWaiting);
    closeWatchStop.current = stopWaiting;
    closeTimer.current = setTimeout(() => {
      // The listeners stay until this drawer unmounts or a press overtakes it.
      closeTimer.current = null;
      if (focusIsLoose()) restoreFocus();
      router.push(closeHref, { scroll: false });
      /*
       * And again, once the navigation has redrawn what is underneath.
       *
       * Focusing before the push is right for the common case and useless when
       * React replaces the row while rendering the new URL: focus falls back to
       * the body and nothing says so. This re-applies it over the next few
       * frames — and only while nothing else has claimed the caret, so it can
       * never take focus away from whatever the person did next.
       */
      /*
       * Watch the page settle rather than guess how long it will take.
       *
       * This used to be a loop of twelve animation frames that stopped at the
       * first success. Both halves were wrong. Frames are not a unit of
       * progress — they are a unit of time, and they stretch exactly when the
       * render being waited for is slow — and stopping on success meant a
       * re-render arriving AFTER the caret was put back took it away again
       * with nothing left running to notice. That was one shape of the
       * failure: `goals-v33` lost the caret about once per full suite run and
       * never once on its own. v164 found the rest of it outside this file: a
       * `Modal` closing a moment earlier took the caret back and handed this
       * drawer the wrong opener.
       *
       * So: observe the DOM for a bounded time, and re-apply whenever the
       * caret is loose. It stops as soon as anything a person could have
       * chosen holds it, which is the one thing this must never override.
       */
      const deadline = performance.now() + 1500;
      let observer: MutationObserver | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;

      let watching = true;
      const stop = () => {
        watching = false;
        observer?.disconnect();
        observer = null;
        if (timer) clearTimeout(timer);
        timer = null;
        settleStop.current = null;
      };
      settleStop.current = stop;

      const attempt = () => {
        const owner = document.activeElement;
        const live = liveTrigger();

        /*
         * Already where it belongs — but keep watching.
         *
         * This is the case the old loop got wrong. It stopped at the first
         * success, so a re-render arriving afterwards replaced the row, the
         * caret fell to the body, and nothing was left running to notice.
         */
        if (owner && live && owner === live) {
          if (performance.now() >= deadline) stop();
          return;
        }

        /*
         * Loose means nobody meaningful holds it: nothing, the document, or a
         * container parked there by a navigation. The closing panel counts as
         * loose too — it is `tabindex="-1"` and about to be removed.
         */
        const loose =
          !owner ||
          owner === document.body ||
          owner === document.documentElement ||
          (owner instanceof HTMLElement && owner.tabIndex === -1 && owner !== triggerRef.current);
        if (!loose) {
          // Somewhere a person could have put it. Never take it back.
          stop();
          return;
        }

        restoreFocus();
        if (performance.now() >= deadline) stop();
      };

      attempt();
      if (watching) {
        observer = new MutationObserver(attempt);
        observer.observe(document.body, { childList: true, subtree: true });
        timer = setTimeout(stop, 1500);
      }
    }, 245);
  }, [closeHref, focusIsLoose, liveTrigger, restoreFocus, router]);

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
