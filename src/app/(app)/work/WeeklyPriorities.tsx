'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import {
  agreeWeeklyCommitment,
  carryForwardWeeklyCommitment,
  declineWeeklyCommitment,
  withdrawWeeklyCommitment,
} from '@/server/actions/commitment-actions';
import type { WeeklyCommitment } from '@/server/queries';

/**
 * This week's priorities (specification section 7).
 *
 * Rows, not cards, and each one is a reference to work that exists elsewhere:
 * the title opens that work, and nothing here tracks progress a second time.
 * The outcome shown — due, delivered, missed — is read from the referenced task
 * or step, so it changes when the work does and never because somebody
 * remembered to update this list.
 */

const OUTCOME_WORD: Record<WeeklyCommitment['outcome'], string> = {
  due: 'Due',
  delivered: 'Delivered',
  missed: 'Missed',
  closed: 'Closed',
};

/**
 * Where the referenced work sits, when that is not "my own Active list".
 *
 * Returns null for the ordinary case, because a label on every row would be
 * the same word repeated down the list and would stop being read.
 */
function sourceLabel(commitment: WeeklyCommitment, viewerId?: string): string | null {
  if (viewerId && commitment.taskOwnerId && commitment.taskOwnerId !== viewerId) {
    return commitment.isStep ? 'A step on somebody else’s work' : 'Somebody else’s work';
  }
  if (commitment.taskStatus === 'backlog') return 'Not started yet — still in Available';
  if (commitment.taskStatus === 'paused') return 'Paused';
  return null;
}

function shortDay(iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

export function WeeklyPriorities({
  commitments,
  timeZone,
  /** The manager reading somebody else's week, rather than their own. */
  canAgree = false,
  emptyHint,
  viewerId,
  /**
   * Whether to say "This week" above the list.
   *
   * On My Work it is the only thing naming the list. Inside a person's
   * expansion the section is already headed "This week's priorities", and the
   * eyebrow repeated it one line below in smaller type.
   */
  labelled = true,
}: {
  commitments: readonly WeeklyCommitment[];
  timeZone: string;
  canAgree?: boolean;
  emptyHint?: string;
  labelled?: boolean;
  /**
   * Who is reading. Only needed to tell "a step on my own task" from "a step
   * on somebody else's", which §9 wants said out loud.
   */
  viewerId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  const run = (work: Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await work;
      if (result.ok) {
        setDecliningId(null);
        setDeclineNote('');
        router.refresh();
      } else {
        setError(result.message ?? 'That did not work.');
      }
    });
  };

  if (commitments.length === 0) {
    return (
      <div className="weekly-priorities empty">
        {labelled && <p className="eyebrow">This week</p>}
        {/*
          §8: say "No agreed priorities" rather than dressing a proposal up as
          an agreement — and never invent one for somebody who has not set any.
        */}
        <p className="muted">{emptyHint ?? 'No agreed priorities for this week.'}</p>
      </div>
    );
  }

  return (
    <div className="weekly-priorities">
      {labelled && <p className="eyebrow">This week</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <ol className="weekly-priority-list">
        {commitments.map((commitment) => {
          const target = shortDay(commitment.targetDate, timeZone);
          return (
            <li key={commitment.id} className="weekly-priority" data-outcome={commitment.outcome}>
              <span className="weekly-priority-rank" aria-hidden="true">
                {commitment.rank}
              </span>
              <span className="weekly-priority-copy">
                <a className="row-primary-link" href={`/work?task=${commitment.taskId}`}>
                  <strong>{commitment.expectedResult}</strong>
                </a>
                <span className="muted">
                  {/* A step names its parent, so "Finalise vendor drawing
                      review" is read under "BR2 sprinkler installation". */}
                  {commitment.isStep ? `${commitment.taskTitle} · ` : ''}
                  {commitment.state === 'proposed' ? 'Proposed' : 'Agreed'}
                  {target ? ` · ${target}` : ''}
                  {commitment.carriedFromId ? ' · Carried forward' : ''}
                  {commitment.openChangeCount > 0 ? ' · Change requested' : ''}
                </span>
                {/*
                  §9 — where the work actually lives, said only when it is
                  somewhere other than this person's own Active list.

                  A result agreed for the week is a plan, not a state change.
                  Without this line an Available task and a step on a
                  colleague's work read exactly like work already running, and
                  the employee would count four things in flight when two of
                  them had not been started and one was not theirs.
                */}
                {sourceLabel(commitment, viewerId) && (
                  <span className="weekly-priority-source">
                    {sourceLabel(commitment, viewerId)}
                  </span>
                )}
              </span>

              <span className={`weekly-priority-outcome tone-${commitment.outcome}`}>
                {OUTCOME_WORD[commitment.outcome]}
              </span>

              <span className="weekly-priority-actions">
                {canAgree && commitment.state === 'proposed' ? (
                  <>
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={pending}
                      onClick={() => run(agreeWeeklyCommitment({ commitmentId: commitment.id }))}
                    >
                      Agree
                    </button>
                    <button
                      type="button"
                      className="btn small"
                      disabled={pending}
                      onClick={() => setDecliningId(commitment.id)}
                    >
                      Decline
                    </button>
                  </>
                ) : null}
                {!canAgree && commitment.state === 'proposed' ? (
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending}
                    onClick={() => run(withdrawWeeklyCommitment({ commitmentId: commitment.id }))}
                  >
                    Withdraw
                  </button>
                ) : null}
                {/* Only where it means something: an unfinished result from a
                    week already gone. §7 wants carry-forward explicit. */}
                {commitment.outcome === 'missed' ? (
                  <button
                    type="button"
                    className="btn small"
                    disabled={pending}
                    onClick={() =>
                      run(carryForwardWeeklyCommitment({ commitmentId: commitment.id }))
                    }
                  >
                    Carry forward
                  </button>
                ) : null}
              </span>

              {decliningId === commitment.id && (
                <form
                  className="weekly-priority-decline"
                  onSubmit={(event) => {
                    event.preventDefault();
                    run(
                      declineWeeklyCommitment({
                        commitmentId: commitment.id,
                        note: declineNote,
                      }),
                    );
                  }}
                >
                  <label>
                    <span>Why not this week?</span>
                    <input
                      value={declineNote}
                      onChange={(event) => setDeclineNote(event.target.value)}
                      placeholder="So they can act on it"
                      required
                    />
                  </label>
                  <button className="btn small primary" type="submit" disabled={pending}>
                    Decline
                  </button>
                  <button
                    className="btn small"
                    type="button"
                    disabled={pending}
                    onClick={() => setDecliningId(null)}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
