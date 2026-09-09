'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { useFileDropZone } from './useFileDropZone';

/**
 * The evidence box: one large target, used everywhere evidence is attached.
 *
 * `AttachmentPicker` is a button with a drop hint beside it. That is right in
 * a composer somebody is already typing into, and wrong at the moment of
 * completion, where attaching the proof IS the task. A one-line control there
 * reads as an afterthought and is a poor thing to aim a photo at.
 *
 * So the whole dashed area is both the click target and the drop target, and
 * the formats it takes are printed inside it rather than left to be discovered
 * by having a file refused.
 *
 * On a phone nobody drags anything. The same box opens the file chooser, and a
 * separate control opens the camera directly — which is the actual field
 * workflow for an inspection or a Gemba walk: open the routine, photograph
 * what you found, complete.
 */

const DEFAULT_ACCEPT = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
].join(',');

const DEFAULT_MAX_BYTES = 10_485_760;

function fileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1_048_576) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

/** Two files are the same file if all three of these agree. */
function sameFile(left: File, right: File) {
  return (
    left.name === right.name && left.size === right.size && left.lastModified === right.lastModified
  );
}

/** A word for the kind, so a row is scannable without reading the extension. */
function kindOf(file: File): { icon: string; label: string } {
  const type = file.type;
  const name = file.name.toLowerCase();
  if (type.startsWith('image/')) return { icon: '🖼', label: 'Image' };
  if (type === 'application/pdf' || name.endsWith('.pdf')) return { icon: '📄', label: 'PDF' };
  if (/\.(xlsx?|csv)$/.test(name) || type.includes('spreadsheet') || type.includes('excel')) {
    return { icon: '📊', label: 'Spreadsheet' };
  }
  if (/\.(pptx?)$/.test(name) || type.includes('presentation') || type.includes('powerpoint')) {
    return { icon: '📽', label: 'Slides' };
  }
  if (/\.(docx?)$/.test(name) || type.includes('word')) return { icon: '📝', label: 'Document' };
  return { icon: '📎', label: 'File' };
}

/** One file's journey, so a failure can name itself and be retried alone. */
type Staged = {
  file: File;
  state: 'ready' | 'uploading' | 'attached' | 'failed';
  error?: string;
};

export function EvidenceDropZone({
  name = 'files',
  accept = DEFAULT_ACCEPT,
  maxBytes = DEFAULT_MAX_BYTES,
  disabled = false,
  label = 'Drag and drop evidence here',
  onCountChange,
  uploadTo,
}: {
  name?: string;
  accept?: string;
  maxBytes?: number;
  disabled?: boolean;
  label?: string;
  /**
   * So the form around this can say what is still outstanding.
   *
   * The whole picture, not just the attached count. §18: completion must not
   * be possible "while any selected file is pending, failed or rejected", and
   * a form that only knows how many succeeded cannot say which of those it is
   * waiting on.
   */
  onCountChange?: (summary: { attached: number; pending: number; failed: number }) => void;
  /**
   * Upload each file as it arrives, rather than posting them with the form.
   *
   * Given a task id, files go up one at a time and each reports its own
   * outcome. Without it the zone stays a plain multi-file input, which is what
   * New Work wants: there is no record to attach to until the work exists.
   */
  uploadTo?: {
    taskId: string;
    upload: (formData: FormData) => Promise<{ ok: boolean; message: string }>;
  };
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [staged, setStaged] = useState<Staged[]>([]);
  const [error, setError] = useState<string | null>(null);

  /*
   * One at a time, and never in a batch.
   *
   * A single request carrying five photographs fails as one thing: everything
   * is discarded and somebody on a plant network starts again from the camera
   * roll, which is where people give up and complete the work with no evidence
   * at all. Per file, a failure is one row that names itself and offers Retry,
   * and the four that worked stay attached.
   */
  const send = useCallback(
    async (file: File, index: number) => {
      if (!uploadTo) return;
      setStaged((current) =>
        current.map((entry, position) =>
          position === index ? { ...entry, state: 'uploading', error: undefined } : entry,
        ),
      );
      const body = new FormData();
      body.set('taskId', uploadTo.taskId);
      body.set('file', file);

      /*
       * A refused request is a failed upload, not a permanent "Uploading…".
       *
       * The action returns `{ ok: false }` for anything the server decided.
       * A connection that drops mid-request never returns at all — it throws —
       * and without this the row stayed on "Uploading…" for ever: no Retry,
       * no Remove, and a completion that could never be finished because the
       * form was still waiting for a file that was never coming. §18 asks for
       * connectivity loss to be handled without discarding the note or the
       * files that did land, which begins with noticing it.
       */
      let result: { ok: boolean; message: string };
      try {
        result = await uploadTo.upload(body);
      } catch {
        result = { ok: false, message: 'Upload failed — check your connection and retry.' };
      }

      setStaged((current) =>
        current.map((entry, position) =>
          position === index
            ? result.ok
              ? { ...entry, state: 'attached', error: undefined }
              : { ...entry, state: 'failed', error: result.message }
            : entry,
        ),
      );
    },
    [uploadTo],
  );

  /*
   * The input is the record, the state is the display.
   *
   * The form posts `input.files`, so every route in — the OS chooser, the
   * camera, a drop — has to end up writing that same list rather than keeping
   * its own on the side.
   */
  const commit = useCallback((next: File[]) => {
    const input = inputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    for (const file of next) transfer.items.add(file);
    input.files = transfer.files;
    setFiles(next);
  }, []);

  const take = useCallback(
    (incoming: File[]) => {
      const oversized = incoming.find((file) => file.size > maxBytes);
      if (oversized) {
        setError(`${oversized.name} exceeds the ${Math.floor(maxBytes / 1_048_576)} MB limit.`);
        return;
      }
      setError(null);
      // Added, not replaced: a second photo after a first means both.
      const next = [
        ...files,
        ...incoming.filter((file) => !files.some((have) => sameFile(have, file))),
      ];
      commit(next);

      if (uploadTo) {
        const added = next.slice(files.length);
        setStaged((current) => [
          ...current,
          ...added.map((file) => ({ file, state: 'ready' as const })),
        ]);
        // Sequential rather than parallel: a phone on a plant network does not
        // go faster with five requests in flight, and the failures interleave
        // into noise nobody can act on.
        void (async () => {
          for (let position = 0; position < added.length; position += 1) {
            await send(added[position]!, files.length + position);
          }
        })();
      }
    },
    [commit, files, maxBytes, send, uploadTo],
  );

  const { dragging } = useFileDropZone({ onFiles: take, anchorRef: rootRef, disabled });

  /*
   * Thumbnails for images, because a filename is a poor way to tell one site
   * photograph from another and removing the wrong one is easy. Revoked when
   * the list changes, or every drop leaks a blob for the life of the page.
   */
  const previews = useMemo(
    () => files.map((file) => (file.type.startsWith('image/') ? URL.createObjectURL(file) : null)),
    [files],
  );
  useEffect(
    () => () => {
      for (const url of previews) if (url) URL.revokeObjectURL(url);
    },
    [previews],
  );

  const openChooser = () => inputRef.current?.click();
  const attachedCount = uploadTo
    ? staged.filter((entry) => entry.state === 'attached').length
    : files.length;
  /*
   * Chosen but not yet on the record, and chosen but refused.
   *
   * Without `uploadTo` nothing uploads here — the files post with the form —
   * so there is nothing outstanding to report.
   */
  const pendingCount = uploadTo
    ? staged.filter((entry) => entry.state === 'ready' || entry.state === 'uploading').length
    : 0;
  const failedCount = uploadTo ? staged.filter((entry) => entry.state === 'failed').length : 0;

  /*
   * Reported from the state rather than from inside the upload loop, so the
   * numbers the form sees are always what is actually on the record - not how
   * far a loop had got when it last called back.
   */
  useEffect(() => {
    onCountChange?.({ attached: attachedCount, pending: pendingCount, failed: failedCount });
  }, [attachedCount, pendingCount, failedCount, onCountChange]);

  return (
    /*
      §18 — the whole panel takes the drop, not this box.
      
      This element used to carry `data-drop-zone`, which made it the target:
      `closest('[data-drop-zone]')` finds the anchor itself first, so the zone
      stopped at the bordered evidence area. §18 asks for "the entire
      completion panel", because somebody dragging a photograph aims at what
      they have been reading rather than at a control. Without the marker the
      hook walks up to the form, which is exactly that panel — and the
      bordered area inside stays clickable and droppable in its own right.
    */
    <div ref={rootRef} className="evidence-zone">
      <input
        ref={inputRef}
        id={id}
        className="visually-hidden file-input"
        {...(uploadTo ? {} : { name })}
        type="file"
        multiple
        disabled={disabled}
        accept={accept}
        aria-label="Evidence files"
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          if (selected.length > 0) take(selected);
          // The input already holds the browser's choice, so a rejected batch
          // has to be written back over it rather than simply not applied.
          else commit(files);
        }}
      />
      {/*
        A second input, for the camera. `capture` is what turns a chooser into
        the camera on a phone, and it cannot be toggled on the main input
        without also constraining the desktop chooser to one file.
      */}
      <input
        ref={cameraRef}
        className="visually-hidden file-input"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        aria-label="Take a photograph as evidence"
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          if (selected.length > 0) take(selected);
          event.currentTarget.value = '';
        }}
      />

      <button
        type="button"
        className={`evidence-target${dragging ? ' dragging' : ''}`}
        disabled={disabled}
        onClick={openChooser}
      >
        <span className="evidence-target-title">
          {dragging ? 'Drop to attach' : files.length > 0 ? 'Add more evidence' : label}
        </span>
        <span className="evidence-target-sub">or click to choose files</span>
        {/* Said here rather than discovered by having a file refused. */}
        <span className="evidence-target-formats">Photos · PDF · Word · Excel · PowerPoint</span>
      </button>

      <button
        type="button"
        className="btn small evidence-camera"
        disabled={disabled}
        onClick={() => cameraRef.current?.click()}
      >
        Take photo
      </button>

      {error && (
        <p className="evidence-error" role="alert">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <div className="evidence-list" aria-live="polite">
          {/*
            §18 — the summary says what is actually happening.

            It used to read "Uploading 2 of 2…" whenever the attached count was
            short of the total, which is also true when one of them has
            FAILED — so a list showing one attached and one refused was headed
            by a sentence claiming both were still in flight. Nothing was
            uploading, and the only line describing the group as a whole said
            otherwise.
          */}
          <p className="evidence-list-head">
            {!uploadTo
              ? `${files.length} file${files.length === 1 ? '' : 's'} ready`
              : pendingCount > 0
                ? `Uploading ${Math.min(attachedCount + 1, files.length)} of ${files.length}…`
                : failedCount > 0
                  ? `${attachedCount} of ${files.length} attached · ${failedCount} could not be uploaded`
                  : `${files.length} file${files.length === 1 ? '' : 's'} attached`}
          </p>
          {files.map((file, index) => {
            const kind = kindOf(file);
            const preview = previews[index];
            const entry = staged[index];
            return (
              <div key={`${file.name}-${file.lastModified}-${index}`} className="evidence-item">
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="evidence-thumb" src={preview} alt="" />
                ) : (
                  <span className="evidence-thumb evidence-icon" aria-hidden="true">
                    {kind.icon}
                  </span>
                )}
                <span className="evidence-item-copy">
                  <strong>{file.name}</strong>
                  <span className={entry?.state === 'failed' ? 'evidence-item-error' : undefined}>
                    {kind.label} · {fileSize(file.size)}
                    {entry?.state === 'uploading' ? ' · Uploading…' : ''}
                    {entry?.state === 'attached' ? ' · Attached' : ''}
                    {entry?.state === 'failed' ? ` · ${entry.error ?? 'Upload failed'}` : ''}
                  </span>
                </span>

                {/*
                  One file's retry, not the whole batch's. The four that worked
                  stay attached; starting again from the camera roll because of
                  one failure is where somebody gives up and completes the work
                  with no evidence at all.
                */}
                {entry?.state === 'failed' && (
                  <button
                    type="button"
                    className="btn small evidence-retry"
                    onClick={() => void send(file, index)}
                  >
                    Retry
                  </button>
                )}
                {/* Removable before completing, because an accidental photo
                    should not have to be attached to the record forever. */}
                {/*
                  Only before it is attached. Once a file is on the record,
                  taking it off again is an operation on the work with its own
                  authority and its own audit entry - not a tidy-up of a form.
                */}
                {entry?.state !== 'attached' && (
                  <button
                    type="button"
                    className="evidence-remove"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => {
                      commit(files.filter((_, position) => position !== index));
                      setStaged((current) => current.filter((_, position) => position !== index));
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
