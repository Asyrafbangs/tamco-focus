import Link from 'next/link';

import { GuestTopBar } from '@/components/esh/guest/GuestTopBar';

/** After End access on this device (§10). */
export default function EndedPage() {
  return (
    <>
      <GuestTopBar identity="Secure access" />
      <main id="guest-main" className="guest-main guest-main-narrow">
        <section className="guest-card" aria-labelledby="guest-ended-title" role="status">
          <span className="guest-card-icon" aria-hidden="true">
            ✓
          </span>
          <h1 id="guest-ended-title">Access ended on this device</h1>
          <p className="guest-lead">
            Nothing about your actions can be opened from this browser now. Your work and the
            conversation are kept.
          </p>
          <Link href="/respond/request-link" className="guest-link">
            Need to get back in? Ask for a new link
          </Link>
        </section>
      </main>
    </>
  );
}
