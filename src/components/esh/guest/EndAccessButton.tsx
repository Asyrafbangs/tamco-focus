import { endGuestAccess } from '@/server/esh/guest-actions';

/** For a shared or borrowed device (§10): ends this session everywhere at once. */
export function EndAccessButton() {
  return (
    <form action={endGuestAccess} className="guest-end-access">
      <button type="submit" className="btn ghost small">
        End access on this device
      </button>
    </form>
  );
}
