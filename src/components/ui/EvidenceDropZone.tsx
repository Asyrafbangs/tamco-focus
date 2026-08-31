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

export function EvidenceDropZone({
  name = 'files',
  accept = DEFAULT_ACCEPT,
  maxBytes = DEFAULT_MAX_BYTES,
  disabled = false,
  label = 'Drag and drop evidence here',
  onCountChange,
}: {
  name?: string;
  accept?: string;
  maxBytes?: number;
  disabled?: boolean;
  label?: string;
  /** So the form around this can say what is still outstanding. */
  onCountChange?: (count: number) => void;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  /*
   * The input is the record, the state is the display.
   *
   * The form posts `input.files`, so every route in — the OS chooser, the
   * camera, a drop — has to end up writing that same list rather than keeping
   * its own on the side.
   */
  const commit = useCallback(
    (next: File[]) => {
      const input = inputRef.current;
      if (!input) return;
      const transfer = new DataTransfer();
      for (const file of next) transfer.items.add(file);
      input.files = transfer.files;
      setFiles(next);
      onCountChange?.(next.length);
    },
    [onCountChange],
  );

  const take = useCallback(
    (incoming: File[]) => {
      const oversized = incoming.find((file) => file.size > maxBytes);
      if (oversized) {
        setError(`${oversized.name} exceeds the ${Math.floor(maxBytes / 1_048_576)} MB limit.`);
        return;
      }
      setError(null);
      // Added, not replaced: a second photo after a first means both.
      commit([...files, ...incoming.filter((file) => !files.some((have) => sameFile(have, file)))]);
    },
    [commit, files, maxBytes],
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

  return (
    <div ref={rootRef} className="evidence-zone" data-drop-zone>
      <input
        ref={inputRef}
        id={id}
        className="visually-hidden file-input"
        name={name}
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
          <p className="evidence-list-head">
            {files.length} file{files.length === 1 ? '' : 's'} ready
          </p>
          {files.map((file, index) => {
            const kind = kindOf(file);
            const preview = previews[index];
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
                  <span>
                    {kind.label} · {fileSize(file.size)}
                  </span>
                </span>
                {/* Removable before completing, because an accidental photo
                    should not have to be attached to the record forever. */}
                <button
                  type="button"
                  className="evidence-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => commit(files.filter((_, position) => position !== index))}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
