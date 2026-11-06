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

/*
 * v293 - two small marks, drawn rather than named.
 *
 * "Take photo" and "Choose photo" are two words apart and one is the wrong
 * one to press when you are holding a phone in a noisy building. A camera and
 * a stack of pictures are told apart at a glance in a way that two labels are
 * not. Inline and `currentColor`, so they follow the theme and add nothing to
 * load.
 */
function CameraMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function GalleryMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <rect
        x="3"
        y="6"
        width="18"
        height="13"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="m5 16 4-4 3 3 3-3 4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" />
    </svg>
  );
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
export function PublicReportForm({ code }: { code: string }) {
  const [text, setText] = useState('');
  /*
   * v293 - the required field says so once somebody has been in it and left
   * it empty, rather than at the moment the page opens. Send stays disabled
   * either way; this is the sentence that explains why.
   */
  const [observationTouched, setObservationTouched] = useState(false);
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

  const observationMissing = observationTouched && text.trim() === '';

  return (
    <div className="public-report">
      <div className="esh-field">
        <label htmlFor="public-report-text">
          <span>
            {PUBLIC_REPORT_COPY.observation} <span aria-hidden="true">*</span>
          </span>
        </label>
        <textarea
          id="public-report-text"
          value={text}
          rows={3}
          maxLength={PUBLIC_REPORT_MAX_TEXT}
          required
          autoFocus
          aria-invalid={observationMissing || undefined}
          aria-describedby={observationMissing ? 'public-report-text-problem' : undefined}
          placeholder="The guard is off the bench grinder and it is still being used."
          onBlur={() => setObservationTouched(true)}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
            if (event.target.value.trim() !== '') setObservationTouched(false);
            /*
             * Grows with what is typed, within a limit. Three rows is the
             * right size for an empty box and the wrong one for a paragraph,
             * and a box that scrolls internally on a phone hides the first
             * line of what somebody has just written.
             */
            const field = event.target;
            field.style.height = 'auto';
            field.style.height = `${Math.min(field.scrollHeight, 320)}px`;
          }}
        />
        {/*
         * v293 — always here, shown or not, so the page does not move.
         *
         * The box above is focused when the page opens, so the first tap
         * anywhere else blurs an empty required field and this sentence
         * appears. Rendered conditionally it added a line and pushed
         * everything below it down by 23px between finger-down and
         * finger-up — measured — which means the control somebody was
         * reaching for is no longer under their finger when they let go.
         * On a phone that is a tap that silently does nothing; the first
         * thing it cost was a browser test that could not open a disclosure
         * it was pointing straight at.
         */}
        <p
          id="public-report-text-problem"
          className="esh-field-error public-report-problem-slot"
          data-shown={observationMissing || undefined}
          role="alert"
        >
          {observationMissing ? PUBLIC_REPORT_COPY.observationMissing : ''}
        </p>
      </div>

      <div className="esh-field">
        <label htmlFor="public-report-where">
          <span>{PUBLIC_REPORT_COPY.locationLabel}</span>
        </label>
        <input
          id="public-report-where"
          value={where}
          maxLength={160}
          placeholder={PUBLIC_REPORT_COPY.locationPlaceholder}
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
            <CameraMark />
            Take photo
          </button>
          <button
            type="button"
            className="btn"
            disabled={pending || staged.length >= PUBLIC_PHOTO_MAX || preparing > 0}
            onClick={() => chooser.current?.click()}
          >
            <GalleryMark />
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

      {(staged.length > 0 || preparing > 0) && (
        <ul className="public-report-photos">
          {/*
           * v293 - a place for each photograph while it is being made ready.
           *
           * A re-encode of a full-size phone frame takes a second or two, and
           * until it finished nothing at all appeared: the screen looked as
           * though the picture had been refused. Send is already held back
           * while this runs; this is the part somebody can see.
           */}
          {Array.from({ length: preparing }, (_, index) => (
            <li key={`preparing-${index}`} className="public-report-preparing">
              <span className="public-report-thumb-pending" aria-hidden="true" />
              <span role="status">Preparing…</span>
            </li>
          ))}
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
          /*
           * v293 - a plain text field, not `type="email"`.
           *
           * An extension number is a perfectly good way to be reached in a
           * plant, and a browser that refuses to submit "4412" because it is
           * not an email address turns an optional field into a dead end.
           */
          placeholder={PUBLIC_REPORT_COPY.contactPlaceholder}
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

      {/*
       * v293 - the heading and one sentence are on the page; the rest is a
       * disclosure. Four paragraphs under a Send button are four paragraphs
       * nobody reads, and the part that changes somebody's behaviour - that
       * contact details are optional - is the part that has to be visible.
       */}
      <section className="public-report-privacy" aria-labelledby="public-report-privacy-title">
        <h2 id="public-report-privacy-title">{PUBLIC_REPORT_COPY.privacyHeading}</h2>
        <p>{PUBLIC_REPORT_COPY.privacySummary}</p>
        <details>
          <summary>What happens to this report</summary>
          <ul>
            {PUBLIC_REPORT_COPY.privacy.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
