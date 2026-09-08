import { sanitiseTheme } from '@/lib/theme';
import { requireProfile } from '@/lib/supabase/server';
import { getSettingsData } from '@/server/queries';

import { PersonalSettingsForm, SettingsPolicyRow } from '../SettingsForms';
import { ThemeSettings } from '../ThemeSettings';
import { SettingsWorkspace, type SettingsKey } from './SettingsWorkspace';

const supportedOrgKeys = new Set([
  'focus.self_selection_allowed',
  'focus.urgency_requires_review_by',
  'focus.stale_update_threshold_days',
  'review.request_changes_outcome',
  'review.target_days',
  'routine.occurrence_lead_days',
  'routine.ordinary_auto_archive',
  'alerts.barrier_escalation_hours',
  'day.upcoming_window_days',
  'day.today_list_max_items',
  'retention.completed_task_years',
]);

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const params = await searchParams;
  const profile = await requireProfile();
  const data = await getSettingsData(profile.id);
  const canManageOperations = profile.role === 'manager' || profile.role === 'administrator';
  const editableSettings = data.organisation.filter(
    (setting) =>
      supportedOrgKeys.has(setting.key) &&
      (profile.role === 'administrator' || setting.managerEditable),
  );

  const groups = {
    focus: editableSettings.filter((setting) => setting.key.startsWith('focus.')),
    review: editableSettings.filter((setting) => setting.key.startsWith('review.')),
    routine: editableSettings.filter((setting) => setting.key.startsWith('routine.')),
    reminders: editableSettings.filter(
      (setting) => setting.key.startsWith('alerts.') || setting.key.startsWith('day.'),
    ),
    retention: editableSettings.filter((setting) => setting.key.startsWith('retention.')),
  };

  return (
    <SettingsWorkspace
      canManageOperations={canManageOperations}
      context={`${profile.email} · ${profile.role.replaceAll('_', ' ')} · ${profile.timezone}`}
      initialSection={(params.section ?? 'workspace') as SettingsKey}
    >
      <section data-settings-panel="workspace" aria-label="My workspace settings">
        <PersonalSettingsForm profile={profile} data={data} section="workspace" />
      </section>
      <section data-settings-panel="alerts" aria-label="My alert settings">
        <PersonalSettingsForm profile={profile} data={data} section="alerts" />
      </section>
      <section data-settings-panel="accessibility" aria-label="Accessibility settings">
        <PersonalSettingsForm profile={profile} data={data} section="accessibility" />
      </section>
      <section data-settings-panel="appearance" aria-label="Appearance settings">
        <ThemeSettings initial={sanitiseTheme(profile.theme_colors)} />
      </section>

      {canManageOperations && (
        <>
          {Object.entries(groups).map(([group, settings]) => (
            <section key={group} data-settings-panel={group} aria-label={`${group} policy`}>
              <div className="settings-policy-list">
                {settings.length > 0 ? (
                  settings.map((setting) => (
                    <SettingsPolicyRow key={setting.key} setting={setting} />
                  ))
                ) : (
                  <div className="empty-state compact">
                    <p>No editable policies are available for your role.</p>
                  </div>
                )}
              </div>
            </section>
          ))}
        </>
      )}

      <section data-settings-panel="delivery" aria-label="Delivery history">
        {data.recentDeliveries.length ? (
          <ul className="delivery-list">
            {data.recentDeliveries.map((delivery) => (
              <li key={delivery.id}>
                <div>
                  <strong>{delivery.subject}</strong>
                  <span>
                    {delivery.type} ·{' '}
                    {new Intl.DateTimeFormat('en-MY', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(delivery.queuedAt))}
                  </span>
                </div>
                <span
                  className={`flag ${delivery.status === 'sent' ? 'green' : delivery.status === 'failed' ? 'red' : 'amber'}`}
                >
                  {delivery.status}
                </span>
                {delivery.lastError && <small>{delivery.lastError}</small>}
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state compact">
            <p>No email deliveries have been generated yet.</p>
          </div>
        )}
      </section>

      <section data-settings-panel="security" aria-label="Security and records">
        <div className="capability-grid settings-capability-grid">
          <div>
            <strong>Team member</strong>
            <p>Own work, collaboration, records, preferences, and authored updates.</p>
          </div>
          <div>
            <strong>Manager</strong>
            <p>
              Authorised team visibility, routine governance, completion review, and
              manager-editable rules.
            </p>
          </div>
          <div>
            <strong>Administrator</strong>
            <p>
              Identity, organisation settings, visibility rules, retention, and authorised records.
            </p>
          </div>
        </div>
        <p className="form-hint">
          Access is enforced by database row-level security. Audit history is immutable, and archive
          is not deletion.
        </p>
      </section>
    </SettingsWorkspace>
  );
}
