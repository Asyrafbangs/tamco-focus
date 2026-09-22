import { redirect } from 'next/navigation';

/** v203 — preserve old bookmarks while contacts move into the one people directory. */
export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ contact?: string; q?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ type: 'contacts' });
  if (params.contact) query.set('contact', params.contact);
  if (params.q) query.set('q', params.q);
  redirect(`/more/admin/users?${query.toString()}`);
}
