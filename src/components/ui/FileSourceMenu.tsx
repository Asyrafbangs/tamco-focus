'use client';

import { useSyncExternalStore } from 'react';

import { MenuDropdown } from './MenuDropdown';

export type FileSource = 'camera' | 'photo' | 'file';

/**
 * Where a file is coming from, asked before the picker opens.
 *
 * A single "Add file" button always opened the same broad OS dialog, which on
 * a phone is the wrong one for the commonest case by far: somebody standing in
 * a plant with a routine that says "take an inspection photo" wants the camera,
 * not a file browser they then have to navigate out of.
 *
 * Choosing the source lets each option carry the right `accept` and, for the
 * camera, `capture` - which is what makes a phone open straight into the lens.
 *
 * The camera entry appears only on a coarse pointer. `capture` is ignored on a
 * desktop, so the option would silently open the ordinary file dialog and read
 * as broken. Detected after mount rather than during render, because the server
 * has no pointer to ask about and a guess would mismatch on hydration.
 */
export function FileSourceMenu({
  label,
  disabled = false,
  className,
  onPick,
}: {
  label: string;
  disabled?: boolean;
  className?: string;
  onPick: (source: FileSource) => void;
}) {
  /*
   * Subscribed rather than measured into state. The server has no pointer to
   * ask about, so the server snapshot is `false` and the browser corrects it
   * on hydration - which is also what keeps a plugged-in mouse or a tablet
   * switching modes from leaving a stale answer on screen.
   */
  const cameraAvailable = useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia('(pointer: coarse)');
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia('(pointer: coarse)').matches,
    () => false,
  );

  return (
    <MenuDropdown
      label={label}
      ariaLabel={label}
      disabled={disabled}
      minWidth={190}
      className={className ? `file-source-menu ${className}` : 'file-source-menu'}
    >
      {cameraAvailable && (
        <button type="button" role="menuitem" data-menu-close onClick={() => onPick('camera')}>
          Take a photo
        </button>
      )}
      <button type="button" role="menuitem" data-menu-close onClick={() => onPick('photo')}>
        Choose a photo
      </button>
      <button type="button" role="menuitem" data-menu-close onClick={() => onPick('file')}>
        Choose a file
      </button>
    </MenuDropdown>
  );
}
