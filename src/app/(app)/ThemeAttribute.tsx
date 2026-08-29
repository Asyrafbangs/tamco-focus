'use client';

import { useEffect } from 'react';

/**
 * Marks the document as themed, which is what the override selector keys on.
 *
 * Set from the client rather than on `<html>` in the root layout, because the
 * root layout has no session and the palette belongs to a person. The
 * stylesheet itself is server-rendered beside this, so the only thing waiting
 * on hydration is one attribute - and the pre-paint script in the root layout
 * has usually set it already from the last visit.
 */
export function ThemeAttribute() {
  useEffect(() => {
    document.documentElement.setAttribute('data-theme-custom', '');
    return () => document.documentElement.removeAttribute('data-theme-custom');
  }, []);
  return null;
}
