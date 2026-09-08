/**
 * Contextual drawers as navigation layers (v48 sections 3-8).
 *
 * A drawer opens on top of something. Closing it should reveal what was
 * underneath — the same list, the same filter, the same person, scrolled where
 * it was. The Task Detail drawer instead closed to a hardcoded `/work`, which
 * meant a manager who opened somebody's task from My Team landed back in My
 * Work: not merely the wrong tab, a different person's workspace.
 *
 * The fix is to stop letting the deepest layer decide where "back" is. Each
 * layer is a search parameter, and closing one removes only its own:
 *
 *   /work?scope=team&filter=attention&person=IZZAH&task=T1
 *     close task    → /work?scope=team&filter=attention&person=IZZAH
 *     close person  → /work?scope=team&filter=attention
 *
 * Every layer beneath is preserved because nothing had to remember it — it was
 * never thrown away. That is also why this is a plain URL function rather than
 * a history stack: the state is in the address, so a refresh, a bookmark and a
 * shared link all restore the same view.
 */

/** Parameters that describe the layer a drawer sits on, not the drawer itself. */
export type LayerParams = Record<string, string | number | null | undefined>;

/**
 * The href that closes one layer: the current parameters, minus the ones that
 * belong to the layer being closed.
 *
 * Empty and null values are dropped so the URL never carries `&person=` with
 * nothing after it.
 */
export function closeLayerHref(basePath: string, params: LayerParams, remove: string[]): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (remove.includes(key)) continue;
    if (value === null || value === undefined) continue;
    const text = String(value);
    if (text.length === 0) continue;
    search.set(key, text);
  }

  const query = search.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * The parameters that belong to the Task Detail layer.
 *
 * `attention` and `barrier` travel with the task drawer — they say which
 * request to expand inside it — so closing the task must drop them too, or the
 * next task opened from the same list would inherit somebody else's barrier.
 */
export const TASK_LAYER_PARAMS = ['task', 'attention', 'barrier', 'item'] as const;

/*
  There is no Team Member Detail layer to close.

  `person` was a drawer parameter until v143 and had a list of its own here.
  §6 made it an expansion inside My Team: nothing closes it but the header that
  opened it. The one layer that used to sit over a person — `review=workload`,
  the workload review — went with the focus target in v144.
*/

/**
 * A link that opens the task drawer and remembers where it was opened from
 * (v48 §8).
 *
 * Every screen in the product can open a task: My Day, Plan, Routine, Archive,
 * Attachments, Audit, Records. They all linked to `/work?task=…`, so closing
 * the drawer returned to My Work's Active tab — somebody reading the audit log
 * opened one entry and was moved to a different workspace, and had to navigate
 * back and find their place again.
 *
 * The origin travels in the link rather than being guessed on the way out,
 * because by then the only thing the drawer knows is its own URL.
 */
export function taskDrawerHref(taskId: string, from: string): string {
  return `/work?task=${encodeURIComponent(taskId)}&from=${encodeURIComponent(from)}`;
}

/**
 * Where closing the drawer should go.
 *
 * Only internal paths are honoured. `from` arrives from the address bar, so an
 * absolute URL there would turn every task link into an open redirect — a
 * phishing step wearing the application's own domain. A protocol-relative
 * `//evil.example` is the case people forget, hence the second check.
 */
export function safeReturnPath(from: string | undefined, fallback: string): string {
  if (!from) return fallback;
  if (!from.startsWith('/') || from.startsWith('//') || from.includes('\\')) return fallback;

  try {
    const internalOrigin = 'https://tamco-focus.invalid';
    const target = new URL(from, internalOrigin);
    if (target.origin !== internalOrigin) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
