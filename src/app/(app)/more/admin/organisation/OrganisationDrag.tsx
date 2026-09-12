'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Dragging a person onto a manager, as an enhancement and nothing more (v169).
 *
 * A drop never saves. It navigates to the same confirmation the "Change
 * manager" control opens, with the proposed manager filled in, because an
 * organisation is not something to rearrange by accident: the thing that makes
 * drag-and-drop pleasant — no dialogue, no ceremony — is exactly what makes it
 * dangerous when the consequence is "who does this person answer to".
 *
 * The markup it drives is rendered on the server and works without any of
 * this: every row already carries a link to the same place. This attaches to
 * what is there rather than replacing it, so a keyboard, a phone, or a script
 * that never ran all leave a working screen. The effect below is itself the
 * guarantee that `draggable` appears only where it can work — effects do not
 * run on the server, and nothing here is rendered.
 */
export function OrganisationDrag({ query }: { query: string }) {
  const router = useRouter();
  const carried = useRef<string | null>(null);

  const nodeFor = useCallback((target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    return target.closest<HTMLElement>('.org-person[data-person-id]');
  }, []);

  useEffect(() => {
    const tree = document.querySelector<HTMLElement>('.org-tree');
    if (!tree) return;

    for (const row of tree.querySelectorAll<HTMLElement>('.org-person[data-person-id]')) {
      row.setAttribute('draggable', 'true');
    }

    const clear = () => {
      for (const row of tree.querySelectorAll<HTMLElement>('.org-person')) {
        delete row.dataset.dragging;
        delete row.dataset.dropTarget;
      }
      carried.current = null;
    };

    const onDragStart = (event: DragEvent) => {
      const row = nodeFor(event.target);
      if (!row) return;
      carried.current = row.dataset.personId ?? null;
      row.dataset.dragging = 'true';
      event.dataTransfer?.setData('text/plain', carried.current ?? '');
    };

    const onDragOver = (event: DragEvent) => {
      const row = nodeFor(event.target);
      if (!row || !carried.current || row.dataset.personId === carried.current) return;
      // Only a row that could receive somebody says so.
      event.preventDefault();
      row.dataset.dropTarget = 'true';
    };

    const onDragLeave = (event: DragEvent) => {
      const row = nodeFor(event.target);
      if (row) delete row.dataset.dropTarget;
    };

    const onDrop = (event: DragEvent) => {
      const row = nodeFor(event.target);
      const moved = carried.current;
      if (!row || !moved) return;
      const manager = row.dataset.personId;
      if (!manager || manager === moved) return;
      event.preventDefault();
      clear();
      // The confirmation, not the change.
      const params = new URLSearchParams(query);
      params.set('move', moved);
      params.set('to', manager);
      router.push(`/more/admin/organisation?${params.toString()}`);
    };

    tree.addEventListener('dragstart', onDragStart);
    tree.addEventListener('dragend', clear);
    tree.addEventListener('dragover', onDragOver);
    tree.addEventListener('dragleave', onDragLeave);
    tree.addEventListener('drop', onDrop);
    return () => {
      tree.removeEventListener('dragstart', onDragStart);
      tree.removeEventListener('dragend', clear);
      tree.removeEventListener('dragover', onDragOver);
      tree.removeEventListener('dragleave', onDragLeave);
      tree.removeEventListener('drop', onDrop);
    };
  }, [nodeFor, query, router]);

  return null;
}
