import { AccessExchange } from '@/components/esh/guest/AccessExchange';
import { GuestTopBar } from '@/components/esh/guest/GuestTopBar';
import { guestSecret } from '@/server/esh/guest';

/**
 * Where an emailed link lands (§19). A GET here spends nothing and reads
 * nothing about the link: the secret is in the fragment, which never reaches
 * the server. Whether this browser already holds a session is the only thing
 * the page is told, so a returning owner can skip the button.
 */
export default async function AccessPage({
  searchParams,
}: {
  searchParams: Promise<{ for?: string }>;
}) {
  const query = await searchParams;
  const hasSession = Boolean(await guestSecret());
  return (
    <>
      <GuestTopBar identity="Secure access" />
      <main id="guest-main" className="guest-main guest-main-narrow">
        <AccessExchange
          purpose={query.for === 'actions' ? 'actions' : 'action'}
          hasSession={hasSession}
        />
      </main>
    </>
  );
}
