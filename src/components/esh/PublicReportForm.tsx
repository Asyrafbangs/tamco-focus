'use client';

import { useRef, useState, useTransition } from 'react';

import { compressImage } from '@/components/esh/compress-image';
import { formatBytes } from '@/domain/esh-evidence';
import {
  PUBLIC_PHOTO_ACCEPT,
  PUBLIC_PHOTO_MAX,
  PUBLIC_PHOTO_MAX_EDGE,
  PUBLIC_PHOTO_QUALITY,
  PUBLIC_REPORT_COPY,
  PUBLIC_REPORT_MAX_CONTACT,
  PUBLIC_REPORT_MAX_TEXT,
  photoAdditionProblem,
  photoProblem,
} from '@/domain/esh-public-report';
import { sendPublicReport } from '@/server/esh/public-actions';

interface Staged {
  id: string;
  /** What will be sent: shrunk, re-encoded, and with no metadata left. */
  file: File;
  /** What the camera handed over, for the line under the thumbnail. */
  chosenBytes: number;
  preview: string;
}

/**
 * The public form (v288, §2).
 *
 * Four things, in the order somebody standing in front of the hazard would do
 * them: read where they are, say what they see, optionally photograph it,
 * send. No account, no category, no severity, no owner — and no field that
 * makes an employee guess at something ESH decides during review.
 *
 * Every photograph is redrawn through a canvas before it leaves the phone.
 * That is what shrinks it for a weak signal and what drops the EXIF block
 * with the GPS co-ordinates in it; the server rebuilds the file again, so the
 * promise does not depend on the browser having done its part.
 */
export function PublicReportForm({ code, label }: { code: string; label: string }) {
  const [text, setText] = useState('');
  const [where, setWhere] = useState('');
  const [contact, setContact] = useState('');
  const [staged, setStaged] = useState<Staged[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<{ reference: string; refused: number } | null>(null);
  const [preparing, setPreparing] = useState(0);
  const [pending, start] = useTransition();
  const chooser = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);

  async function choose(files: FileList | null) {
    if (!files?.length) return;
    setProblem(null);
    /*
     * v290 - a count, not a flag. Two pictures chosen together are two
     * re-encodes, and the send button has to stay disabled until the last of
     * them finishes rather than the first.
     */
    /*
     * Counted from a copy, not from the FileList. A FileList is live: the
     * input is cleared at the end of this function, and reading `.length`
     * afterwards gives 0 - so the count never came back down and the Send
     * button stayed disabled for ever. The staff form carries a comment about
     * the same trap for the same reason.
     */
    const chosen = Array.from(files);
    setPreparing((count) => count + chosen.length);
    const next: Staged[] = [];
    for (const file of chosen) {
      const full = photoAdditionProblem(staged.length + next.length);
      if (full) {
        setProblem(full);
        break;
      }
      const bad = photoProblem(file.name, file.type, file.size);
      if (bad) {
        setProblem(bad);
        continue;
      }
      // `always`, because this re-encode is what removes the metadata - a
      // small photograph needs it as much as a large one.
      const shrunk = await compressImage(file, {
        maxEdge: PUBLIC_PHOTO_MAX_EDGE,
        quality: PUBLIC_PHOTO_QUALITY,
        always: true,
      });
      next.push({
        id: crypto.randomUUID(),
        file: shrunk.copy,
        chosenBytes: file.size,
        preview: URL.createObjectURL(shrunk.copy),
      });
    }
    if (next.length) setStaged((current) => [...current, ...next]);
    setPreparing((count) => Math.max(0, count - chosen.length));
    // Cleared so the same photograph can be chosen again after removing it.
    if (chooser.current) chooser.current.value = '';
    if (camera.current) camera.current.value = '';
  }

  function remove(id: string) {
    setStaged((current) => {
      const going = current.find((item) => item.id === id);
      if (going) URL.revokeObjectURL(going.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  function send() {
    setProblem(null);
    const form = new FormData();
    form.set('code', code);
    form.set('text', text);
    form.set('where', where);
    form.set('contact', contact);
    for (const item of staged) form.append('photos', item.file, item.file.name);

    start(async () => {
      const result = await sendPublicReport(form);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      for (const item of staged) URL.revokeObjectURL(item.preview);
      setStaged([]);
      setText('');
      setWhere('');
      setContact('');
      setSent({ reference: result.reference, refused: result.photosRefused });
    });
  }

  if (sent) {
    return (
      <div className="public-report-done" role="status">
        <h2>{PUBLIC_REPORT_COPY.thanks}</h2>
        <p className="public-report-reference">{sent.reference.slice(0, 8).toUpperCase()}</p>
        <p>{PUBLIC_REPORT_COPY.thanksDetail}</p>
        {sent.refused > 0 && (
          <p className="notice warn">
            {sent.refused === 1
              ? 'One photo could not be sent, but your report has gone through.'
              : `${sent.refused} photos could not be sent, but your report has gone through.`}
          </p>
        )}
        <button type="button" className="btn" onClick={() => setSent(null)}>
          {PUBLIC_REPORT_COPY.another}
        </button>
      </div>
    );
  }

  return (
    <div className="public-report">
      <p className="public-report-where">
        <span>You are at</span>
        <strong>{label}</strong>
      </p>

      <div className="esh-field">
        <label htmlFor="public-report-text">
          <span>{PUBLIC_REPORT_COPY.observation}</span>
        </label>
        <textarea
          id="public-report-text"
          value={text}
          rows={5}
          maxLength={PUBLIC_REPORT_MAX_TEXT}
          autoFocus
          placeholder="The guard is off the bench grinder and it is still being used."
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
        />
        <p className="form-hint">{PUBLIC_REPORT_COPY.observationHint}</p>
      </div>

      <div className="esh-field">
        <label htmlFor="public-report-where">
          <span>{PUBLIC_REPORT_COPY.locationLabel}</span>
        </label>
        <input
          id="public-report-where"
          value={where}
          maxLength={160}
          placeholder="By the goods-in door"
          onChange={(event) => setWhere(event.target.value)}
        />
      </div>

      <div className="esh-field">
        <label htmlFor="public-report-photos">
          <span>{PUBLIC_REPORT_COPY.photos}</span>
        </label>
        {/*
         * v290 - two buttons, not one input with `capture`.
         *
         * `capture="environment"` does not mean "offer the camera": on a phone
         * it means "the camera, and nothing else". The gallery was unreachable,
         * so somebody who had already photographed the hazard, or who had to
         * step away and come back, could not send it at all. The staff
         * uploader has had the two-button shape since v199; this is the same
         * shape, with the same single handler behind it.
         */}
        <span className="public-report-choose">
          <button
            type="button"
            className="btn"
            disabled={pending || staged.length >= PUBLIC_PHOTO_MAX || preparing > 0}
            onClick={() => camera.current?.click()}
          >
            Take photo
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending || staged.length >= PUBLIC_PHOTO_MAX || preparing > 0}
            onClick={() => chooser.current?.click()}
          >
            Choose photo
          </button>
        </span>
        <input
          ref={camera}
          id="public-report-photos"
          type="file"
          accept={PUBLIC_PHOTO_ACCEPT}
          capture="environment"
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Take a photo"
          disabled={pending || staged.length >= PUBLIC_PHOTO_MAX}
          onChange={(event) => void choose(event.target.files)}
        />
        <input
          ref={chooser}
          type="file"
          accept={PUBLIC_PHOTO_ACCEPT}
          multiple
          className="visually-hidden"
          tabIndex={-1}
          aria-label="Choose a photo"
          disabled={pending || staged.length >= PUBLIC_PHOTO_MAX}
          onChange={(event) => void choose(event.target.files)}
        />
        <p className="form-hint">{PUBLIC_REPORT_COPY.photosHint}</p>
      </div>

      {staged.length > 0 && (
        <ul className="public-report-photos">
          {staged.map((item) => (
            <li key={item.id}>
              {/* eslint-disable-next-line @next/next/no-img-element -- a blob
                  URL for a file that has not been uploaded yet; the optimiser
                  cannot fetch it and does not need to. */}
              <img src={item.preview} alt="" />
              <span>
                {formatBytes(item.file.size)}
                <small>from {formatBytes(item.chosenBytes)}</small>
              </span>
              <button type="button" className="btn small" onClick={() => remove(item.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="esh-field">
        <label htmlFor="public-report-contact">
          <span>{PUBLIC_REPORT_COPY.contact}</span>
        </label>
        <input
          id="public-report-contact"
          value={contact}
          maxLength={PUBLIC_REPORT_MAX_CONTACT}
          autoComplete="off"
          placeholder="Leave blank to stay anonymous"
          onChange={(event) => setContact(event.target.value)}
        />
        <p className="form-hint">{PUBLIC_REPORT_COPY.contactHint}</p>
      </div>

      <button
        type="button"
        className="btn primary public-report-send"
        disabled={pending || preparing > 0 || text.trim() === ''}
        onClick={send}
      >
        {pending
          ? PUBLIC_REPORT_COPY.sending
          : preparing > 0
            ? 'Preparing photos…'
            : PUBLIC_REPORT_COPY.submit}
      </button>

      {problem && (
        <p className="notice error" role="alert">
          {problem}
        </p>
      )}

      <section className="public-report-privacy" aria-labelledby="public-report-privacy-title">
        <h2 id="public-report-privacy-title">{PUBLIC_REPORT_COPY.privacyHeading}</h2>
        <ul>
          {PUBLIC_REPORT_COPY.privacy.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
