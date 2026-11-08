import { LoadingSkeleton } from '@/components/ui/ParityPrimitives';

export default function GoalsLoading() {
  return (
    <>
      <div className="pagehead">
        <div>
          {/* v305 — the same label the loaded page shows. It read "GOALS"
              above "Goals", so the skeleton restated the heading AND differed
              from the head it stands in for. */}
          <p className="eyebrow">Performance and development</p>
          <h1>Goals</h1>
          <p>Loading agreed outcomes and milestones.</p>
        </div>
      </div>
      {/*
        Deliberately NOT `.goal-list-panel`. Sharing that class made the
        skeleton indistinguishable from the real list — both matched the same
        selector, so a test (and a screen reader walking the tree) could see two
        goal panels during the Suspense hand-off. It keeps the panel's visual
        styling through the skeleton modifier in globals.css.
      */}
      <section className="goal-list-panel-skeleton" aria-hidden="true">
        <LoadingSkeleton rows={5} label="Loading Goals" />
      </section>
    </>
  );
}
