import { redirect } from 'next/navigation';

/** A stable deep link into the Register with Closed selected (§4). */
export default function ClosedFindingsPage() {
  redirect('/findings/register?filter=closed');
}
