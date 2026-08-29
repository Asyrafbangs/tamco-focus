import type { Metadata, Viewport } from 'next';

import { AppHydration } from '@/components/AppHydration';

import './globals.css';

export const metadata: Metadata = {
  title: 'TAMCO Focus',
  description: 'Understand what needs attention today, and what to do next.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Applies the saved theme before first paint.
 *
 * Section 25.7 requires the preference to persist and first use to be allowed
 * to follow the device. Running this synchronously in `<head>` is what stops a
 * night-mode user seeing a white flash on every navigation.
 */
const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem('tamco-focus-theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (prefersDark ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);

    var textSize = localStorage.getItem('tamco-focus-text-size');
    if (textSize) document.documentElement.setAttribute('data-text-size', textSize);

    if (localStorage.getItem('tamco-focus-reduced-motion') === 'true') {
      document.documentElement.setAttribute('data-reduced-motion', 'true');
    }

    // The saved palette, from the last visit, before anything is painted. The
    // server renders the same rule a moment later; this is only what stops a
    // flash of the default blue on the way there. Six-digit hex and known
    // keys only, because this string is written into a stylesheet.
    var raw = localStorage.getItem('tamco-focus-theme-colors');
    if (raw) {
      var saved = JSON.parse(raw);
      var allowed = ['brand','background','nav','surface','text','muted','success','warning','danger'];
      var map = { brand: '--blue', background: '--bg', nav: '--navy', surface: '--surface',
                  text: '--text', muted: '--muted', success: '--green', warning: '--amber',
                  danger: '--red' };
      var css = '';
      for (var i = 0; i < allowed.length; i += 1) {
        var value = saved[allowed[i]];
        if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
          css += map[allowed[i]] + ':' + value + ';';
        }
      }
      if (css) {
        var style = document.createElement('style');
        style.id = 'tamco-theme-boot';
        style.textContent = 'html[data-theme-custom]:root{' + css + '}';
        document.head.appendChild(style);
        document.documentElement.setAttribute('data-theme-custom', '');
      }
    }
  } catch (error) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        {children}
        <AppHydration />
      </body>
    </html>
  );
}
