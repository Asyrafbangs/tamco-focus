import Link from 'next/link';

import { ImportSteps } from '@/components/esh/ImportSteps';
import { ImportWizard } from '@/components/esh/ImportWizard';
import { requireEshAccess } from '@/server/esh/access';
import { listImportBatches } from '@/server/esh/import';

/**
 * Backlog imports (§38, screen 09).
 *
 * One guided flow, reached from the Register rather than living in the daily
 * navigation: importing a backlog is something ESH does a few times, not every
 * morning.
 */
export default async function FindingImportPage() {
  await requireEshAccess('coordinate');
  const batches = await listImportBatches();

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Import a backlog</h1>
          <p>
            Bring an existing register in without retyping it. Rows are staged, reconciled and
            released deliberately; nothing is live or notified until you release it.
          </p>
        </div>
      </div>

      <ImportSteps current={1} />

      <ImportWizard />

      <section className="card" aria-labelledby="import-history">
        <h2 id="import-history">Imports</h2>
        {batches.length === 0 ? (
          <p className="empty">No backlog has been imported yet.</p>
        ) : (
          <ul className="esh-import-list">
            {batches.map((batch) => (
              <li key={batch.id}>
                <Link href={`/findings/import/${batch.id}`}>
                  <strong>{batch.sourceName}</strong>
                  <span>
                    {batch.sourceRegister}
                    {batch.sheetName ? ` · ${batch.sheetName}` : ''} · {batch.sourceRows} rows
                  </span>
                  <small>
                    {batch.state === 'released'
                      ? `Released — ${batch.released} findings`
                      : `Staged — ${batch.ready} ready, ${batch.blocked} need a decision`}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
