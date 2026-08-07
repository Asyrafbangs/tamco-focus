'use client';

import { useSyncExternalStore } from 'react';

type Theme = 'light' | 'dark';

const THEME_CHANGE_EVENT = 'tamco-focus-theme-change';

function subscribeToTheme(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(THEME_CHANGE_EVENT, callback);

  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function getAppliedTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function getServerTheme(): Theme {
  return 'light';
}

/**
 * The single top-bar Day/Night toggle (section 25.7).
 *
 * The preference is saved and re-applied before first paint by the bootstrap
 * script in the root layout; this component only reads the already-applied
 * value and flips it, so the two can never disagree.
 */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, getAppliedTheme, getServerTheme);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));

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
      <span suppressHydrationWarning>{nextLabel}</span>
      <span className="theme-knob" aria-hidden="true">
        {theme === 'dark' ? '☾' : '☀'}
      </span>
    </button>
  );
}
