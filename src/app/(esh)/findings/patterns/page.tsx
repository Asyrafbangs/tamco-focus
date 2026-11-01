import Link from 'next/link';

import { requireEshAccess } from '@/server/esh/access';

/**
 * Relationships and category data arrive in Stage 3/4. Until then, say that
 * plainly while retaining the pre-existing analytical screens behind a
 * descriptive route.
 */
export default async function PatternsPage() {
  await requireEshAccess();
  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Finding Management</p>
          <h1>Patterns</h1>
          <p>Recurring issues will appear after ESH has reviewed categories and links.</p>
        </div>
      </div>
      <section className="esh-form-card esh-pattern-empty" aria-labelledby="patterns-coming-title">
        <h2 id="patterns-coming-title">No reviewed patterns yet</h2>
        <p>
          Categories, recurrence links and pattern decisions are introduced in later approved
          stages. This page does not infer a cause from titles, locations or a small number of
          observations.
        </p>
        <Link className="btn" href="/findings/patterns/insights">
          Open historical insights
        </Link>
      </section>
    </>
  );
}
