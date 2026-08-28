'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Dropping a file onto a target, and pasting one into it.
 *
 * Three things have to be right for a drop zone to actually work, and the
 * naive version gets two of them wrong.
 *
 * 1. `dragover` must be prevented, every time. The browser's default is to
 *    navigate to the dropped file, so a zone that only handles `drop` throws
 *    the page away - and with it whatever was typed - the moment somebody
 *    lets go.
 *
 * 2. `dragleave` fires when the pointer crosses onto a CHILD of the zone, not
 *    only when it leaves. Clearing the highlight on it makes the zone flicker
 *    as the pointer moves over the text inside it. Counting enter and leave
 *    against each other is what fixes that.
 *
 * 3. Missing the zone is the common accident, and the cost of it is the same
 *    lost page as (1). While a zone is mounted, the document refuses drops
 *    that land anywhere else, so a near miss does nothing instead of
 *    navigating away.
 */
export function useFileDropZone({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    if (disabled) return;
    // (3) - a drop that misses is a no-op, not a navigation.
    const swallow = (event: DragEvent) => {
      if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
    };
    document.addEventListener('dragover', swallow);
    document.addEventListener('drop', swallow);
    return () => {
      document.removeEventListener('dragover', swallow);
      document.removeEventListener('drop', swallow);
    };
  }, [disabled]);

  const carriesFiles = (event: React.DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const onDragEnter = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    [disabled],
  );

  const onDragOver = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      // (1) - without this the drop never reaches us.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    },
    [disabled],
  );

  const onDragLeave = useCallback(
    (event: React.DragEvent) => {
      if (disabled || !carriesFiles(event)) return;
      event.preventDefault();
      // (2) - only when the last enter has been matched.
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    [disabled],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      if (disabled) return;
      event.preventDefault();
      event.stopPropagation();
      depth.current = 0;
      setDragging(false);
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length) onFiles(dropped);
    },
    [disabled, onFiles],
  );

  // A screenshot on the clipboard is the same intent as a file on the pointer.
  const onPaste = useCallback(
    (event: React.ClipboardEvent) => {
      if (disabled) return;
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length) onFiles(pasted);
    },
    [disabled, onFiles],
  );

  return {
    dragging,
    dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop, onPaste },
  };
}
