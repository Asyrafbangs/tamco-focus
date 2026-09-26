'use client';

import { useState, useTransition } from 'react';

import { rolloutChangeWords, rolloutWords, type RolloutStatus } from '@/domain/esh-rollout';
import { releaseHeldNotifications, setRolloutMode } from '@/server/esh/rollout-actions';

/**
 * The rollout's one global setting (§43.2), and the release it does not do.
 *
 * Restricted names contacts one at a time and is how this module starts, on
 * every deployment. Live reaches every active contact except anyone switched
 * off by name. There is no date on which it opens by itself: an administrator
 * decides, in words, and both audit trails keep the sentence.
 *
 * Opening the rollout sends nothing (FM106). The release below is the second
 * act, and it belongs to ESH — so it appears only for somebody who holds both
 * roles, which is who is usually standing here.
 */
export function RolloutModeForm({
  status,
  canRelease,
}: {
  status: RolloutStatus;
  canRelease: boolean;
}) {
  const [reason, setReason] = useState('');
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const opening = status.mode === 'restricted';

  return (
    <section className="esh-form-card esh-rollout" aria-labelledby="esh-rollout-title">
      <h2 id="esh-rollout-title" className="esh-form-card-title">
        Finding Management rollout
      </h2>
      <p className="esh-rollout-state">
        <span className="esh-rollout-chip" data-mode={status.mode}>
          {status.mode === 'live' ? 'Live' : 'Restricted'}
        </span>
        <span>{rolloutWords(status)}</span>
      </p>
      {status.modeChangedAt && (
        <p className="form-hint">
          Set by {status.modeChangedBy ?? 'an administrator'} on{' '}
          {new Date(status.modeChangedAt).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
          {status.modeReason ? ` — ${status.modeReason}` : ''}
        </p>
      )}

      {said && (
        <div className={`notice ${said.ok ? 'success' : 'error'} compact`} role="status">
          <strong>{said.message}</strong>
        </div>
      )}

      {status.held > 0 && (
        <p className="form-hint">
          {status.held} notification{status.held === 1 ? ' is' : 's are'} held.{' '}
          {status.heldReleasable > 0
            ? `${status.heldReleasable} can go out now.`
            : 'None can go out until their contacts can be written to.'}
        </p>
      )}

      {canRelease && status.heldReleasable > 0 && (
        <div className="esh-form-actions">
          <button
            type="button"
            className="btn"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setSaid(await releaseHeldNotifications());
              })
            }
          >
            {pending ? 'Releasing…' : `Release ${status.heldReleasable} held`}
          </button>
        </div>
      )}

      {/*
        Uncontrolled on purpose. Given `open` as a prop this closes itself on
        every re-render, which for a form means it disappears mid-sentence.
      */}
      {/*
        The summary says what it reveals; the button inside says what it does.
        Both reading "Open the rollout" put two identically named controls on
        one card, one of which only unfolds a form.
      */}
      <details className="esh-rollout-change">
        <summary>Change the rollout</summary>
        <p>{rolloutChangeWords(status)}</p>
        <label className="esh-field" htmlFor="esh-rollout-reason">
          <span>Why the rollout is changing</span>
        </label>
        <input
          id="esh-rollout-reason"
          value={reason}
          maxLength={400}
          placeholder={
            opening
              ? 'Broad launch approved: every supervisor now owns actions.'
              : 'Closing while the mail provider is replaced.'
          }
          onChange={(event) => {
            setReason(event.target.value);
            setSaid(null);
          }}
        />
        <div className="esh-form-actions">
          <span className="form-hint">
            {reason.trim().length < 10
              ? 'Say why, in a sentence somebody can read in a year.'
              : 'This is recorded against your name in both audit trails.'}
          </span>
          <button
            type="button"
            className={opening ? 'btn primary' : 'btn'}
            disabled={pending || reason.trim().length < 10}
            onClick={() =>
              startTransition(async () => {
                const answer = await setRolloutMode({
                  mode: opening ? 'live' : 'restricted',
                  reason,
                });
                setSaid(answer);
                if (answer.ok) setReason('');
              })
            }
          >
            {pending ? 'Saving…' : opening ? 'Open the rollout' : 'Close the rollout'}
          </button>
        </div>
      </details>
    </section>
  );
}
