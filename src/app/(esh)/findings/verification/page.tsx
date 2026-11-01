import { redirect } from 'next/navigation';

/** Preserve the established URL while Today owns the verification queue. */
export default async function VerificationPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const query = await searchParams;
  const params = new URLSearchParams({ queue: 'verification' });
  if (query.department) params.set('department', query.department);
  redirect(`/findings?${params}`);
}
