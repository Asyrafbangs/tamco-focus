import { FollowupRulesForm } from '@/components/esh/FollowupRulesForm';
import { FollowupSettingsForm } from '@/components/esh/FollowupSettingsForm';
import { ReportSettingsForm } from '@/components/esh/ReportSettingsForm';
import { requireEshAccess } from '@/server/esh/access';
import { getFollowupSettings, getReportSettings } from '@/server/esh/queries';

/** Follow-up is safety-relevant policy, so only ESH Verifiers may edit it. */
export default async function FollowupSettingsPage() {
  const access = await requireEshAccess();
  if (!access.canVerify && !access.canManageReports) {
    await requireEshAccess('manage_reports');
  }
  const [settings, reports] = await Promise.all([
    access.canVerify ? getFollowupSettings() : Promise.resolve(null),
    access.canManageReports ? getReportSettings() : Promise.resolve(null),
  ]);

  return (
    <>
      <div className="pagehead esh-policy-pagehead">
        <div>
          <h1>Finding settings</h1>
          <p>Configure follow-up policy and secure weekly leadership reports.</p>
        </div>
      </div>
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
