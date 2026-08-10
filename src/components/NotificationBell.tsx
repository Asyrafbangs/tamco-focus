'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import type { NotificationEntry } from '@/server/queries';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/server/actions/notification-actions';

/**
 * The notification bell (v42 sections M, N, P).
 *
 * The count is unread AND actionable, never "things that happened". A badge
 * that counts events trains people to ignore it within a week; a badge that
 * counts things waiting on them stays worth looking at. That narrowing happens
 * where notifications are created — this component only reports it.
 *
 * Every entry opens the record it is about rather than a notification centre,
 * because "you have a message about a barrier" is not useful on its own; the
 * barrier is.
 */
export function NotificationBell({
  notifications,
  unreadActionable,
}: {
  notifications: NotificationEntry[];
  unreadActionable: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /*
   * Both actions used to be awaited and discarded. Marking one read failing
   * quietly is survivable — it stays unread, which is the safe direction — but
   * "Mark all read" failing silently means the click does nothing and says
   * nothing, so the only available reading is that the control is broken.
   */
  const [failure, setFailure] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function openEntry(entry: NotificationEntry) {
    setOpen(false);
    // Reading is not doing: this clears the pointer, never the work.
    if (!entry.readAt) {
      startTransition(async () => {
        const result = await markNotificationRead({ notificationId: entry.id });
        // Navigation has already happened by now, so there is nowhere useful to
        // show this. Leaving it unread is the correct failure: the item stays
        // in the list rather than vanishing without having been recorded.
        if (!result.ok) console.error('[NotificationBell] mark read failed', result.message);
      });
    }
    router.push(entry.href);
  }

  return (
    <div className="notification-bell">
      <button
        ref={buttonRef}
        type="button"
        className="notification-bell-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unreadActionable > 0
            ? `Notifications, ${unreadActionable} needing action`
            : 'Notifications, none needing action'
        }
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">🔔</span>
        {unreadActionable > 0 && (
          <span className="notification-bell-count" aria-hidden="true">
            {unreadActionable}
          </span>
        )}
      </button>

      {open && (
        <div ref={panelRef} className="notification-panel" role="dialog" aria-label="Notifications">
          <header>
            <div>
              <strong>Notifications</strong>
              <span>Meaningful requests and changes</span>
            </div>
            {notifications.some((entry) => !entry.readAt) && (
              <button
                type="button"
                className="btn small ghost"
                onClick={() =>
                  startTransition(async () => {
                    setFailure(null);
                    const result = await markAllNotificationsRead();
                    if (!result.ok) {
                      setFailure(result.message);
                      return;
                    }
                    router.refresh();
                  })
                }
              >
                Mark all read
              </button>
            )}
          </header>

          {failure && (
            <p className="notification-empty" role="alert">
              {failure} Nothing was marked as read.
            </p>
          )}

          {notifications.length === 0 ? (
            <p className="notification-empty">
              Nothing needs your attention. You are notified when something changes that you have to
              know about or act on — not for every event.
            </p>
          ) : (
            <ul>
              {notifications.map((entry) => (
                <li key={entry.id} className={entry.readAt ? 'read' : undefined}>
                  <button type="button" onClick={() => openEntry(entry)}>
                    <span className="notification-title">
                      {!entry.readAt && (
                        <span className="notification-dot" aria-hidden="true">
                          ●
                        </span>
                      )}
                      {entry.title}
                    </span>
                    <span className="notification-body">{entry.body}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <footer>
            <Link href="/today" onClick={() => setOpen(false)}>
              Go to My Day
            </Link>
          </footer>
        </div>
      )}
    </div>
  );
}
