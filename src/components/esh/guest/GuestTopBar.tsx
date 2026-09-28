import Link from 'next/link';

import { endGuestAccess } from '@/server/esh/guest-actions';

/**
 * The guest pages' only chrome (§10, §11): the ESH mark and who this page
 * is for. No module switcher, no way into the staff application.
 *
 * v227 - a signed-in owner also gets My Actions and their address as a quiet
 * menu holding "End access on this device". It had been a button floating at
 * the bottom of every page, where nobody looks for it and anybody scrolls
 * past it.
 */
export function GuestTopBar({
  identity,
  signedIn,
}: {
  identity: string;
  /** A live session: the address shown, and whether My Actions is theirs to open. */
  signedIn?: { email: string; inbox: boolean };
}) {
  return (
    <header className="guest-topbar">
      <span className="guest-brand">
        <span className="esh-brand-mark" aria-hidden="true">
          E
        </span>
        <span>TAMCO ESH</span>
      </span>
      {signedIn ? (
        <nav className="guest-topnav" aria-label="Your access">
          {signedIn.inbox && (
            <Link href="/respond/my-actions" className="guest-topnav-link">
              My Actions
            </Link>
          )}
          <details className="guest-account">
            <summary>
              <span className="guest-account-email">{signedIn.email}</span>
              <span aria-hidden="true">▾</span>
            </summary>
            <div className="guest-account-menu">
              <p>{identity}</p>
              <form action={endGuestAccess}>
                <button type="submit" className="btn ghost small">
                  End access on this device
                </button>
              </form>
            </div>
          </details>
        </nav>
      ) : (
        <span className="guest-identity">{identity}</span>
      )}
    </header>
  );
}
