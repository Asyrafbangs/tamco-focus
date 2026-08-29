import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME,
  THEME_KEYS,
  contrastRatio,
  contrastWarnings,
  isHexColor,
  sanitiseTheme,
  themeStyleSheet,
} from '@/lib/theme';

describe('theme colours', () => {
  describe('what counts as a colour', () => {
    it.each(['#1668e8', '#FFFFFF', '#000000', '#a1b2c3'])('accepts %s', (value) => {
      expect(isHexColor(value)).toBe(true);
    });

    /*
     * The rejected list is the point of the function. These values end up in a
     * stylesheet, so anything that is not six hex digits is a way of writing
     * CSS rather than a colour.
     */
    it.each([
      '#fff',
      'red',
      'rgb(1,2,3)',
      '#1668e8; } body { display: none',
      'var(--blue)',
      '#12345g',
      '',
      '  #1668e8  ',
    ])('rejects %j', (value) => {
      expect(isHexColor(value)).toBe(false);
    });
  });

  describe('sanitising a saved palette', () => {
    it('keeps known keys holding real colours', () => {
      expect(sanitiseTheme({ brand: '#112233', danger: '#AABBCC' })).toEqual({
        brand: '#112233',
        danger: '#aabbcc',
      });
    });

    it('drops unknown keys and bad values without failing', () => {
      expect(
        sanitiseTheme({
          brand: '#112233',
          somethingElse: '#445566',
          background: 'red',
          nav: null,
        }),
      ).toEqual({ brand: '#112233' });
    });

    it.each([null, undefined, 'blue', 42])('treats %j as no theme at all', (value) => {
      expect(sanitiseTheme(value)).toEqual({});
    });
  });

  describe('turning it into CSS', () => {
    it('writes nothing when there is nothing to override', () => {
      expect(themeStyleSheet({})).toBe('');
      expect(themeStyleSheet({ brand: 'not a colour' } as never)).toBe('');
    });

    it('overrides the token each colour maps onto', () => {
      const css = themeStyleSheet({ brand: '#ff0000', nav: '#001122', text: '#333333' });
      expect(css).toContain('--blue: #ff0000;');
      expect(css).toContain('--navy: #001122;');
      expect(css).toContain('--text: #333333;');
    });

    it('derives the tints so they follow the colour they belong to', () => {
      const css = themeStyleSheet({ brand: '#ff0000' });
      expect(css).toContain('--blue-bg: color-mix(in srgb, #ff0000 10%, var(--surface));');
    });

    /*
     * The dark palette lives at `:root[data-theme='dark']`. An override with
     * the same specificity would win or lose on document order, which is not
     * something to leave to chance.
     */
    it('outranks the dark palette rather than tying with it', () => {
      expect(themeStyleSheet({ brand: '#ff0000' })).toMatch(/^html\[data-theme-custom\]:root\{/);
    });

    it('never emits a value that did not survive sanitising', () => {
      const css = themeStyleSheet({
        brand: '#ff0000',
        background: 'red; } * { display:none',
      } as never);
      expect(css).toContain('#ff0000');
      expect(css).not.toContain('display');
      expect(css).not.toContain('--bg:');
    });
  });

  describe('readability', () => {
    it('scores black on white at the maximum', () => {
      expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    });

    it('is symmetric', () => {
      expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
        contrastRatio('#abcdef', '#123456'),
        5,
      );
    });

    it('passes the built-in palette', () => {
      expect(contrastWarnings({})).toEqual([]);
    });

    it('names the pair that cannot be read', () => {
      const warnings = contrastWarnings({ text: '#eeeeee', surface: '#ffffff' });
      expect(warnings.map((warning) => warning.pair)).toContain('Primary text on cards');
    });

    it('warns about a light brand behind white button text', () => {
      const warnings = contrastWarnings({ brand: '#ffee00' });
      expect(warnings.map((warning) => warning.pair)).toContain('White on the primary colour');
    });
  });

  describe('resetting', () => {
    it('has a default for every key, so Reset can restore all of them', () => {
      for (const key of THEME_KEYS) {
        expect(isHexColor(DEFAULT_THEME[key])).toBe(true);
      }
    });

    // Reset saves an empty palette, and an empty palette is the built-in one.
    it('produces no overrides once cleared', () => {
      expect(themeStyleSheet(sanitiseTheme({}))).toBe('');
    });
  });
});
