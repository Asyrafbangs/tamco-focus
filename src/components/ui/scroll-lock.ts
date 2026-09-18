'use client';

/**
 * One scroll lock for every overlay, counted.
 *
 * Reported on 18 September 2026: opening the task window many times left the
 * page unable to scroll until it was reloaded. Both overlays held the lock the
 * same way — save `document.body.style.overflow`, set `hidden`, put the saved
 * value back on unmount — and that is wrong whenever two of them overlap:
 *
 * - a dialog inside the drawer saves `hidden`, because the drawer set it. When
 *   the drawer is closed underneath the dialog, React runs the drawer's
 *   cleanup first: the drawer restores the scrollable value, then the dialog
 *   restores `hidden`, and nothing is left on screen to undo it;
 * - the same happens when a second drawer opens while the first is still
 *   sliding out, which is what repeated opening does.
 *
 * Counting fixes both: the first lock records what the page had, every later
 * one only adds to the count, and the page is restored when the last releases.
 * Releasing twice is harmless, so a component may release in cleanup without
 * checking whether it already has.
 */

let holders = 0;
let restoreTo = '';

/** Locks page scrolling and returns the release for this holder. */
export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {};

  if (holders === 0) {
    restoreTo = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  holders += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) document.body.style.overflow = restoreTo;
  };
}

/** How many overlays hold the lock. For tests. */
export function bodyScrollHolders(): number {
  return holders;
}
