'use client';

import { useEffect } from 'react';

import type { TaskDetailAttachment } from '@/server/queries';

/**
 * Reading a file instead of downloading it.
 *
 * Clicking a row used to hand the file straight to the operating system, which
 * for the commonest case - "what did Amer actually attach?" - is three steps
 * too many: download, find it, open it, and now there is a copy in Downloads
 * nobody asked for. Most of these are one inspection photo or a two-page PDF,
 * and the answer to the question is visible in a second.
 *
 * Rendered inside the drawer rather than as another dialog on top of it, so
 * closing the file returns to the task rather than to nothing.
 */

export function canPreview(mimeType: string) {
  return mimeType === 'application/pdf' || /^image\/(png|jpeg|webp|gif)$/.test(mimeType);
}

export function AttachmentViewer({
  file,
  onClose,
}: {
  file: TaskDetailAttachment;
  onClose: () => void;
}) {
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

  const inlineSrc = `/api/attachments/${file.id}?inline=1`;
  const isImage = file.mimeType.startsWith('image/');

  return (
    <div className="attachment-viewer">
      {isImage ? (
        <>
          {/* A private, signed, arbitrary-dimension upload: next/image would
              need a loader and a size it cannot know, and would cache a URL
              that expires. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={inlineSrc} alt={file.fileName} className="attachment-viewer-image" />
        </>
      ) : (
        /*
         * An iframe rather than a bundled renderer. Every browser this runs in
         * has a PDF viewer with search, zoom and print already, and it fits to
         * width by default; shipping pdf.js would add a megabyte to do worse.
         */
        <iframe src={inlineSrc} title={file.fileName} className="attachment-viewer-frame" />
      )}
    </div>
  );
}
