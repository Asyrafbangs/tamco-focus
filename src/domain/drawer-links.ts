/**
 * Which drawer a link opens over the page it is pressed on, if any (v195).
 *
 * Opening a task, a proposal or a goal is a navigation: the address gains
 * `?task=`, and the server renders the whole page again with the drawer in it.
 * Nothing moved on screen until that answer arrived, so on a slow connection a
 * press looked ignored and was often pressed again. A drawer can start sliding
 * in the moment it is pressed — but only for a link that will really put one
 * on this page, which is what this decides.
 *
 * Only the same page qualifies. A link to another page (My Day to a task, say)
 * swaps the page underneath through its loading state first, so there is no
 * single moment at which "the drawer did not come" can be told apart from "the
 * drawer is still coming".
 *
 * Pure, so it can be tested without a browser.
 */

export type DrawerKind = 'task' | 'proposal' | 'goal';

/** The parameter that names each page's drawer, in the order it is read. */
const DRAWER_PARAMETERS: Record<string, DrawerKind[]> = {
  '/work': ['task', 'proposal'],
  '/goals': ['goal'],
};

export function drawerOpenedBy(target: URL, current: URL): { kind: DrawerKind; id: string } | null {
  if (target.origin !== current.origin || target.pathname !== current.pathname) return null;

  for (const kind of DRAWER_PARAMETERS[target.pathname] ?? []) {
    const id = target.searchParams.get(kind);
    if (!id) continue;
    /*
     * The drawer already open is not opened again: a link inside it that moves
     * to one of its sections keeps the same drawer, and pressing the row of a
     * drawer that is closing brings that one back (v194). Either way, nothing
     * new would arrive to take the placeholder's place.
     */
    if (id === current.searchParams.get(kind)) return null;
    return { kind, id };
  }
  return null;
}

/**
 * What to call the drawer while its content is on the way.
 *
 * Rows name themselves "Open <title>" for assistive technology, which is the
 * cleanest source; otherwise the link's own words. Null when neither says
 * anything useful, and the placeholder then says only that it is opening.
 */
export function drawerTitleFrom(ariaLabel: string | null, text: string | null): string | null {
  const labelled = ariaLabel
    ?.trim()
    .match(/^Open\s+(.+)$/i)?.[1]
    ?.trim();
  if (labelled) return labelled.slice(0, 160);
  const spoken = text?.replace(/\s+/g, ' ').trim();
  return spoken ? spoken.slice(0, 160) : null;
}
