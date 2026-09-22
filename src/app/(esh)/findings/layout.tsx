import { FindingNav } from '@/components/esh/FindingNav';
import { requireEshAccess } from '@/server/esh/access';
import { countAwaitingVerification } from '@/server/esh/queries';

/**
 * Every Finding Management page sits behind the rollout gate: without access
 * the route does not exist (§43.3, FM103). The database refuses the data as
 * well; this only keeps the page from rendering around nothing.
 */
export default async function FindingsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireEshAccess();
  // v200 - how much is waiting for ESH, counted by the same rule the queue uses.
  const waitingToVerify = await countAwaitingVerification();
  return (
    <div className="esh-module">
      <FindingNav
        waitingToVerify={waitingToVerify}
        canManageSettings={access.canVerify || access.canManageReports}
      />
      <main id="esh-main" className="esh-content">
        {children}
      </main>
    </div>
  );
}
