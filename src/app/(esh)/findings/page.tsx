import { redirect } from 'next/navigation';

/**
 * The module's entry. The ESH Overview (§33) becomes the default in the stage
 * that builds it; until then the Register is where the work is.
 */
export default function FindingsEntryPage() {
  redirect('/findings/register');
}
