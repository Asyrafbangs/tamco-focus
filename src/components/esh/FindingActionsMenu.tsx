'use client';

import { useState } from 'react';

/**
 * The finding's administrative controls, out of sight until wanted (§13).
 *
 * Changing an owner, a deadline or a priority, recording an administrative
 * outcome and reopening a closed finding are all real capabilities and all
 * rare. Standing permanently on the page they competed with the work.
 *
 * They open as a panel in the flow rather than a floating menu: these are
 * whole forms, not menu items, and a form taller than the screen floated above
 * a header that scrolls away puts its own submit button where nothing can
 * reach it. Nothing closes the panel while it is being used; pressing the
 * button again puts it away.
 */
export function FindingActionsMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn"
        aria-expanded={open}
        aria-label="More actions for this finding"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open && <div className="esh-finding-menu-panel">{children}</div>}
    </>
  );
}
