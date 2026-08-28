'use client';

import { useCallback, useId, useRef, useState } from 'react';

import { FileSourceMenu, type FileSource } from './FileSourceMenu';
import { AttachmentChip } from './ParityPrimitives';
import { useFileDropZone } from './useFileDropZone';

const DEFAULT_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,.xlsx,.docx';
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

export function AttachmentPicker({
  label = 'Add evidence',
  name = 'files',
  multiple = true,
  required = false,
  disabled = false,
  accept = DEFAULT_ACCEPT,
  maxBytes = DEFAULT_MAX_BYTES,
  hint,
}: {
  label?: string;
  name?: string;
  multiple?: boolean;
  required?: boolean;
  disabled?: boolean;
  accept?: string;
  maxBytes?: number;
  hint?: string;
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  /*
   * The input is the record, the state is the display.
   *
   * The form posts `input.files`, so every route in - the OS chooser, a drop,
   * a paste - has to end up writing that same list rather than keeping its own
   * on the side.
   */
  const commit = useCallback((next: File[]) => {
    const input = inputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    for (const file of next) transfer.items.add(file);
    input.files = transfer.files;
    setFiles(next);
  }, []);

  const accepted = useCallback(
    (incoming: File[], held: File[]) => {
      const oversized = incoming.find((file) => file.size > maxBytes);
      if (oversized) {
        setError(`${oversized.name} exceeds the ${Math.floor(maxBytes / 1_048_576)} MB limit.`);
        return null;
      }
      setError(null);
      if (!multiple) return incoming.slice(0, 1);
      /*
       * Added, not replaced. Somebody dropping a second photo after a first
       * means both, and replacing would discard the first without saying so.
       */
      return [...held, ...incoming.filter((file) => !held.some((have) => sameFile(have, file)))];
    },
    [maxBytes, multiple],
  );

  const take = useCallback(
    (incoming: File[]) => {
      const next = accepted(incoming, files);
      if (next) commit(next);
    },
    [accepted, commit, files],
  );

  /*
   * The drop target is the box this picker sits in, not the picker's own row.
   * A one-line strip is a poor thing to aim a file at, and somebody dragging a
   * photo aims at the composer they have been typing in.
   */
  const { dragging } = useFileDropZone({ onFiles: take, anchorRef: rootRef, disabled });

  /*
   * One input, retargeted.
   *
   * Three inputs would post three fields under the same name and make the form
   * contract depend on which one somebody happened to use. Setting the
   * attributes on the single named input before opening it keeps what the form
   * submits identical to what it always submitted.
   */
  function openWith(source: FileSource) {
    const input = inputRef.current;
    if (!input) return;
    if (source === 'camera') {
      input.accept = 'image/*';
      input.setAttribute('capture', 'environment');
    } else {
      input.removeAttribute('capture');
      input.accept = source === 'photo' ? 'image/*' : accept;
    }
    input.click();
  }

  return (
    <div ref={rootRef} className="attachment-picker">
      <input
        ref={inputRef}
        id={id}
        className="visually-hidden file-input"
        name={name}
        type="file"
        multiple={multiple}
        required={required}
        disabled={disabled}
        accept={accept}
        aria-label={`${label} native file input`}
        onChange={(event) => {
          const selected = Array.from(event.currentTarget.files ?? []);
          if (selected.length === 0) return;
          const next = accepted(selected, files);
          // The input already holds the browser's choice, so a rejected batch
          // has to be written back over it rather than simply not applied.
          commit(next ?? files);
        }}
      />
      <FileSourceMenu
        label={label}
        disabled={disabled}
        className="attachment-picker-menu"
        onPick={openWith}
      />
      {hint && <span className="attachment-picker-hint">{hint}</span>}
      {!disabled && (
        <span className="attachment-picker-drophint">
          {dragging ? 'Drop to attach' : 'or drop files anywhere in this box'}
        </span>
      )}
      {error && (
        <span className="attachment-picker-error" role="alert">
          {error}
        </span>
      )}
      {files.length > 0 && (
        <div className="attachment-chip-list" aria-live="polite">
          {files.map((file, index) => (
            <AttachmentChip
              key={`${file.name}-${file.lastModified}-${index}`}
              name={file.name}
              meta={fileSize(file.size)}
              onRemove={() => commit(files.filter((_, fileIndex) => fileIndex !== index))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
