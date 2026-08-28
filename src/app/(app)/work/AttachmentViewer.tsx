'use client';

import { useEffect, useState } from 'react';

import type { TaskDetailAttachment } from '@/server/queries';

/**
 * Reading a file instead of downloading it.
 *
 * Clicking a row used to hand the file straight to the operating system, which
 * for the commonest case - "what did they actually attach?" - is three steps
 * too many: download, find it, open it, and now there is a copy in Downloads
 * nobody asked for. Most of these are one inspection photo or a two-page PDF.
 *
 * Rendered inside the drawer rather than as another dialog on top of it, so
 * closing the file returns to the task rather than to nothing.
 */

export function canPreview(mimeType: string) {
  return mimeType === 'application/pdf' || /^image\/(png|jpeg|webp|gif)$/.test(mimeType);
}

type Source = { url: string } | { error: string } | null;

export function AttachmentViewer({
  file,
  onClose,
}: {
  file: TaskDetailAttachment;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>(null);

  /*
   * Escape belongs to the file first.
   *
   * The drawer listens for Escape on the document and closes the whole task.
   * While a file is open, the reasonable meaning of Escape is "close the
   * file" - so this listens in the capture phase, which runs before the
   * drawer's bubble-phase handler, and stops the event there.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  /*
   * Fetched, then framed as a blob - not pointed at the route directly.
   *
   * Twice now a PDF has come back as the browser's grey "Open" placeholder
   * rather than the document, because whether a response renders or downloads
   * is decided by `Content-Disposition`, and that header passed through a
   * storage service, a redirect and a proxy before reaching the frame. A
   * `blob:` URL carries no disposition at all: there is nothing left to say
   * "download me". The type comes from our own record, so it is right even if
   * the object was stored without one.
   *
   * The fetch is same-origin and sends the session cookie, so authorisation
   * and the access record are unchanged.
   */
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/attachments/${file.id}?inline=1`, {
          credentials: 'same-origin',
        });
        if (!response.ok) throw new Error(`The file could not be loaded (${response.status}).`);
        const downloaded = await response.blob();
        if (cancelled) return;
        // Retyped from our own record rather than trusting the response.
        objectUrl = URL.createObjectURL(
          new Blob([await downloaded.arrayBuffer()], { type: file.mimeType }),
        );
        setSource({ url: objectUrl });
      } catch (problem) {
        if (cancelled) return;
        setSource({
          error: problem instanceof Error ? problem.message : 'The file could not be loaded.',
        });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, file.mimeType]);

  const isImage = file.mimeType.startsWith('image/');

  return (
    <div className="attachment-viewer">
      {source === null && (
        <p className="muted" role="status">
          Loading {file.fileName}…
        </p>
      )}

      {source && 'error' in source && (
        <div className="attachment-viewer-failed" role="alert">
          <strong>{source.error}</strong>
          <p>Downloading it still works.</p>
          <a
            className="btn small"
            href={`/api/attachments/${file.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Download {file.fileName}
          </a>
        </div>
      )}

      {source && 'url' in source && isImage && (
        <>
          {/* A private, arbitrary-dimension upload held as a blob: next/image
              would need a loader and a size it cannot know. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source.url} alt={file.fileName} className="attachment-viewer-image" />
        </>
      )}

      {source && 'url' in source && !isImage && (
        /*
         * An iframe rather than a bundled renderer. Every browser this runs in
         * has a PDF viewer with search, zoom and print already, and it fits to
         * width by default; shipping pdf.js would add a megabyte to do worse.
         */
        <iframe src={source.url} title={file.fileName} className="attachment-viewer-frame" />
      )}
    </div>
  );
}
