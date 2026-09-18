import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v194 — the page scroll lock is counted.
 *
 * Reported 18 September 2026: opening the task window repeatedly left the page
 * unable to scroll until it was reloaded. Each overlay saved and restored
 * `document.body.style.overflow` on its own, so an overlay that opened while
 * another was on screen saved `hidden` and put it back for good.
 */

const body = { style: { overflow: '' } };

beforeEach(() => {
  vi.resetModules();
  body.style.overflow = '';
  (globalThis as { document?: unknown }).document = { body };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

async function load() {
  return import('@/components/ui/scroll-lock');
}

describe('v194 — counted body scroll lock', () => {
  it('locks on the first holder and restores on the last', async () => {
    const { lockBodyScroll, bodyScrollHolders } = await load();

    const drawer = lockBodyScroll();
    expect(body.style.overflow).toBe('hidden');
    const dialog = lockBodyScroll();
    expect(bodyScrollHolders()).toBe(2);

    // The drawer goes first, as React unmounts it before the dialog inside it.
    drawer();
    expect(body.style.overflow, 'still locked while the dialog is up').toBe('hidden');
    dialog();
    expect(body.style.overflow, 'restored when the last overlay goes').toBe('');
    expect(bodyScrollHolders()).toBe(0);
  });

  it('keeps whatever the page had before the first lock', async () => {
    const { lockBodyScroll } = await load();
    body.style.overflow = 'clip';

    const release = lockBodyScroll();
    expect(body.style.overflow).toBe('hidden');
    release();
    expect(body.style.overflow).toBe('clip');
  });

  it('ignores a second release from the same holder', async () => {
    const { lockBodyScroll, bodyScrollHolders } = await load();

    const first = lockBodyScroll();
    const second = lockBodyScroll();
    first();
    first();
    expect(bodyScrollHolders(), 'a repeated release must not drop somebody else').toBe(1);
    expect(body.style.overflow).toBe('hidden');
    second();
    expect(body.style.overflow).toBe('');
  });

  it('does nothing where there is no document', async () => {
    delete (globalThis as { document?: unknown }).document;
    const { lockBodyScroll } = await load();
    expect(() => lockBodyScroll()()).not.toThrow();
  });
});
