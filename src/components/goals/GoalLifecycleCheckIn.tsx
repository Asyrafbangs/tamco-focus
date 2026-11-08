'use client';

import { StatusBadge } from '@/components/ui/ParityPrimitives';
import { GOAL_HEALTH_LABELS } from '@/domain/goals';
import type { OperationResult } from '@/domain/types';
import type { GoalCheckinDetail, GoalDetail } from '@/server/goal-queries';

import styles from './GoalLifecycleCheckIn.module.css';

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone }).format(
    new Date(value.length === 10 ? `${value}T12:00:00Z` : value),
  );
}

function checkInLabel(checkIn: GoalCheckinDetail) {
  if (checkIn.checkinType === 'monthly') {
    return `Monthly · ${checkIn.periodMonth}/${checkIn.periodYear}`;
  }
  if (checkIn.checkinType === 'quarterly') {
    return `Quarterly · Q${checkIn.periodQuarter} ${checkIn.periodYear}`;
  }
  return `Year end · ${checkIn.periodYear}`;
}

function statusTone(status: GoalCheckinDetail['progressStatus']) {
  if (status === 'off_track' || status === 'support_requested') return 'red' as const;
  if (status === 'at_risk' || status === 'need_attention') return 'amber' as const;
  return 'green' as const;
}

/**
 * Per-Goal session history. Session submission deliberately lives on the Goals
 * workspace, because one employee month or quarter covers every Active Goal.
 * Keeping an old single-Goal submit form here would allow two competing
 * lifecycle models and would make "month complete" untruthful.
 */
export function GoalLifecycleCheckIn({
  detail,
  timeZone,
}: {
  detail: GoalDetail;
  timeZone: string;
  finish: (result: OperationResult, success: string) => boolean;
}) {
  return (
    <div className={styles.stack}>
      <section className={styles.cadence} aria-label="Goal session cadence">
        <div>
          <span>Monthly employee session</span>
          <strong>{formatDate(detail.goal.nextMonthlyCheckinDate, timeZone)}</strong>
        </div>
        <div>
          <span>Quarterly employee session</span>
          <strong>{formatDate(detail.goal.nextQuarterlyCheckinDate, timeZone)}</strong>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className="eyebrow">Employee-level cadence</p>
            <h3>Goal session record</h3>
            <p>
              Monthly and quarterly sessions are completed once for the employee&apos;s full Active
              Goal set. Close this Goal to start the current session from the Goals workspace.
            </p>
          </div>
        </div>

        {detail.checkIns.length ? (
          <div className={styles.stack}>
            {detail.checkIns.map((checkIn) => (
              <article className={styles.recorded} key={checkIn.id}>
                <div>
                  <strong>{checkInLabel(checkIn)}</strong>
                  {checkIn.progressStatus && (
                    <StatusBadge tone={statusTone(checkIn.progressStatus)}>
                      {GOAL_HEALTH_LABELS[checkIn.progressStatus]}
                    </StatusBadge>
                  )}
                </div>
                <span>
                  {checkIn.employeeSummary ??
                    checkIn.managerDiscussion ??
                    (checkIn.noMaterialChange ? 'No material change' : 'Session recorded')}
                </span>
                {checkIn.supportRequested && <p>{checkIn.supportDetails}</p>}
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.muted}>No employee-level Goal session has been recorded yet.</p>
        )}
      </section>
    </div>
  );
}
