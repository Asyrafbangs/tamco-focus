'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Makes the whole box that contains a file picker accept dropped files.
 *
 * The zone is deliberately not the picker itself. The picker is one short row
 * of controls, and a target that small is both hard to hit and easy to miss
 * entirely - somebody dragging a photo aims at the composer they have been
 * typing in, not at the button underneath it. So this walks up from the picker
 * to the box it lives in and listens there.
 *
 * Three things have to be right, and the naive version gets two of them wrong.
 *
 * 1. `dragover` must be prevented, every time. The browser's default is to
 *    navigate to the dropped file, so a zone that only handles `drop` throws
 *    the page away - and with it whatever was typed - the moment somebody
 *    lets go.
 *
 * 2. `dragleave` fires when the pointer crosses onto a CHILD of the zone, not
 *    only when it leaves. Clearing the highlight on it makes the zone flicker
 *    as the pointer moves across the textarea inside it. Counting enter and
 *    leave against each other is what fixes that.
 *
 * 3. Missing the box is still possible, and costs the same lost page as (1).
 *    While a zone is mounted the document refuses drops that land anywhere
 *    else, so a near miss does nothing instead of navigating away.
 *
 * Native listeners rather than React props, because the element being listened
 * to is one this component does not render.
 */
export function useFileDropZone({
  onFiles,
  anchorRef,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  /** Any element inside the box. The zone is resolved by walking up from it. */
  anchorRef: RefObject<HTMLElement | null>;
  disabled?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  // Held in a ref so the listeners never have to be rebound when the callback
  // changes identity, which it does on every render that touches the file list.
  const latest = useRef(onFiles);
  useEffect(() => {
    latest.current = onFiles;
  }, [onFiles]);

  useEffect(() => {
    if (disabled) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    /*
     * An explicit `data-drop-zone` wins, then the form, then the immediate
     * parent. The form is the right default: it is exactly the box somebody
     * has been working in.
     */
    const zone =
      anchor.closest<HTMLElement>('[data-drop-zone]') ??
      anchor.closest<HTMLElement>('form') ??
      anchor.parentElement;
    if (!zone) return;

    const carriesFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    let depth = 0;
    const paint = (on: boolean) => {
      setDragging(on);
      zone.classList.toggle('is-file-dragging', on);
    };

    const onDragEnter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth += 1;
      paint(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // (1) - without this the drop never reaches us.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // (2) - only once the last enter has been matched.
      depth = Math.max(0, depth - 1);
      if (depth === 0) paint(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      depth = 0;
      paint(false);
      const dropped = Array.from(event.dataTransfer?.files ?? []);
      if (dropped.length) latest.current(dropped);
    };
    // A screenshot on the clipboard is the same intent as a file on the pointer.
    const onPaste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length) latest.current(pasted);
    };
    // (3) - a drop that misses the box is a no-op, not a navigation.
    const swallow = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };

    zone.addEventListener('dragenter', onDragEnter);
    zone.addEventListener('dragover', onDragOver);
    zone.addEventListener('dragleave', onDragLeave);
    zone.addEventListener('drop', onDrop);
    zone.addEventListener('paste', onPaste);
    document.addEventListener('dragover', swallow);
    document.addEventListener('drop', swallow);

    return () => {
      zone.classList.remove('is-file-dragging');
      zone.removeEventListener('dragenter', onDragEnter);
      zone.removeEventListener('dragover', onDragOver);
      zone.removeEventListener('dragleave', onDragLeave);
      zone.removeEventListener('drop', onDrop);
      zone.removeEventListener('paste', onPaste);
      document.removeEventListener('dragover', swallow);
      document.removeEventListener('drop', swallow);
    };
  }, [anchorRef, disabled]);

  return { dragging };
}
