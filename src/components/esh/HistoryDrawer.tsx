'use client';

import { useRef } from 'react';

/**
 * The whole record, when somebody asks for it (v227, §21).
 *
 * The page says what happened last; this holds everything else — every event
 * in order and the delivery log — in a drawer over the page, so reading the
 * history never pushes the work off the screen.
 */
export function HistoryDrawer({
  label,
  children,
}: {
  /** What the button says: "View full history". */
  label: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className="btn ghost small"
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {label}
      </button>
      <dialog ref={dialog} className="esh-drawer" aria-labelledby="esh-drawer-title">
        <div className="esh-drawer-head">
          <h2 id="esh-drawer-title">Full history</h2>
          <button type="button" className="btn ghost small" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        <div className="esh-drawer-body">{children}</div>
      </dialog>
    </>
  );
}
