import { LoadingSkeleton } from '@/components/ui/ParityPrimitives';

/**
 * Loading state for every authenticated workspace that has not declared its
 * own.
 *
 * Only Goals had one, so the other thirteen routes rendered nothing at all
 * while their data resolved — the previous page simply sat there, apparently
 * ignoring the click, until the new one replaced it. On a cold database read
 * that gap is long enough for somebody to click again.
 *
 * A route with a more specific skeleton (Goals) still wins; this is the floor,
 * not a ceiling. It deliberately does not guess at page structure, because a
 * skeleton that mimics the wrong layout is worse than one that plainly says
 * "loading" — it promises a shape the page will not have.
 */
export default function WorkspaceLoading() {
  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Loading</p>
          <h1>One moment</h1>
          <p>Reading your work.</p>
        </div>
      </div>
      <LoadingSkeleton rows={4} label="Loading workspace" />
    </>
  );
}
