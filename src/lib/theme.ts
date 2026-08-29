/**
 * The nine colours an organisation can change, and nothing else.
 *
 * The interface was already built on design tokens, so a theme does not need a
 * second styling system - it needs nine values and a rule for turning them into
 * token overrides. Everything derived from those tokens follows: the tinted
 * panel backgrounds, the focus ring, the hover states, dark mode.
 *
 * Deliberately closed. Nine is enough to make the product look like somebody
 * else's, and small enough that every one of them can be reasoned about for
 * contrast. An open list would be a palette editor nobody asked for and a CSS
 * injection surface nobody wants.
 */

export const THEME_KEYS = [
  'brand',
  'background',
  'nav',
  'surface',
  'text',
  'muted',
  'success',
  'warning',
  'danger',
] as const;

export type ThemeKey = (typeof THEME_KEYS)[number];
export type ThemeColors = Partial<Record<ThemeKey, string>>;

export const THEME_FIELDS: Array<{ key: ThemeKey; label: string; hint: string }> = [
  { key: 'brand', label: 'Primary', hint: 'Buttons, links, the focus ring' },
  { key: 'background', label: 'Application background', hint: 'Behind every panel' },
  { key: 'nav', label: 'Sidebar', hint: 'The navigation rail' },
  { key: 'surface', label: 'Cards and panels', hint: 'Drawers and modals too' },
  { key: 'text', label: 'Primary text', hint: 'Headings and body' },
  { key: 'muted', label: 'Secondary text', hint: 'Sub-labels and hints' },
  { key: 'success', label: 'Success', hint: 'Completed, on target' },
  { key: 'warning', label: 'Warning', hint: 'Waiting, needs a decision' },
  { key: 'danger', label: 'Error', hint: 'Overdue, blocked, destructive' },
];

/** The built-in palette, and what Reset returns to. */
export const DEFAULT_THEME: Record<ThemeKey, string> = {
  brand: '#1668e8',
  background: '#f5f6f8',
  nav: '#0d2342',
  surface: '#ffffff',
  text: '#182235',
  muted: '#58687c',
  success: '#107a4d',
  warning: '#8a5200',
  danger: '#c51f36',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

/** Keeps only known keys holding real colours. Anything else is dropped. */
export function sanitiseTheme(input: unknown): ThemeColors {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const cleaned: ThemeColors = {};
  for (const key of THEME_KEYS) {
    const value = source[key];
    if (isHexColor(value)) cleaned[key] = value.toLowerCase();
  }
  return cleaned;
}

/**
 * The token overrides, as CSS.
 *
 * `html[data-theme-custom]:root` rather than plain `:root` on purpose. The dark
 * palette lives at `:root[data-theme='dark']`, which has the same specificity
 * as `:root[...]` would - so an equal-specificity rule would win or lose on
 * document order, which is not something to leave to chance. The type selector
 * settles it outright.
 *
 * The tints are mixed from the chosen colour rather than left as they were, so
 * a green brand does not leave pale blue panel backgrounds behind it. Mixing
 * against `--surface` means they follow light and dark without a second set.
 */
export function themeStyleSheet(colors: ThemeColors): string {
  const clean = sanitiseTheme(colors);
  if (Object.keys(clean).length === 0) return '';

  const lines: string[] = [];
  const tint = (token: string, value: string, percent: number) =>
    `${token}: color-mix(in srgb, ${value} ${percent}%, var(--surface));`;

  if (clean.brand) {
    lines.push(`--blue: ${clean.brand};`, tint('--blue-bg', clean.brand, 10));
  }
  if (clean.background) lines.push(`--bg: ${clean.background};`);
  if (clean.nav) {
    lines.push(
      `--navy: ${clean.nav};`,
      // The lighter navy is used for hovers and the second rail tone.
      `--navy-2: color-mix(in srgb, ${clean.nav} 82%, #ffffff);`,
    );
  }
  if (clean.surface) {
    lines.push(
      `--surface: ${clean.surface};`,
      `--surface-2: color-mix(in srgb, ${clean.surface} 97%, ${clean.text ?? '#182235'});`,
    );
  }
  if (clean.text) lines.push(`--text: ${clean.text};`);
  if (clean.muted) lines.push(`--muted: ${clean.muted};`);
  if (clean.success) {
    lines.push(`--green: ${clean.success};`, tint('--green-bg', clean.success, 12));
  }
  if (clean.warning) {
    lines.push(`--amber: ${clean.warning};`, tint('--amber-bg', clean.warning, 14));
  }
  if (clean.danger) {
    lines.push(`--red: ${clean.danger};`, tint('--red-bg', clean.danger, 10));
  }

  return `html[data-theme-custom]:root{${lines.join('')}}`;
}

/** Relative luminance, per WCAG. */
function luminance(hex: string): number {
  const channel = (pair: string) => {
    const value = parseInt(pair, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(hex.slice(1, 3));
  const g = channel(hex.slice(3, 5));
  const b = channel(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  if (!isHexColor(foreground) || !isHexColor(background)) return 21;
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

export interface ContrastWarning {
  pair: string;
  ratio: number;
  needed: number;
}

/**
 * Whether the chosen colours can actually be read.
 *
 * Reported rather than enforced. Somebody may have a reason for a combination
 * this flags, and refusing to save it would be the software overruling them -
 * but nobody should be able to make the product unreadable without being told
 * that is what they have done.
 */
export function contrastWarnings(colors: ThemeColors): ContrastWarning[] {
  const resolved = { ...DEFAULT_THEME, ...sanitiseTheme(colors) };
  const checks: Array<{ pair: string; fore: string; back: string; needed: number }> = [
    { pair: 'Primary text on cards', fore: resolved.text, back: resolved.surface, needed: 4.5 },
    {
      pair: 'Primary text on the application background',
      fore: resolved.text,
      back: resolved.background,
      needed: 4.5,
    },
    { pair: 'Secondary text on cards', fore: resolved.muted, back: resolved.surface, needed: 4.5 },
    // Large, bold button labels: AA allows 3:1 for those.
    { pair: 'White on the primary colour', fore: '#ffffff', back: resolved.brand, needed: 3 },
    { pair: 'White on the sidebar', fore: '#ffffff', back: resolved.nav, needed: 4.5 },
    { pair: 'Error text on cards', fore: resolved.danger, back: resolved.surface, needed: 4.5 },
    { pair: 'Warning text on cards', fore: resolved.warning, back: resolved.surface, needed: 4.5 },
    { pair: 'Success text on cards', fore: resolved.success, back: resolved.surface, needed: 4.5 },
  ];

  return checks
    .map((check) => ({
      pair: check.pair,
      ratio: contrastRatio(check.fore, check.back),
      needed: check.needed,
    }))
    .filter((check) => check.ratio < check.needed);
}
