import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ImportReview } from '@/components/esh/ImportReview';
import { requireEshAccess } from '@/server/esh/access';
import { loadImportBatch } from '@/server/esh/import';
import { getHeldSummary } from '@/server/esh/queries';

/** One staged backlog: what came in, what it needs, and what is released (§38.2). */
export default async function ImportBatchPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  await requireEshAccess('coordinate');
  const { batchId } = await params;
  const [batch, held] = await Promise.all([loadImportBatch(batchId), getHeldSummary()]);
  if (!batch) notFound();

  const captured = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kuala_Lumpur',
  }).format(new Date(batch.createdAt));

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">
            <Link href="/findings/import">Imports</Link>
          </p>
          <h1>{batch.sourceName}</h1>
          <p>
            {batch.sourceRegister}
            {batch.sheetName ? ` · ${batch.sheetName}` : ''} · headings on row{' '}
            {batch.headerLine ?? 1} · dates read{' '}
            {batch.dateConvention === 'mdy'
              ? 'month first'
              : batch.dateConvention === 'iso'
                ? 'year first'
                : 'day first'}{' '}
            · uploaded {captured}
          </p>
        </div>
      </div>

      <ImportReview batch={batch} ownerEmailMode={held?.mode ?? 'held'} />
    </>
  );
}
