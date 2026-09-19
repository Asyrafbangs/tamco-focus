import type { Metadata } from 'next';

/**
 * The Action Owner's pages (v198, §10, §11, §19): reached from an email link,
 * with no account and none of the application around them. Never indexed,
 * never cached, and no address from here is passed on as a referrer (§18);
 * `next.config.ts` sends the same as headers.
 */
export const metadata: Metadata = {
  title: 'TAMCO ESH',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return <div className="guest-app">{children}</div>;
}
