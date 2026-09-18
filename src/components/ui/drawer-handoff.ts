'use client';

import type { DrawerKind } from '@/domain/drawer-links';

/**
 * The drawer that is on its way, shared by the placeholder that stands in for
 * it and the real drawer that takes its place (v195).
 *
 * One at a time, and module state rather than context: the placeholder lives
 * in the application shell and the drawer deep inside a page, and the drawer
 * has to know on its very first render whether it is arriving onto a screen
 * that already shows it — a context update would come a render too late.
 */

export type PendingDrawer = {
  kind: DrawerKind;
  id: string;
  title: string | null;
  /** The address it was pressed on, to go back to if it is cancelled. */
  from: string;
};

let pending: PendingDrawer | null = null;
/** The placeholder's panel, so the drawer can carry on from where it got to. */
let pendingPanel: HTMLElement | null = null;
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

export function subscribePendingDrawer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function pendingDrawer(): PendingDrawer | null {
  return pending;
}

export function showPendingDrawer(next: PendingDrawer) {
  pending = next;
  announce();
}

export function clearPendingDrawer() {
  if (!pending) return;
  pending = null;
  pendingPanel = null;
  announce();
}

export function registerPendingPanel(panel: HTMLElement | null) {
  pendingPanel = panel;
}

/**
 * Takes the placeholder's place, if one is on screen.
 *
 * Returns where its panel had got to — a computed transform, part-way through
 * sliding in — so the drawer can finish that movement instead of jumping to
 * the end of it or starting it again. Null when there was nothing to take over.
 */
export function takeOverPendingDrawer(): string | null {
  if (!pending) return null;
  const transform = pendingPanel ? getComputedStyle(pendingPanel).transform : 'none';
  clearPendingDrawer();
  return transform;
}
