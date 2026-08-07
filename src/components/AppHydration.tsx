'use client';

import { useEffect } from 'react';

/**
 * Exposes when client-side interaction handlers are ready.
 *
 * Server-rendered controls remain usable where they have native behaviour,
 * while browser journeys can wait for this marker before exercising controls
 * whose behaviour depends on React state, focus management, or keyboard
 * listeners. The attribute is intentionally diagnostic and has no styling.
 */
export function AppHydration() {
  useEffect(() => {
    document.documentElement.setAttribute('data-app-hydrated', 'true');
  }, []);

  return null;
}
