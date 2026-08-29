'use client';

import { useEffect, useState, useTransition } from 'react';

import {
  DEFAULT_THEME,
  THEME_FIELDS,
  contrastWarnings,
  isHexColor,
  themeStyleSheet,
  type ThemeColors,
  type ThemeKey,
} from '@/lib/theme';
import { saveThemeColors } from '@/server/actions/settings-actions';

/**
 * Appearance, in nine colours.
 *
 * Two rules shape this. The preview updates as the colour changes, because a
 * palette cannot be judged from nine hex codes; and it previews the real
 * elements - a header, the rail, a card, a button, a status line - rather than
 * nine swatches, because the question is never "is this blue nice" but "can I
 * read a status message on it".
 *
 * Contrast is reported, not enforced. Somebody may have a reason for a
 * combination this flags and the software should not overrule them, but nobody
 * should be able to make the product unreadable without being told.
 */

const STORAGE_KEY = 'tamco-focus-theme-colors';

export function ThemeSettings({ initial }: { initial: ThemeColors }) {
  const [draft, setDraft] = useState<ThemeColors>(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const resolved = { ...DEFAULT_THEME, ...draft };
  const warnings = contrastWarnings(draft);
  const changed = THEME_FIELDS.some(({ key }) => (draft[key] ?? '') !== (initial[key] ?? ''));

  /*
   * The page itself changes as you pick, not only the preview panel. Judging a
   * background colour from a 300px box is guesswork; the honest preview of an
   * application background is the application.
   */
  useEffect(() => {
    const element = document.getElementById('tamco-theme-live');
    if (!element) return;
    element.textContent = themeStyleSheet(draft);
    document.documentElement.toggleAttribute('data-theme-custom', Object.keys(draft).length > 0);
  }, [draft]);

  function set(key: ThemeKey, value: string) {
    setMessage(null);
    setDraft((current) => {
      const next = { ...current };
      if (!value || value.toLowerCase() === DEFAULT_THEME[key]) delete next[key];
      else next[key] = value.toLowerCase();
      return next;
    });
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveThemeColors(draft);
      if (result.ok) {
        /*
         * Mirrored locally as well as saved, so the palette is on the document
         * before first paint next time rather than arriving a frame later as a
         * flash of the default blue.
         */
        try {
          if (Object.keys(draft).length === 0) localStorage.removeItem(STORAGE_KEY);
          else localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
        } catch {
          // A browser refusing storage costs the pre-paint apply, nothing more.
        }
        setMessage({ tone: 'success', text: 'Theme saved. It follows you to any device.' });
      } else {
        setMessage({ tone: 'error', text: result.message });
      }
    });
  }

  function reset() {
    setMessage(null);
    setDraft({});
  }

  return (
    <div className="theme-settings">
      {/* No heading of its own: the settings workspace already titles the
          panel, and a second "Appearance" made the word ambiguous. */}
      <p className="theme-intro">
        Nine colours, applied everywhere. Everything else — hovers, tinted panels, the focus ring —
        is derived from them, so you do not have to choose it.
      </p>

      <div className="theme-layout">
        <div className="theme-fields">
          {THEME_FIELDS.map(({ key, label, hint }) => {
            const value = draft[key] ?? DEFAULT_THEME[key];
            const valid = isHexColor(value);
            return (
              <div className="theme-field" key={key}>
                <label htmlFor={`theme-${key}`}>
                  <strong>{label}</strong>
                  <small>{hint}</small>
                </label>
                <div className="theme-inputs">
                  <input
                    id={`theme-${key}`}
                    type="color"
                    value={valid ? value : DEFAULT_THEME[key]}
                    aria-label={`${label} colour`}
                    onChange={(event) => set(key, event.target.value)}
                  />
                  {/* The hex field is how a brand colour actually arrives —
                      from a brand document, not from a colour wheel. */}
                  <input
                    className="theme-hex"
                    value={value}
                    spellCheck={false}
                    maxLength={7}
                    aria-label={`${label} hex value`}
                    aria-invalid={!valid}
                    onChange={(event) => {
                      const next = event.target.value.trim();
                      if (isHexColor(next)) set(key, next);
                      else setDraft((current) => ({ ...current, [key]: next }));
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="theme-preview" aria-label="Theme preview">
          <div className="theme-preview-frame" style={{ background: resolved.background }}>
            <div className="theme-preview-rail" style={{ background: resolved.nav }} />
            <div className="theme-preview-body">
              <p className="theme-preview-head" style={{ color: resolved.text }}>
                My Work
              </p>
              <div
                className="theme-preview-card"
                style={{ background: resolved.surface, borderColor: `${resolved.muted}33` }}
              >
                <strong style={{ color: resolved.text }}>Create 3 Years Planning</strong>
                <span style={{ color: resolved.muted }}>Operational Action · due 16 Sept</span>
                <div className="theme-preview-actions">
                  <span style={{ background: resolved.brand, color: '#fff' }}>Complete work</span>
                  <span style={{ color: resolved.brand, borderColor: `${resolved.brand}55` }}>
                    Need support
                  </span>
                </div>
                <div className="theme-preview-states">
                  <span style={{ color: resolved.success }}>✓ Completed</span>
                  <span style={{ color: resolved.warning }}>Awaiting decision</span>
                  <span style={{ color: resolved.danger }}>Overdue 2 days</span>
                </div>
              </div>
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="theme-warnings" role="status">
              <strong>Hard to read</strong>
              <ul>
                {warnings.map((warning) => (
                  <li key={warning.pair}>
                    {warning.pair} — {warning.ratio.toFixed(1)}:1, needs {warning.needed}:1
                  </li>
                ))}
              </ul>
              <p>You can still save this. It is only worth knowing before you do.</p>
            </div>
          )}
        </div>
      </div>

      {message && (
        <div className={`notice ${message.tone === 'error' ? 'error' : 'success'}`} role="status">
          <p>{message.text}</p>
        </div>
      )}

      <div className="theme-actions">
        <button
          type="button"
          className="btn primary"
          disabled={pending || !changed}
          aria-busy={pending}
          onClick={save}
        >
          {pending ? 'Saving…' : 'Save theme'}
        </button>
        <button
          type="button"
          className="btn"
          disabled={pending || Object.keys(draft).length === 0}
          onClick={reset}
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}
