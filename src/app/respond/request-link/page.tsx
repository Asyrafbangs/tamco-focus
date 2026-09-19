import { GuestTopBar } from '@/components/esh/guest/GuestTopBar';
import { RequestLinkForm } from '@/components/esh/guest/RequestLinkForm';

/** Ask for a new link with only an email address (§19). */
export default function RequestLinkPage() {
  return (
    <>
      <GuestTopBar identity="Secure access" />
      <main id="guest-main" className="guest-main guest-main-narrow">
        <section className="guest-card" aria-labelledby="guest-request-title">
          <span className="guest-card-icon" aria-hidden="true">
            ↗
          </span>
          <h1 id="guest-request-title">Let’s get you a fresh link</h1>
          <p className="guest-lead">
            Enter the email address your actions were assigned to. We will send a secure link to it.
          </p>
          <RequestLinkForm />
        </section>
      </main>
    </>
  );
}
