'use client';

import { useId, useRef, useState } from 'react';

import { AttachmentChip } from './ParityPrimitives';

const DEFAULT_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv,.xlsx,.docx';
const DEFAULT_MAX_BYTES = 10_485_760;

function fileSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1_048_576) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  function sync(next: File[]) {
    const input = inputRef.current;
    if (!input) return;
    const transfer = new DataTransfer();
    for (const file of next) transfer.items.add(file);
    input.files = transfer.files;
    setFiles(next);
  }

  return (
    <div className="attachment-picker">
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
          const oversized = selected.find((file) => file.size > maxBytes);
          if (oversized) {
            setError(`${oversized.name} exceeds the ${Math.floor(maxBytes / 1_048_576)} MB limit.`);
            sync([]);
            return;
          }
          setError(null);
          setFiles(selected);
        }}
      />
      <button
        type="button"
        className="btn small attachment-picker-button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <span aria-hidden="true">+</span>
        {label}
      </button>
      {hint && <span className="attachment-picker-hint">{hint}</span>}
      {error && (
        <span className="attachment-picker-error" role="alert">
          {error}
        </span>
      )}
      {files.length > 0 && (
        <div className="attachment-chip-list" aria-live="polite">
          {files.map((file, index) => (
            <AttachmentChip
              key={`${file.name}-${file.lastModified}`}
              name={file.name}
              meta={fileSize(file.size)}
              onRemove={() => sync(files.filter((_, fileIndex) => fileIndex !== index))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
