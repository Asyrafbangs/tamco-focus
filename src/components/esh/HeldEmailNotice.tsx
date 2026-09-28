import { HeldNoticesRelease } from '@/components/esh/HeldNoticesRelease';
import type { RolloutStatus } from '@/domain/esh-rollout';

/**
 * Held email, said once for the whole register (v227, §43.4).
 *
 * It replaces "Owner not told yet" on every row it affected. Nothing is shown
 * while nothing is held, so in normal operation this line does not exist. The
 * release itself is v224's one-press release, unchanged.
 */
export function HeldEmailNotice({ status }: { status: RolloutStatus | null }) {
  if (!status || status.held === 0) return null;
  const count = status.held;

  return (
    <div className="notice warn esh-held-notice" role="status">
      <p>
        <strong>
          {count} email{count === 1 ? ' is' : 's are'} being held
        </strong>
        {status.mode === 'restricted'
          ? ' · The rollout is restricted, so email waits for each contact to be cleared.'
          : ' · Held from before the rollout went live.'}
      </p>
      <HeldNoticesRelease releasable={status.heldReleasable} />
    </div>
  );
}
