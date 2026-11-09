'use client';

import { useCallback, useRef, useState } from 'react';

import { exportAiBrief } from '@/server/actions/ai-brief-actions';

import styles from './ExportAiBrief.module.css';

/**
 * Copy the brief, or save it as a file.
 *
 * v317. Two buttons and a status line, because that is the whole feature: the
 * reader presses one, pastes it into whatever they are using, and nothing in
 * this product knows or cares where it went.
 *
 * The clipboard is the part that fails in real life. It is unavailable on an
 * insecure origin, it throws when the document is not focused, and Safari
 * refuses it outside a direct gesture - so a copy that fails falls through to
 * the download rather than reporting defeat, and the text is also put on
 * screen in a selectable box so there is always a way to get it by hand.
 */
export function ExportAiBrief() {
  const [busy, setBusy] = useState<'copy' | 'download' | null>(null);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const save = useCallback((markdown: string, filename: string) => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    /* Revoked on the next tick: Safari cancels the download if it goes early. */
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, []);

  const run = useCallback(
    async (mode: 'copy' | 'download') => {
      setBusy(mode);
      setStatus(null);
      setFallback(null);
      try {
        const result = await exportAiBrief();
        if (!result.ok || !result.markdown || !result.filename) {
          setStatus({ tone: 'error', text: result.message ?? 'The brief could not be prepared.' });
          return;
        }

        const size = new Blob([result.markdown]).size;
        const readable = size > 1024 ? `${Math.round(size / 1024)} KB` : `${size} bytes`;

        if (mode === 'download') {
          save(result.markdown, result.filename);
          setStatus({ tone: 'ok', text: `Saved ${result.filename} (${readable}).` });
          return;
        }

        try {
          if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
          await navigator.clipboard.writeText(result.markdown);
          setStatus({
            tone: 'ok',
            text: `Copied (${readable}). Paste it into your assistant.`,
          });
        } catch {
          /*
           * Not an error for the reader: they asked for the text and they are
           * about to get it, by a different route.
           */
          save(result.markdown, result.filename);
          setFallback(result.markdown);
          setStatus({
            tone: 'ok',
            text:
              `Your browser would not let the page use the clipboard, so the brief was ` +
              `downloaded as ${result.filename} instead. It is also in the box below to copy by hand.`,
          });
        }
      } catch (cause) {
        console.error(cause);
        setStatus({
          tone: 'error',
          text: 'The brief could not be prepared. Nothing was changed. Try again in a moment.',
        });
      } finally {
        setBusy(null);
      }
    },
    [save],
  );

  return (
    <section className="section-block" aria-labelledby="ai-brief-title">
      <h2 id="ai-brief-title">Export AI brief</h2>
      <p className="form-hint">
        One document of your team&rsquo;s open work, what is in the way, the latest updates people
        wrote, and the open ESH findings &mdash; only the records this account may see. Nothing is
        sent anywhere: you copy it, and where it goes next is your decision.
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className="btn primary"
          onClick={() => void run('copy')}
          disabled={busy !== null}
        >
          {busy === 'copy' ? 'Preparing…' : 'Copy AI brief'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void run('download')}
          disabled={busy !== null}
        >
          {busy === 'download' ? 'Preparing…' : 'Download .md'}
        </button>
      </div>

      {/* One live region, so a screen reader hears the outcome either way. */}
      <p
        className={status?.tone === 'error' ? 'notice error' : 'form-hint'}
        role="status"
        aria-live="polite"
      >
        {status?.text ?? ''}
      </p>

      {fallback && (
        <>
          <label className="field" htmlFor="ai-brief-fallback">
            <span>The brief, to copy by hand</span>
          </label>
          <textarea
            id="ai-brief-fallback"
            ref={area}
            className={styles.fallback}
            rows={10}
            readOnly
            value={fallback}
            onFocus={() => area.current?.select()}
          />
        </>
      )}
    </section>
  );
}
