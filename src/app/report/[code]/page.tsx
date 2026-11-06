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
      <p className="public-report-lead">{PUBLIC_REPORT_COPY.lead}</p>
      {/*
       * v293 - where, before what. The sticker has already answered the
       * question an employee would otherwise be asked to answer, and showing
       * it here is what stops the form asking for a department or a location
       * further down.
       */}
      <p className="public-report-where">
        <span className="public-report-pin" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
            <path
              d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>
        <span>
          <strong>{location.label}</strong>
          <small>{PUBLIC_REPORT_COPY.locationHint}</small>
        </span>
      </p>
      {/*
       * §6, near the top rather than the bottom: this is not an emergency
       * channel, and somebody scanning a code while looking at something
       * dangerous needs to be told that before they start typing.
       */}
      <p className="notice warn public-report-emergency">{PUBLIC_REPORT_COPY.emergency}</p>
      <PublicReportForm code={location.code} />
    </main>
  );
}
