import { FindingNav } from '@/components/esh/FindingNav';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';

/**
 * Every Finding Management page sits behind the rollout gate: without access
 * the route does not exist (§43.3, FM103). The database refuses the data as
 * well; this only keeps the page from rendering around nothing.
 */
export default async function FindingsLayout({ children }: { children: React.ReactNode }) {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  return (
    <div className="esh-module">
      <FindingNav
        // v227 - an administrator sets owner email there.
        canManageSettings={
          access.canVerify || access.canManageReports || profile.role === 'administrator'
        }
      />
      <main id="esh-main" className="esh-content">
        {children}
      </main>
    </div>
  );
}
