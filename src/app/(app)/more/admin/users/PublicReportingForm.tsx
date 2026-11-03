'use client';

import { useState, useTransition } from 'react';

import { setPublicQrIntake } from '@/server/esh/qr-actions';

/**
 * The public reporting switch (v288, §6).
 *
 * Beside the rollout switch, because it is the same kind of decision: one
 * sentence from an administrator changes who can reach the module. Closed is
 * where every deployment starts and where this stays until the stickers, the
 * privacy notice and the site's own reporting arrangements have been tested
 * and approved.
 *
 * Opening it does not notify anybody and does not create anything. It makes
 * the QR addresses resolve; nothing else changes.
 */
export function PublicReportingForm({
  enabled,
  changedAt,
  changeReason,
}: {
  enabled: boolean;
  changedAt: string | null;
  changeReason: string | null;
}) {
  const [reason, setReason] = useState('');
  const [said, setSaid] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const opening = !enabled;

  /*
   * Its own hook class, not `esh-rollout`. The rollout spec locates its card
   * with `.esh-rollout`, and a second card carrying that class makes the
   * locator match two elements — which fails in strict mode and reads like the
   * rollout card having disappeared.
   */
  return (
    <section className="esh-form-card esh-public-switch" aria-labelledby="esh-public-qr-title">
      <h2 id="esh-public-qr-title" className="esh-form-card-title">
        Public QR reporting
      </h2>
      <p className="esh-rollout-state">
        <span className="esh-rollout-chip" data-mode={enabled ? 'live' : 'restricted'}>
          {enabled ? 'Open' : 'Closed'}
        </span>
        <span>
          {enabled
            ? 'Every active sticker resolves, and anybody on site can send a report.'
            : 'Every sticker says the link does not report anything. No report can be submitted.'}
        </span>
      </p>
      {changeReason && (
        <p className="form-hint">
          Last changed{changedAt ? ` ${new Date(changedAt).toLocaleDateString('en-MY')}` : ''}:{' '}
          {changeReason}
        </p>
      )}

      <div className="esh-field">
        <label htmlFor="esh-public-qr-reason">
          <span>Why{opening ? ' it is being opened' : ' it is being closed'}</span>
        </label>
        <textarea
          id="esh-public-qr-reason"
          rows={2}
          maxLength={400}
          value={reason}
          placeholder={
            opening
              ? 'Pilot on press line 2, stickers and privacy notice approved.'
              : 'Pausing reporting while the stickers are replaced.'
          }
          onChange={(event) => {
            setReason(event.target.value);
            setSaid(null);
          }}
        />
      </div>

      <div className="esh-form-actions">
        <button
          type="button"
          className={opening ? 'btn primary' : 'btn'}
          disabled={pending || reason.trim().length < 10}
          onClick={() =>
            start(async () => {
              const result = await setPublicQrIntake({ enabled: opening, reason });
              if (result.ok) {
                setReason('');
                setSaid({
                  ok: true,
                  message: result.enabled
                    ? 'Public reporting is open.'
                    : 'Public reporting is closed.',
                });
                return;
              }
              setSaid({ ok: false, message: result.message });
            })
          }
        >
          {pending ? 'Saving…' : opening ? 'Open public reporting' : 'Close public reporting'}
        </button>
      </div>

      {said && (
        <p
          className={said.ok ? 'notice success' : 'notice error'}
          role={said.ok ? 'status' : 'alert'}
        >
          {said.message}
        </p>
      )}
    </section>
  );
}
