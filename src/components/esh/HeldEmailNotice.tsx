import Link from 'next/link';

import { ReleaseAllButton } from '@/components/esh/ReleaseAllButton';
import { heldSentence, type HeldSummary } from '@/domain/esh-owner-email';

/**
 * Held owner email, said once for the whole system (v223, §43.4).
 *
 * It replaces "Owner not told yet" on every row it affected. Nothing is shown
 * while nothing is held, so in normal operation this line does not exist.
 */
export function HeldEmailNotice({
  summary,
  isAdministrator,
}: {
  summary: HeldSummary | null;
  isAdministrator: boolean;
}) {
  const sentence = heldSentence(summary);
  if (!summary || !sentence) return null;
  const releasable = summary.recipients - summary.switchedOff;

  return (
    <div className="notice warn esh-held-notice" role="status">
      <p>
        <strong>{sentence}</strong>
        {summary.mode === 'held'
          ? ' · Owner email is in Test mode.'
          : ' · Held from before owner email went Live.'}
        {summary.switchedOff > 0 &&
          ` ${summary.switchedOff} ${summary.switchedOff === 1 ? 'person is' : 'people are'} switched off and stay held.`}
      </p>
      {isAdministrator ? (
        <span className="esh-held-actions">
          {releasable > 0 && <ReleaseAllButton />}
          <Link href="/findings/settings#owner-email" className="btn ghost small">
            Owner email settings
          </Link>
        </span>
      ) : (
        <small>An administrator releases them from Finding settings.</small>
      )}
    </div>
  );
}
