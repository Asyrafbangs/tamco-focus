import Link from 'next/link';

import { AgeChips } from '@/components/AgeChips';
import {
  ProgressIndicator,
  RoutineRow,
  RowPrimaryLink,
  WorkspaceTabs,
} from '@/components/ui/ParityPrimitives';
import { formatDue, localDateString } from '@/domain/duration';
import { TASK_STATUS_LABELS, type TaskOverview } from '@/domain/types';
import { requireProfile } from '@/lib/supabase/server';
import { getDisplaySettings, getRoutineOccurrences } from '@/server/queries';

/**
 * Work → Routine (section 16).
 *
 * Routine occurrences, not templates. A template is controlled and never itself
 * Active (section 16.1); what a person completes is one generated occurrence
 * with its own due date, checklist, evidence, and audit history.
 *
 * Only current and near-term cycles are listed, so future occurrences do not
 * flood the interface (section 16.3). Routine work carries no focus bucket and
 * so consumes no focus target (section 6.3) — stated on the page, because it is
 * the question people ask first.
 */
export default async function RoutinePage() {
  const profile = await requireProfile();
  const settings = await getDisplaySettings();
  const occurrences = await getRoutineOccurrences(profile.id);

  const timeZone = profile.timezone ?? 'Asia/Kuala_Lumpur';
  const today = localDateString(new Date(), timeZone);

  const overdue = occurrences.filter((task) => task.isOverdue && task.status !== 'completed');
  const dueToday = occurrences.filter(
    (task) => !task.isOverdue && task.status !== 'completed' && task.occurrenceDate === today,
  );
  const upcoming = occurrences.filter(
    (task) => !task.isOverdue && task.status !== 'completed' && (task.occurrenceDate ?? '') > today,
  );
  const completed = occurrences.filter((task) => task.status === 'completed');

  const groups: { key: string; heading: string; note: string; items: TaskOverview[] }[] = [
    {
      key: 'overdue',
      heading: 'Overdue',
      note: 'Past its scheduled time and still open',
      items: overdue,
    },
    { key: 'today', heading: 'Due today', note: 'Scheduled for today', items: dueToday },
    {
      key: 'upcoming',
      heading: 'Coming up',
      note: `Within the next ${settings.upcomingWindowDays} days and beyond`,
      items: upcoming,
    },
    {
      key: 'completed',
      heading: 'Recently completed',
      note: 'Occurrences you closed in the last seven days',
      items: completed,
    },
  ];

  const outstanding = overdue.length + dueToday.length + upcoming.length;

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Work</p>
          <h1>Routine</h1>
          <p>Scheduled work that repeats. It does not use any of your focus targets.</p>
        </div>
      </div>

      <WorkspaceTabs
        items={[
          { href: '/work', label: 'Focus' },
          { href: '/work/routine', label: 'Routine', active: true },
        ]}
      />

      {overdue.length > 0 && (
        <div className="notice error" role="status">
          <strong>
            {overdue.length} routine occurrence{overdue.length === 1 ? '' : 's'} overdue
          </strong>
          <p>
            A missed occurrence stays open rather than disappearing, so the record of what was and
            was not done remains accurate.
          </p>
        </div>
      )}

      {outstanding === 0 && completed.length === 0 ? (
        /* Section 27.2 — what is empty, why, and the next useful action. */
        <div className="card empty-state">
          <h3>No routine work assigned to you</h3>
          <p>
            Routine occurrences are generated from templates a manager or administrator maintains.
            If you think something should repeat on a schedule, capture it and choose Routine
            Template Request.
          </p>
          <Link href="/capture" className="btn">
            Capture work
          </Link>
        </div>
      ) : (
        groups
          .filter((group) => group.items.length > 0)
          .map((group) => (
            <section key={group.key} className="card" style={{ marginBottom: 14 }}>
              <div className="sectionhead">
                <div>
                  <h3>{group.heading}</h3>
                  <p>{group.note}</p>
                </div>
                <span className="pill">{group.items.length}</span>
              </div>

              {group.items.map((task) => (
                <RoutineRow key={task.id}>
                  <div>
                    <RowPrimaryLink
                      href={`/work?task=${task.id}`}
                      className="title-link"
                      returnFocusId={`routine-${task.id}`}
                      ariaLabel={`Open ${task.title}`}
                    >
                      <strong>{task.title}</strong>
                    </RowPrimaryLink>
                    <span className="sub">
                      {task.checklistTotal > 0
                        ? `${task.checklistCompleted} of ${task.checklistTotal} steps`
                        : 'No checklist'}
                      {task.missingEvidenceCount > 0 &&
                        ` · ${task.missingEvidenceCount} step${
                          task.missingEvidenceCount === 1 ? '' : 's'
                        } need evidence`}
                    </span>
                    <div style={{ marginTop: 6 }}>
                      <AgeChips task={task} staleThresholdDays={settings.staleThresholdDays} />
                    </div>
                  </div>

                  <div className="hide-mobile">
                    <span className={`status ${task.status}`}>
                      {TASK_STATUS_LABELS[task.status]}
                    </span>
                    <div className="sub" style={{ marginTop: 4 }}>
                      {formatDue(task.dueAt, task.dueIsDateOnly, timeZone)}
                    </div>
                  </div>

                  <div className="hide-narrow">
                    <ProgressIndicator
                      value={task.progressPercent}
                      label={`${task.progressPercent}% complete`}
                    />
                  </div>

                  <div className="row-actions">
                    <Link href={`/work?task=${task.id}`} className="btn small">
                      Open
                    </Link>
                  </div>
                </RoutineRow>
              ))}
            </section>
          ))
      )}
    </>
  );
}
