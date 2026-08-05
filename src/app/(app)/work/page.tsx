import Link from 'next/link';

import { AgeChips } from '@/components/AgeChips';
import { formatDue } from '@/domain/duration';
import { focusBadge } from '@/domain/focus';
import {
  FOCUS_BUCKET_LABELS,
  TASK_STATUS_LABELS,
  WORK_CLASS_LABELS,
  type FocusBucket,
  type TaskOverview,
} from '@/domain/types';
import { requireProfile } from '@/lib/supabase/server';
import { getDisplaySettings, getFocusSummary, getMyTasks } from '@/server/queries';

import { TaskRowActions } from './TaskRowActions';

/**
 * Work → Focus (sections 4.4, 10).
 *
 * Focus contains five tabs — Major Project, Operational Actions,
 * Self-Development Plan, Shared / Collaborative, and Available Work — and only
 * one tab's content is displayed at a time (section 4.4).
 */

type TabKey = 'major' | 'operational' | 'self_development' | 'shared' | 'available';

const TABS: ReadonlyArray<{ key: TabKey; label: string; bucket?: FocusBucket }> = [
  { key: 'major', label: 'Major Project', bucket: 'major' },
  { key: 'operational', label: 'Operational Actions', bucket: 'operational' },
  { key: 'self_development', label: 'Self-Development Plan', bucket: 'self_development' },
  { key: 'shared', label: 'Shared / Collaborative' },
  { key: 'available', label: 'Available Work' },
];

function tasksForTab(tasks: readonly TaskOverview[], tab: TabKey, viewerId: string) {
  switch (tab) {
    case 'available':
      // Section 5 — `backlog` is presented to users as Available Work.
      return tasks.filter((task) => task.status === 'backlog');

    case 'shared':
      // Work owned by someone else that this person contributes to.
      return tasks.filter((task) => task.primaryOwnerId !== viewerId);

    default: {
      const bucket = TABS.find((entry) => entry.key === tab)?.bucket;
      return tasks.filter(
        (task) =>
          task.focusBucket === bucket &&
          task.primaryOwnerId === viewerId &&
          task.status !== 'backlog',
      );
    }
  }
}

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await requireProfile();
  const params = await searchParams;

  const requested = params.tab as TabKey | undefined;
  const activeTab: TabKey = TABS.some((tab) => tab.key === requested)
    ? (requested as TabKey)
    : 'operational';

  const [tasks, focus, settings] = await Promise.all([
    getMyTasks(profile.id),
    getFocusSummary(profile.id),
    getDisplaySettings(),
  ]);

  const visible = tasksForTab(tasks, activeTab, profile.id);
  const currentBucket = TABS.find((tab) => tab.key === activeTab)?.bucket;
  const currentSummary = currentBucket
    ? focus.find((entry) => entry.bucket === currentBucket)
    : undefined;

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Work</p>
          <h1>My Focus</h1>
          <p>What you are actively carrying, and what is available to pick up.</p>
        </div>
        <div className="actions">
          <Link href="/capture" className="btn primary">
            Capture work
          </Link>
        </div>
      </div>

      <div className="workspace-tabs">
        <Link href="/work" className="active">
          Focus
        </Link>
        <Link href="/work/routine">Routine</Link>
      </div>

      {/* Section 10.2 — a neutral badge shows the count against target; a red
          badge means action is required, never an unexplained number. */}
      <nav className="focus-tabs" aria-label="Focus areas">
        {TABS.map((tab) => {
          const summary = tab.bucket
            ? focus.find((entry) => entry.bucket === tab.bucket)
            : undefined;
          const badge = summary ? focusBadge(summary) : null;
          const count = tab.bucket
            ? badge?.text
            : String(tasksForTab(tasks, tab.key, profile.id).length);

          return (
            <Link
              key={tab.key}
              href={`/work?tab=${tab.key}`}
              className={tab.key === activeTab ? 'active' : undefined}
              aria-current={tab.key === activeTab ? 'page' : undefined}
            >
              {tab.label}
              <span className={`count${badge?.tone === 'red' ? ' over' : ''}`}>{count}</span>
              {badge && <span className="visually-hidden">. {badge.accessibleLabel}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Section 7.4 — the over-target state is shown in red AND in words. */}
      {currentSummary?.isOverTarget && (
        <div className="notice error" role="status" style={{ marginTop: 14 }}>
          <strong>
            Over focus target — {currentSummary.activeCount} / {currentSummary.recommendedTarget}
          </strong>
          <p>
            You are carrying more {FOCUS_BUCKET_LABELS[currentSummary.bucket].toLowerCase()} than
            the recommended target. This is allowed. Your manager can see the reason you recorded.
          </p>
        </div>
      )}

      <div className="focus-panel">
        {visible.length > 0 ? (
          visible.map((task) => (
            <article key={task.id} className="task-row">
              <div>
                <Link href={`/work?task=${task.id}`} className="title-link">
                  <strong>{task.title}</strong>
                </Link>
                <span className="sub">
                  {task.nextAction ?? WORK_CLASS_LABELS[task.workClass]}
                  {task.openBarrierCount > 0 && ' · Barrier open'}
                  {task.isMandatory && ' · Mandatory'}
                </span>
                <div style={{ marginTop: 6 }}>
                  <AgeChips task={task} staleThresholdDays={settings.staleThresholdDays} />
                </div>
              </div>

              <div className="hide-mobile">
                <span className={`status ${task.status}`}>{TASK_STATUS_LABELS[task.status]}</span>
                <div className="sub" style={{ marginTop: 4 }}>
                  {formatDue(task.dueAt, task.dueIsDateOnly, profile.timezone)}
                </div>
              </div>

              <div className="hide-narrow">
                <div className="mini-progress" aria-hidden="true">
                  <span style={{ width: `${task.progressPercent}%` }} />
                </div>
                <span className="sub">
                  {task.checklistTotal > 0
                    ? `${task.checklistCompleted} of ${task.checklistTotal} steps`
                    : `${task.progressPercent}% complete`}
                </span>
              </div>

              <TaskRowActions
                taskId={task.id}
                title={task.title}
                status={task.status}
                version={task.version}
                bucket={task.focusBucket}
                isMandatory={task.isMandatory}
              />
            </article>
          ))
        ) : (
          /* Section 27.2 — what is empty, why, and the next useful action. */
          <div className="empty-state">
            <h3>Nothing here yet</h3>
            <p>
              {activeTab === 'available'
                ? 'Available Work is valid work you have not activated yet. Capture something, or ask your manager what is waiting.'
                : activeTab === 'shared'
                  ? 'Work shared with you by a colleague will appear here once you are added as a collaborator.'
                  : `You have no ${FOCUS_BUCKET_LABELS[currentBucket ?? 'operational'].toLowerCase()} in progress. Activate something from Available Work when you are ready.`}
            </p>
            <Link href="/work?tab=available" className="btn">
              View Available Work
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
