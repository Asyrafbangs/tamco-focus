import { redirect } from 'next/navigation';

/**
 * Visibility rules moved onto the person they describe.
 *
 * This screen edited exactly the same policy and grants as the User directory
 * now does, from the other end: it asked "who is the viewer?" first, so
 * arranging "Amer may see Izzah and Ajmal" meant leaving Amer's record, finding
 * him again in a second list, and knowing that the admin word for him is
 * "viewer". Two screens for one decision is how the two of them disagreed.
 *
 * Kept as a redirect rather than deleted: the path was linked from the More
 * menu and may be bookmarked, and a 404 is a worse answer than the page that
 * replaced it.
 */
export default async function VisibilityRedirect({
  searchParams,
}: {
  searchParams: Promise<{ viewer?: string }>;
}) {
  const params = await searchParams;
  redirect(params.viewer ? `/more/admin/users?user=${params.viewer}` : '/more/admin/users');
}
