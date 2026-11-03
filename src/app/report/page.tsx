import { publicQrIntakeNoCode, publicQrIntakeUnavailable } from '@/domain/esh-qr-intake';

/**
 * `/report` with no code (v288).
 *
 * The QR codes carry `/report/<code>`, so this address is only reached by
 * somebody who typed it or followed an old link. It cannot offer a list of
 * locations — that would publish the plant's own layout to anybody who asks —
 * so it says where the code is and repeats the one line that matters.
 */
export default function PublicReportIndexPage() {
  return (
    <main className="public-report-shell" id="public-report">
      <h1>{publicQrIntakeNoCode.title}</h1>
      <p>{publicQrIntakeNoCode.detail}</p>
      <p className="notice warn">{publicQrIntakeUnavailable.immediateDanger}</p>
    </main>
  );
}
