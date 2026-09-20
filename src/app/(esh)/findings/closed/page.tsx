import { redirect } from 'next/navigation';

/** Preserve the v200 deep link while Closed becomes a canonical Register view. */
export default async function ClosedFindingsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; period?: string; page?: string }>;
}) {
  const old = await searchParams;
  const next = new URLSearchParams({ filter: 'closed' });
  if (old.q) next.set('q', old.q.slice(0, 80));
  if (old.period) next.set('period', old.period);
  if (old.page) next.set('page', old.page);
  redirect(`/findings/register?${next}`);
}
