import { HeldNoticesRelease } from '@/components/esh/HeldNoticesRelease';
import type { RolloutStatus } from '@/domain/esh-rollout';

/**
 * Held email, said once for the whole register (v227, §43.4).
 *
 * It replaces "Owner not told yet" on every row it affected. Nothing is shown
 * while nothing is held, so in normal operation this line does not exist. The
 * release itself is v224's one-press release, unchanged.
 *
 * Which is why `failed` is separate: showing nothing is this line's way of
 * saying no owner is waiting to be told, and a read that failed cannot say
 * that. It is a smaller version of the same error the rest of this change is
 * about, and it goes the same way.
 */
export function HeldEmailNotice({
  status,
  failed = false,
}: {
  status: RolloutStatus | null;
  failed?: boolean;
}) {
  if (failed) {
    return (
      <div className="notice warn esh-held-notice" role="status">
        <p>
          <strong>Held email could not be counted</strong> · Whether any owner is still waiting to
          be told is unknown.
        </p>
      </div>
    );
  }
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
