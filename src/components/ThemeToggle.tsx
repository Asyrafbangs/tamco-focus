'use client';

import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

/**
 * The single top-bar Day/Night toggle (section 25.7).
 *
 * The preference is saved and re-applied before first paint by the bootstrap
 * script in the root layout; this component only reads the already-applied
 * value and flips it, so the two can never disagree.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const applied = document.documentElement.getAttribute('data-theme');
    setTheme(applied === 'dark' ? 'dark' : 'light');
    setReady(true);
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);

    try {
      localStorage.setItem('tamco-focus-theme', next);
    } catch {
      // A browser with storage disabled still gets the theme for this session.
    }
  }

  const nextLabel = theme === 'dark' ? 'Day' : 'Night';

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      // Section 25.8 — the control states what it will do, not merely which
      // icon it shows.
      aria-label={`Switch to ${nextLabel} mode`}
      aria-pressed={theme === 'dark'}
      suppressHydrationWarning
    >
      <span suppressHydrationWarning>{ready ? nextLabel : 'Theme'}</span>
      <span className="theme-knob" aria-hidden="true">
        {theme === 'dark' ? '☾' : '☀'}
      </span>
    </button>
  );
}
