'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Modal } from '@/components/ui/Modal';
import { FOCUS_BUCKET_WORD } from '@/domain/types';
import type { OperationResult } from '@/domain/types';
import { acceptWorkloadReview, moveTaskToAvailable } from '@/server/actions/task-actions';
import type { TeamMemberDetail } from '@/server/queries';

function idempotencyKey() {
  return crypto.randomUUID();
}

/**
 * What to do now that mandatory work has pushed somebody over target
 * (v48 sections 20-24).
 *
 * The question this asks is deliberately not "was this safety task allowed to
 * start?" — the system already decided that, and asking again would create an
 * approval step in front of work that could not wait. The question is the one
 * that is genuinely open once the numbers have moved: given that this is now
 * being carried, does anything else give way?
 *
 * Both answers are legitimate. Accepting the overload is a decision, not a
 * failure to decide, so it is recorded rather than being the thing that happens
 * when the manager closes the panel.
 */
export function WorkloadReviewPanel({
  detail,
  closeHref,
}: {
  detail: TeamMemberDetail;
  closeHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const overTarget = detail.focus.find((bucket) => bucket.isOverTarget);
  const firstName = detail.person.fullName.split(' ')[0];

  // §24 — the system does not choose. Mandatory work is excluded from the
  // candidates because moving it out to restore a number would defeat the
  // reason it was started.
  const candidates = detail.activeWork.filter(
    (task) => !task.isMandatory && (!overTarget || task.bucket === overTarget.bucket),
  );

  function finish(result: OperationResult, success: string) {
    if (result.ok) {
      setMessage({ tone: 'success', text: success });
      router.refresh();
      return true;
    }
    setMessage({ tone: 'error', text: result.message });
    return false;
  }

  return (
    <Modal open title="Workload review" onClose={() => router.push(closeHref)}>
      <header className="modalhead">
        <div>
          <h2>Workload review</h2>
          <p>
            {overTarget
              ? `Mandatory work put ${firstName} at ${overTarget.activeCount}/${overTarget.recommendedTarget} ${FOCUS_BUCKET_WORD[overTarget.bucket]}.`
              : `${firstName} is within target again.`}
          </p>
        </div>
      </header>

      <div className="modalbody workload-review">
        {message && (
          <p className={`form-message ${message.tone}`} role="status">
            {message.text}
          </p>
        )}

        {!overTarget ? (
          /*
           * §66 — the condition can clear while the panel is open, or before it
           * is opened at all. Saying so plainly beats presenting choices about
           * a problem that no longer exists.
           */
          <p className="muted">
            Nothing needs deciding — {firstName} is back within the recommended target.
          </p>
        ) : (
          <>
            <p className="workload-review-question">
              The mandatory work stands. What should give way while it is being carried?
            </p>

            <div className="workload-review-list">
              <p className="eyebrow">Current commitments</p>
              {detail.activeWork.map((task) => (
                <p key={task.id} className="workload-review-item">
                  <strong>{task.title}</strong>
                  {task.isMandatory && <span className="flag red">Mandatory</span>}
                </p>
              ))}
            </div>

            <div className="workload-review-actions">
              <button
                type="button"
                className="btn primary"
                disabled={pending}
                aria-busy={pending}
                onClick={() => {
                  /*
                   * §23 — accepting is a recorded decision, so it is recorded.
                   *
                   * This used to set a message and nothing else: the manager
                   * was told their decision was noted, a refresh lost it, and
                   * the audit trail could not tell an accepted overload from
                   * one nobody had considered.
                   */
                  startTransition(async () => {
                    finish(
                      await acceptWorkloadReview({
                        personId: detail.person.id,
                        bucket: overTarget.bucket,
                        activeCount: overTarget.activeCount,
                        recommendedTarget: overTarget.recommendedTarget,
                        idempotencyKey: idempotencyKey(),
                      }),
                      `Recorded. ${firstName} stays at ${overTarget.activeCount}/${overTarget.recommendedTarget} for now.`,
                    );
                  });
                }}
              >
                Keep current focus
              </button>
            </div>

            {candidates.length > 0 && (
              <div className="workload-review-list">
                <p className="eyebrow">Or move one back to Available</p>
                {candidates.map((task) => (
                  <p key={task.id} className="workload-review-item">
                    <strong>{task.title}</strong>
                    <button
                      type="button"
                      className="btn small"
                      disabled={pending}
                      aria-busy={pending}
                      onClick={() => {
                        startTransition(async () => {
                          /*
                           * Available, not paused. Paused means "this is
                           * blocked"; this work is not blocked, it is simply
                           * not what should be carried this week. Using the
                           * wrong one would put a stop reason on the record
                           * that never existed.
                           */
                          finish(
                            await moveTaskToAvailable({
                              taskId: task.id,
                              expectedVersion: task.version,
                              idempotencyKey: idempotencyKey(),
                            }),
                            `"${task.title}" moved back to Available.`,
                          );
                        });
                      }}
                    >
                      Move to Available
                    </button>
                  </p>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
