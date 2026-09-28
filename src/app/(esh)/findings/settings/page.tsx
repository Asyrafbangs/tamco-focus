import { DepartmentRoutesForm } from '@/components/esh/DepartmentRoutesForm';
import { FollowupRulesForm } from '@/components/esh/FollowupRulesForm';
import { FollowupSettingsForm } from '@/components/esh/FollowupSettingsForm';
import { OwnerEmailSettings } from '@/components/esh/OwnerEmailSettings';
import { ReportSettingsForm } from '@/components/esh/ReportSettingsForm';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  getDepartmentRoutes,
  getDepartmentsInScope,
  getFollowupSettings,
  getHeldSummary,
  getReportSettings,
} from '@/server/esh/queries';

/**
 * Finding settings: configuration people should not re-enter on every
 * finding (v223). Owner email is an administrator's; follow-up policy and
 * department routes are safety-relevant, so ESH Verifiers edit them; weekly
 * reports belong to whoever manages reports.
 */
export default async function FindingSettingsPage() {
  const access = await requireEshAccess();
  const profile = await requireProfile();
  const isAdministrator = profile.role === 'administrator';
  if (!access.canVerify && !access.canManageReports && !isAdministrator) {
    await requireEshAccess('manage_reports');
  }
  const [settings, reports, held, departments, routes] = await Promise.all([
    access.canVerify ? getFollowupSettings() : Promise.resolve(null),
    access.canManageReports ? getReportSettings() : Promise.resolve(null),
    isAdministrator ? getHeldSummary() : Promise.resolve(null),
    access.canVerify ? getDepartmentsInScope(access) : Promise.resolve([]),
    access.canVerify ? getDepartmentRoutes() : Promise.resolve({}),
  ]);

  return (
    <>
      <div className="pagehead esh-policy-pagehead">
        <div>
          <h1>Finding settings</h1>
          <p>Set once, so nobody re-enters it on every finding.</p>
        </div>
      </div>
      {held && <OwnerEmailSettings summary={held} />}
      {access.canVerify && (
        <DepartmentRoutesForm
          departments={departments}
          routes={routes}
          levelDays={settings?.levelDays ?? []}
          canAdd={access.canCoordinate && access.scopeAll}
          canEditRoutes={access.canVerify}
        />
      )}
      {settings ? (
        <>
          <FollowupSettingsForm settings={settings} />
          <FollowupRulesForm settings={settings} />
        </>
      ) : access.canVerify ? (
        <div className="notice error" role="alert">
          <strong>Follow-up settings could not be read</strong>
          <p>Nothing can be changed until the policy and calendar are available.</p>
        </div>
      ) : null}
      {reports && (
        <ReportSettingsForm definitions={reports.definitions} departments={reports.departments} />
      )}
    </>
  );
}
