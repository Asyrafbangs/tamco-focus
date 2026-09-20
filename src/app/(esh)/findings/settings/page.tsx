import { FollowupSettingsForm } from '@/components/esh/FollowupSettingsForm';
import { requireEshAccess } from '@/server/esh/access';
import { getFollowupSettings } from '@/server/esh/queries';

/** Follow-up is safety-relevant policy, so only ESH Verifiers may edit it. */
export default async function FollowupSettingsPage() {
  await requireEshAccess('verify');
  const settings = await getFollowupSettings();

  return (
    <>
      <div className="pagehead esh-policy-pagehead">
        <div>
          <h1>Follow-up settings</h1>
          <p>Configure reminders, escalation and the working-day calendar.</p>
        </div>
      </div>
      {settings ? (
        <FollowupSettingsForm settings={settings} />
      ) : (
        <div className="notice error" role="alert">
          <strong>Follow-up settings could not be read</strong>
          <p>Nothing can be changed until the policy and calendar are available.</p>
        </div>
      )}
    </>
  );
}
