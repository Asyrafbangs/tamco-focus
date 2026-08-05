import Link from 'next/link';

import { focusBadge, overTargetDurationMs } from '@/domain/focus';
import { formatDurationWords } from '@/domain/duration';
import { FOCUS_BUCKET_LABELS, type FocusBucket, type FocusSummary } from '@/domain/types';
import { requireProfile } from '@/lib/supabase/server';
import { getTeamFocusSummary, getTeamLoad, type TeamLoadRow } from '@/server/queries';

/**
 * Team Load (section 18).
 *
 * Gives managers visibility WITHOUT requiring approval of every action
 * (section 18.1). Nothing on this page approves anything; it surfaces where
 * someone needs support, reprioritisation, or a decision.
 *
 * Section 18.4 is deliberately a compact weekly count of employee-initiated
 * work rather than a list of every Quick Action — individual items surface only
 * when they become exceptional (section 18.5).
 */

const BUCKET_ORDER: FocusBucket[] = ['major', 'operational', 'self_development'];

/** Section 18.5 — the conditions that justify surfacing a person individually. */
function attentionReasons(person: TeamLoadRow, buckets: FocusSummary[]): string[] {
  const reasons: string[] = [];

  if (person.openBarrierCount > 0) {
    reasons.push(
      `${person.openBarrierCount} open barrier${person.openBarrierCount === 1 ? '' : 's'} waiting for support or a decision`,
    );
  }

  if (person.overdueCount > 0) {
    reasons.push(`${person.overdueCount} overdue item${person.overdueCount === 1 ? '' : 's'}`);
  }

  if (person.routinesOverdue > 0) {
    reasons.push(
      `${person.routinesOverdue} overdue routine occurrence${person.routinesOverdue === 1 ? '' : 's'}`,
    );
  }

  if (person.staleCount > 0) {
    reasons.push(
      `${person.staleCount} active item${person.staleCount === 1 ? '' : 's'} with no recent update`,
    );
  }

  for (const bucket of buckets) {
    if (!bucket.isOverTarget) continue;

    const duration = overTargetDurationMs(bucket);
    reasons.push(
      `Over focus target on ${FOCUS_BUCKET_LABELS[bucket.bucket]} ` +
        `(${bucket.activeCount} / ${bucket.recommendedTarget})` +
        (duration ? `, for ${formatDurationWords(duration)}` : ''),
    );
  }

  if (person.decisionsPending > 0) {
    reasons.push(
      `${person.decisionsPending} proposal${person.decisionsPending === 1 ? '' : 's'} awaiting your decision`,
    );
  }

  return reasons;
}

export default async function TeamPage() {
  const profile = await requireProfile();

  // Section 4.1 — Team is a manager and administrator destination. The
  // navigation already hides it, and RLS would return nothing regardless; this
  // is the explicit, readable refusal (section 27.5).
  if (profile.role !== 'manager' && profile.role !== 'administrator') {
    return (
      <div className="card empty-state">
        <h3>Team Load is not available to you</h3>
        <p>
          This page shows workload across a reporting line, which is a manager and administrator
          view. Your own work is on My Day and Work.
        </p>
        <Link href="/today" className="btn">
          Back to My Day
        </Link>
      </div>
    );
  }

  const [team, allFocus] = await Promise.all([getTeamLoad(profile.id), getTeamFocusSummary()]);

  const focusFor = (userId: string) =>
    BUCKET_ORDER.map((bucket) =>
      allFocus.find((entry) => entry.userId === userId && entry.bucket === bucket),
    ).filter((entry): entry is FocusSummary => Boolean(entry));

  const needingAttention = team.filter(
    (person) => attentionReasons(person, focusFor(person.userId)).length > 0,
  );

  return (
    <>
      <div className="pagehead">
        <div>
          <p className="eyebrow">Team</p>
          <h1>Team Load</h1>
          <p>Where someone needs support, reprioritisation, or a decision.</p>
        </div>
      </div>

      {team.length === 0 ? (
        /* Section 27.2 — what is empty, why, and the next useful action. */
        <div className="card empty-state">
          <h3>Nobody is visible to you yet</h3>
          <p>
            Team Load shows the people your visibility rules cover. An administrator configures
            these under Settings, either by reporting line or by naming people explicitly.
          </p>
          <Link href="/today" className="btn">
            Back to My Day
          </Link>
        </div>
      ) : (
        <>
          {needingAttention.length > 0 && (
            <div className="notice warn" role="status">
              <strong>
                {needingAttention.length} of {team.length} {team.length === 1 ? 'person' : 'people'}{' '}
                may need your attention
              </strong>
              <p>
                Listed below with the reason. Being over a focus target is visible here but needs no
                approval — the reason the owner recorded is part of the task history.
              </p>
            </div>
          )}

          <div className="team-grid">
            {team.map((person) => {
              const buckets = focusFor(person.userId);
              const reasons = attentionReasons(person, buckets);
              const initials = person.fullName
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
                .toUpperCase();

              return (
                <article key={person.userId} className="card member-card">
                  <div className="member-head">
                    <div className="member-id">
                      <div className="avatar" aria-hidden="true">
                        {initials}
                      </div>
                      <div>
                        <strong>{person.fullName}</strong>
                        <div className="sub muted">{person.employeeId}</div>
                      </div>
                    </div>

                    <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {buckets.map((bucket) => {
                        const badge = focusBadge(bucket);
                        return (
                          <span
                            key={bucket.bucket}
                            className={`flag ${badge.tone === 'red' ? 'red' : 'neutral'}`}
                            title={badge.accessibleLabel}
                          >
                            {FOCUS_BUCKET_LABELS[bucket.bucket]} {badge.text}
                            {/* Colour is never the only signal (section 1.3, item 12). */}
                            {badge.writtenLabel && ` · ${badge.writtenLabel}`}
                            <span className="visually-hidden">. {badge.accessibleLabel}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  {reasons.length > 0 && (
                    <div className="notice error" style={{ margin: '12px 0 0' }}>
                      <strong>Needs attention</strong>
                      <ul>
                        {reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="member-loads">
                    <div className="loadbox">
                      <div className="top">
                        <span>Available Work</span>
                        <span>{person.availableWorkCount}</span>
                      </div>
                      <p className="sub muted" style={{ margin: '6px 0 0' }}>
                        Valid work not yet activated. Selection is the owner&rsquo;s decision.
                      </p>
                    </div>

                    {/* Section 16.6 — routine burden is shown even though it
                        consumes no focus target. */}
                    <div className="loadbox">
                      <div className="top">
                        <span>Routine this week</span>
                        <span>
                          {person.routinesCompletedThisWeek} / {person.routinesThisWeek}
                        </span>
                      </div>
                      <p className="sub muted" style={{ margin: '6px 0 0' }}>
                        Completed against scheduled
                        {person.routinesOverdue > 0 && ` · ${person.routinesOverdue} overdue`}. Uses
                        no focus target.
                      </p>
                    </div>

                    {/* Section 18.4 — a compact weekly summary, not every item. */}
                    <div className="loadbox">
                      <div className="top">
                        <span>Created this week</span>
                        <span>
                          {person.quickActionsCreatedThisWeek + person.operationalCreatedThisWeek}
                        </span>
                      </div>
                      <p className="sub muted" style={{ margin: '6px 0 0' }}>
                        {person.quickActionsCreatedThisWeek} Quick Action
                        {person.quickActionsCreatedThisWeek === 1 ? '' : 's'},{' '}
                        {person.operationalCreatedThisWeek} Operational. No approval needed.
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
