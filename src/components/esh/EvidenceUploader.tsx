'use client';

import { createClient } from '@supabase/supabase-js';
import { useRef, useState } from 'react';

import {
  EVIDENCE_ACCEPT,
  evidenceLabel,
  evidenceProblem,
  uploadContentType,
} from '@/domain/esh-evidence';
import { publicEnv } from '@/lib/env';
import type { FinishUpload, ReadyFile, StartUpload } from '@/server/esh/evidence-actions';

const BUCKET = 'finding-evidence';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  status: 'uploading' | 'ready' | 'failed';
  message: string | null;
  assetId: string | null;
  file: File | null;
}

export interface UploaderApi {
  start: (file: File) => Promise<StartUpload>;
  finish: (assetId: string) => Promise<FinishUpload>;
  remove: (assetId: string) => Promise<{ ok: boolean }>;
}

/** Items from files already uploaded and not yet sent (a reload keeps them). */
export function readyItems(files: ReadyFile[]): UploadItem[] {
  return files.map((file) => ({
    key: file.id,
    name: file.name,
    size: file.size,
    status: 'ready',
    message: null,
    assetId: file.id,
    file: null,
  }));
}

/**
 * The upload list under a composer (§11, §23): each file says whether it is
 * uploading, ready or refused, with Retry and Remove. A file that fails does
 * not take the others with it (FM47).
 *
 * Bytes go straight from the browser to private storage with a one-time URL
 * the server signed for exactly this file; the anonymous key used here can do
 * nothing else in that bucket.
 */
export function useEvidenceUploads(
  api: UploaderApi,
  initial: UploadItem[] = [],
  options: { dropWhenReady?: boolean; onReady?: () => void } = {},
) {
  const [items, setItems] = useState<UploadItem[]>(initial);
  const counter = useRef(0);

  function update(key: string, patch: Partial<UploadItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function run(key: string, file: File) {
    update(key, { status: 'uploading', message: null });
    const problem = evidenceProblem(file.name, file.size);
    if (problem) {
      update(key, { status: 'failed', message: problem });
      return;
    }
    try {
      const started = await api.start(file);
      if (!started.ok) {
        update(key, { status: 'failed', message: started.message });
        return;
      }
      const storage = createClient(
        publicEnv.NEXT_PUBLIC_SUPABASE_URL,
        publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      ).storage.from(BUCKET);
      const sent = await storage.uploadToSignedUrl(started.path, started.token, file, {
        contentType: uploadContentType(file.name),
      });
      if (sent.error) {
        // Nothing arrived: let the record go, so it does not count against
        // the ten a message may carry. Retry starts afresh.
        void api.remove(started.assetId);
        update(key, {
          status: 'failed',
          message: 'The upload did not finish. Check the connection and try again.',
          assetId: null,
        });
        return;
      }
      const finished = await api.finish(started.assetId);
      if (!finished.ok) {
        update(key, { status: 'failed', message: finished.message, assetId: null });
        return;
      }
      if (options.dropWhenReady) {
        setItems((current) => current.filter((item) => item.key !== key));
      } else {
        update(key, { status: 'ready', message: null, assetId: finished.file.id, file: null });
      }
      options.onReady?.();
    } catch {
      update(key, { status: 'failed', message: 'The upload did not finish. Try again.' });
    }
  }

  function add(files: FileList | File[]) {
    const list = Array.from(files);
    const fresh = list.map((file) => {
      counter.current += 1;
      return {
        key: `new-${counter.current}`,
        name: file.name,
        size: file.size,
        status: 'uploading' as const,
        message: null,
        assetId: null,
        file,
      };
    });
    setItems((current) => [...current, ...fresh]);
    for (const item of fresh) void run(item.key, item.file);
  }

  function retry(key: string) {
    const item = items.find((entry) => entry.key === key);
    if (item?.file) void run(key, item.file);
  }

  async function remove(key: string) {
    const item = items.find((entry) => entry.key === key);
    setItems((current) => current.filter((entry) => entry.key !== key));
    if (item?.assetId && item.status !== 'failed') await api.remove(item.assetId);
  }

  function clearSent() {
    setItems((current) => current.filter((item) => item.status !== 'ready'));
  }

  const readyIds = items
    .filter((item) => item.status === 'ready' && item.assetId)
    .map((item) => item.assetId as string);
  const busy = items.some((item) => item.status === 'uploading');
  const unresolved = items.some((item) => item.status === 'failed');

  return { items, add, retry, remove, clearSent, readyIds, busy, unresolved };
}

export function UploadList({
  uploads,
}: {
  uploads: Pick<ReturnType<typeof useEvidenceUploads>, 'items' | 'retry' | 'remove'>;
}) {
  if (uploads.items.length === 0) return null;
  return (
    <ul className="esh-upload-list" aria-label="Files to send">
      {uploads.items.map((item) => (
        <li key={item.key} className="esh-upload" data-status={item.status}>
          <span className="esh-file-icon" aria-hidden="true">
            ▧
          </span>
          <span className="esh-upload-text">
            <strong>{item.name}</strong>
            <small>
              {item.status === 'uploading'
                ? 'Uploading…'
                : item.status === 'failed'
                  ? item.message
                  : `${evidenceLabel(item.name, item.size)} · Ready to send`}
            </small>
          </span>
          <span className="esh-upload-actions">
            {item.status === 'failed' && item.file && (
              <button
                type="button"
                className="btn small"
                onClick={() => uploads.retry(item.key)}
                aria-label={`Retry ${item.name}`}
              >
                Retry
              </button>
            )}
            {item.status !== 'uploading' && (
              <button
                type="button"
                className="btn ghost small"
                onClick={() => void uploads.remove(item.key)}
                aria-label={`Remove ${item.name}`}
              >
                Remove
              </button>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Attach and Photo, visible for keyboard and phone users (§11). */
export function AttachButtons({
  onFiles,
  disabled,
}: {
  onFiles: (files: FileList) => void;
  disabled?: boolean;
}) {
  const attach = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  return (
    <span className="esh-attach-buttons">
      <button
        type="button"
        className="btn ghost small"
        onClick={() => attach.current?.click()}
        disabled={disabled}
      >
        + Attach
      </button>
      <button
        type="button"
        className="btn ghost small"
        onClick={() => photo.current?.click()}
        disabled={disabled}
      >
        Photo
      </button>
      <input
        ref={attach}
        type="file"
        multiple
        accept={EVIDENCE_ACCEPT}
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Attach files"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={photo}
        type="file"
        accept="image/*"
        capture="environment"
        className="visually-hidden"
        tabIndex={-1}
        aria-label="Take a photo"
        onChange={(event) => {
          if (event.target.files?.length) onFiles(event.target.files);
          event.target.value = '';
        }}
      />
    </span>
  );
}
