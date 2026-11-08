import type { ReactNode } from 'react';

import { sanitiseTheme } from '@/lib/theme';
import { requireProfile } from '@/lib/supabase/server';
import { getSettingsData, type PersonalSettingsData } from '@/server/queries';

import { PersonalSettingsForm, SettingsPolicyRow } from '../SettingsForms';
import { ThemeSettings } from '../ThemeSettings';
/*
 * The section data comes from `./sections`, not from `./SettingsWorkspace`.
 * That file is a client component, and this one is a server component: a plain
 * value imported across that boundary arrives as a client reference proxy, so
 * `SETTINGS_SECTIONS.filter` threw at request time and the page rendered no
 * panels. Components still come from the client module.
 */
import { SETTINGS_SECTIONS, type SettingsKey } from './sections';
import { SettingsPanel, SettingsWorkspace } from './SettingsWorkspace';

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

  const policyList = (settings: PersonalSettingsData['organisation']) => (
    <div className="settings-policy-list">
      {settings.length > 0 ? (
        settings.map((setting) => <SettingsPolicyRow key={setting.key} setting={setting} />)
      ) : (
        <div className="empty-state compact">
          <p>No rule in this group is yours to change. A manager or administrator sets these.</p>
        </div>
      )}
    </div>
  );

  /*
   * One panel per section, keyed by the same list the menu is built from.
   *
   * `Record<SettingsKey, ReactNode>` is the point: a section added to
   * `SettingsKey` without a panel is a type error here rather than a menu row
   * that opens an empty page.
   */
  const panels: Record<SettingsKey, ReactNode> = {
    workspace: <PersonalSettingsForm profile={profile} data={data} section="workspace" />,
    alerts: <PersonalSettingsForm profile={profile} data={data} section="alerts" />,
    accessibility: <PersonalSettingsForm profile={profile} data={data} section="accessibility" />,
    appearance: <ThemeSettings initial={sanitiseTheme(profile.theme_colors)} />,
    focus: policyList(groups.focus),
    review: policyList(groups.review),
    routine: policyList(groups.routine),
    reminders: policyList(groups.reminders),
    retention: policyList(groups.retention),
    delivery: data.recentDeliveries.length ? (
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
        <p>
          Nothing has been emailed yet. Turn on a daily brief or weekly summary in Email summaries.
        </p>
      </div>
    ),
    security: (
      <>
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
      </>
    ),
  };

  return (
    <SettingsWorkspace
      canManageOperations={canManageOperations}
      context={`${profile.email} · ${profile.role.replaceAll('_', ' ')} · ${profile.timezone}`}
      initialSection={(params.section ?? 'workspace') as SettingsKey}
    >
      {SETTINGS_SECTIONS.filter(
        (section) => canManageOperations || section.group !== 'Organisation',
      ).map((section) => (
        <SettingsPanel key={section.key} section={section.key} label={section.label}>
          {panels[section.key]}
        </SettingsPanel>
      ))}
    </SettingsWorkspace>
  );
}
