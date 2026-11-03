import { PublicReportForm } from '@/components/esh/PublicReportForm';
import { PUBLIC_REPORT_COPY } from '@/domain/esh-public-report';
import { publicQrIntakeUnavailable } from '@/domain/esh-qr-intake';
import { publicLocationFor } from '@/server/esh/public-report';

/**
 * One QR code's reporting page (v288, §2).
 *
 * The address on a sticker. Nothing here is behind a sign-in, so the page is
 * deliberately thin: it resolves the code, and either shows the form or says
 * plainly that this link does not report anything. There is no third state —
 * a half-working form on a closed channel would collect observations nobody
 * receives.
 *
 * `force-dynamic` because the answer depends on a switch an administrator can
 * move, and a cached "closed" page would outlive the decision to open it.
 */
export const dynamic = 'force-dynamic';

/** A sticker's code, which is all this page trusts from the address bar. */
const CODE = /^[A-Za-z0-9_-]{8,64}$/;

export default async function PublicReportPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const location = CODE.test(code) ? await publicLocationFor(code) : null;

  if (!location) {
    return (
      <main className="public-report-shell" id="public-report">
        <h1>{publicQrIntakeUnavailable.title}</h1>
        <p>{publicQrIntakeUnavailable.detail}</p>
        <p className="notice warn">{publicQrIntakeUnavailable.immediateDanger}</p>
      </main>
    );
  }

  return (
    <main className="public-report-shell" id="public-report">
      <h1>{PUBLIC_REPORT_COPY.heading}</h1>
      <p>{PUBLIC_REPORT_COPY.lead}</p>
      {/*
       * §6, and the first thing on the page rather than the last: this is not
       * an emergency channel, and somebody scanning a code while looking at
       * something dangerous needs to be told that before they start typing.
       */}
      <p className="notice warn public-report-emergency">{PUBLIC_REPORT_COPY.emergency}</p>
      <PublicReportForm code={location.code} label={location.label} />
    </main>
  );
}
