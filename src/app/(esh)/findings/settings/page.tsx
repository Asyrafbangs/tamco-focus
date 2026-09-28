import Link from 'next/link';

import { DepartmentEscalationForm } from '@/components/esh/DepartmentEscalationForm';
import { DepartmentList } from '@/components/esh/DepartmentList';
import { FollowupRulesForm } from '@/components/esh/FollowupRulesForm';
import { FollowupSettingsForm } from '@/components/esh/FollowupSettingsForm';
import { HeldNoticesRelease } from '@/components/esh/HeldNoticesRelease';
import { ReportSettingsForm } from '@/components/esh/ReportSettingsForm';
import { rolloutWords } from '@/domain/esh-rollout';
import { requireProfile } from '@/lib/supabase/server';
import { requireEshAccess } from '@/server/esh/access';
import {
  getDepartmentsInScope,
  getFollowupSettings,
  getReportSettings,
  getRolloutStatus,
  listDepartmentEscalationDefaults,
} from '@/server/esh/queries';

/**
 * Finding settings (§7, §31.2, §43.2): the configuration that stops recording
 * a finding from asking the same questions twice.
 *
 * v228 — one tab at a time. It had been every form at once, which is the same
 * mistake the finding page made: a screen that shows nine things equally is a
 * control panel, not a place to do one job.
 */
const TABS = [
  { key: 'departments', label: 'Departments' },
  { key: 'follow-up', label: 'Follow-up defaults' },
  { key: 'owner-access', label: 'Owner access' },
  { key: 'reports', label: 'Reports' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default async function FindingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const access = await requireEshAccess();
  if (!access.canVerify && !access.canManageReports) {
    await requireEshAccess('manage_reports');
  }
  const profile = await requireProfile();
  const params = await searchParams;
  const asked = TABS.find((tab) => tab.key === params.tab)?.key;
  const tab: TabKey = asked ?? (access.canVerify ? 'departments' : 'reports');

  const [settings, reports, routes, departments, rollout] = await Promise.all([
    access.canVerify ? getFollowupSettings() : Promise.resolve(null),
    access.canManageReports ? getReportSettings() : Promise.resolve(null),
    access.canVerify ? listDepartmentEscalationDefaults() : Promise.resolve([]),
    access.canVerify ? getDepartmentsInScope(access) : Promise.resolve([]),
    // Counts and the mode only; changing it stays an administrator's act.
    getRolloutStatus(),
  ]);

  const shown = TABS.filter((one) =>
    one.key === 'reports' ? access.canManageReports : true,
  ).filter((one) => (one.key === 'reports' ? true : access.canVerify));

  return (
    <>
      <div className="pagehead esh-policy-pagehead">
        <div>
          <h1>Finding settings</h1>
          <p>Keep repetitive configuration here so recording a finding stays simple.</p>
        </div>
      </div>

      <nav className="esh-filter-tabs" aria-label="Settings sections">
        {shown.map((one) => (
          <Link
            key={one.key}
            href={
              one.key === 'departments' ? '/findings/settings' : `/findings/settings?tab=${one.key}`
            }
            aria-current={one.key === tab ? 'page' : undefined}
          >
            {one.label}
          </Link>
        ))}
      </nav>

      {tab === 'departments' && access.canVerify && (
        <DepartmentList departments={departments} canAdd={profile.role === 'administrator'} />
      )}

      {tab === 'follow-up' &&
        access.canVerify &&
        (settings ? (
          <>
            <FollowupSettingsForm settings={settings} />
            <FollowupRulesForm settings={settings} />
            <DepartmentEscalationForm departments={routes} levelDays={settings.levelDays} />
          </>
        ) : (
          <div className="notice error" role="alert">
            <strong>Follow-up settings could not be read</strong>
            <p>Nothing can be changed until the policy and calendar are available.</p>
          </div>
        ))}

      {tab === 'owner-access' && access.canVerify && (
        <section className="esh-form-card" aria-labelledby="esh-owner-access">
          <h2 id="esh-owner-access" className="esh-form-card-title">
            Owner access
          </h2>
          {rollout ? (
            <>
              <p>{rolloutWords(rollout)}</p>
              {/*
                Read here, changed elsewhere. The rollout is the widest access
                decision in the module and §43.2 keeps it with the administrator
                who signs for it; duplicating the switch would mean two places
                claiming to be the one that decides.
              */}
              <p className="form-hint">
                {rollout.mode === 'live' ? 'The rollout is open.' : 'The rollout is restricted.'} An
                administrator changes this, and clears individual contacts, under Identity and
                access.
              </p>
              <HeldNoticesRelease releasable={rollout.heldReleasable} />
              <div className="esh-form-actions">
                <Link className="btn" href="/more/admin/users">
                  Open Identity and access
                </Link>
              </div>
            </>
          ) : (
            <p className="form-hint">The rollout configuration could not be read.</p>
          )}
        </section>
      )}

      {tab === 'reports' &&
        (reports ? (
          <ReportSettingsForm definitions={reports.definitions} departments={reports.departments} />
        ) : (
          <p className="form-hint">You do not manage report delivery.</p>
        ))}
    </>
  );
}
