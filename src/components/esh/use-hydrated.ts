'use client';

import { useSyncExternalStore } from 'react';

/** Nothing to subscribe to: the value changes once, at hydration. */
const never = () => () => {};

/**
 * v306 — whether this component's JavaScript is actually running yet.
 *
 * The message composers are client components: a controlled textarea backed by
 * `useState`, and a `<form>` whose `onSubmit` calls `preventDefault()` and
 * sends through a transition. None of that exists until React has hydrated,
 * and the form carries no `action`, so a submit button pressed before then
 * does the one thing nobody wants — a **native** form submission. The browser
 * re-requests the same address, the page comes back blank, and the message the
 * owner typed is gone. No error, no draft, nothing saved: `esh_action_messages`
 * never receives a row.
 *
 * It is a narrow window, and it is the window a real Action Owner is most
 * likely to be standing in. They arrive from an email, on a phone, on factory
 * wifi, and they type immediately because the page already looks finished —
 * the heading, what ESH needs, and the composer are all server-rendered.
 *
 * Gating the submit controls on this closes it. A disabled button cannot
 * submit a form natively, so the worst case becomes a press that does nothing
 * for a moment with the typed text still on screen, rather than a press that
 * silently throws the message away.
 *
 * Written with `useSyncExternalStore` rather than state set from an effect:
 * the two snapshots say exactly what the hook means — the server's answer is
 * "not running", the client's is "running" — and React switches between them
 * at hydration with no second render pass.
 *
 * It also makes the browser suite honest without a single `waitFor` added to
 * it. Playwright waits for a control to be enabled before clicking, so those
 * tests now wait for the thing they always should have waited for.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}
