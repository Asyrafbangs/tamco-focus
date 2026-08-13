import { expect, test, type Page } from '@playwright/test';

import { createWork } from './helpers/capture';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/**
 * v48 §25 — deliberately awful content, kept in the test rather than the seed.
 *
 * Real requests are unpredictable, and a card designed around the demo data is
 * a card that breaks the first week it meets a real one. These are the shapes
 * that actually break layouts: a long sentence, an unbroken token with no
 * wrapping opportunity, and both together.
 */
const STRESS = {
  long:
    'Confirm whether the alternative contractor can be appointed before the Friday shutdown ' +
    'window given that procurement have not returned the comparison quotation and the site ' +
    'induction records for the replacement crew are still outstanding as of this morning',
  unbroken:
    'CONTRACTORREFERENCEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** Raises a decision request against a task this test creates. */
async function raiseRequest(page: Page, taskTitle: string, request: string) {
  await signIn(page, 'izzah@tamco.local');

  await createWork(page, taskTitle);

  await page.goto('/work?tab=available');
  await page.getByRole('link', { name: taskTitle }).click();
  await page.locator('.task-detail-drawer').getByRole('button', { name: 'Raise barrier' }).click();

  const form = page.getByRole('dialog', { name: 'Raise Barrier' });
  await form.getByLabel('What is blocking the work?').fill('Blocked pending a decision.');
  await form.getByLabel('What do you need from them?').fill(request);
  await form.getByRole('radio', { name: 'Decision' }).check();
  await form.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('.barrier-exception.waiting')).toBeVisible();
}

/**
 * §2, §4 — the hierarchy is the fix.
 *
 * The heading used to be the action type joined to the whole request, so the
 * largest text on the page was as long as whatever somebody typed. The task
 * title is the stable anchor; the request is a bounded preview beneath it.
 */
test('the card leads with the task, not the request', async ({ page }, testInfo) => {
  const runId = Date.now();
  const marker = `CARD${testInfo.project.name}${runId}`;
  const taskTitle = `Machine guarding ${marker}`;

  await raiseRequest(page, taskTitle, `${marker} ${STRESS.long}`);
  await signIn(page, 'izzul@tamco.local');
  // The full list: My Day shows only the top three (v49 §1).
  await page.goto('/work?filter=attention');

  const card = page.locator('.attention-card', { hasText: marker });
  await expect(card).toBeVisible();

  // The heading is the task. The request is present but secondary.
  await expect(card.locator('.attention-card-title')).toHaveText(taskTitle);
  await expect(card.locator('.attention-card-type')).toHaveText('Decision needed');
  await expect(card.locator('.attention-card-request')).toContainText(marker);
  await expect(card.locator('.attention-card-meta')).toContainText('Requested by Izzah');
  await expect(card.getByRole('link', { name: 'Provide decision' })).toBeVisible();

  // §5 — the preview is bounded to roughly two lines however long the text is.
  const lines = await card.locator('.attention-card-request').evaluate((el) => {
    const style = getComputedStyle(el);
    return Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight));
  });
  expect(lines, 'the request preview must stay around two lines').toBeLessThanOrEqual(3);

  // §19 — and the deep link still opens the exact barrier.
  const href = await card.getByRole('link', { name: 'Provide decision' }).getAttribute('href');
  expect(href).toContain('attention=barrier');
  expect(href).toContain('barrier=');
});

/**
 * §23-24 — the hard visual rules, at the widths and zooms people use.
 */
test('the card survives long and unbreakable content at every width', async ({
  page,
}, testInfo) => {
  const runId = Date.now();
  const marker = `STRESS${testInfo.project.name}${runId}`;
  const taskTitle = `Very long task title that keeps going ${marker} for quite a while indeed`;

  await raiseRequest(page, taskTitle, `${marker} ${STRESS.long} ${STRESS.unbroken}`);
  await signIn(page, 'izzul@tamco.local');
  // The full list: My Day shows only the top three (v49 §1).
  await page.goto('/work?filter=attention');

  const card = page.locator('.attention-card', { hasText: marker });
  await expect(card).toBeVisible();

  for (const width of [1280, 1024, 768, 430, 375]) {
    await page.setViewportSize({ width, height: 900 });

    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrolls, `horizontal scrollbar at ${width}px`).toBe(false);

    const report = await card.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const action = element.querySelector('.attention-card-action')!.getBoundingClientRect();
      const text = [...element.querySelectorAll('.attention-card-title, .attention-card-request')];

      return {
        // Nothing may cross the card's own edges.
        escapes: text.some((el) => {
          const r = el.getBoundingClientRect();
          return r.left < box.left - 1 || r.right > box.right + 1;
        }),
        // The action may sit beside the text or below it, never on top of it.
        overlaps: text.some((el) => {
          const r = el.getBoundingClientRect();
          return !(
            r.right <= action.left + 1 ||
            r.left >= action.right - 1 ||
            r.bottom <= action.top + 1 ||
            r.top >= action.bottom - 1
          );
        }),
        actionInside:
          action.left >= box.left - 1 &&
          action.right <= box.right + 1 &&
          action.bottom <= box.bottom + 1,
        // §8 — the card grows with its content rather than clipping it.
        clipped: element.scrollHeight > element.clientHeight + 1,
      };
    });

    expect(report.escapes, `text crossed the card border at ${width}px`).toBe(false);
    expect(report.overlaps, `text overlapped the action at ${width}px`).toBe(false);
    expect(report.actionInside, `action escaped the card at ${width}px`).toBe(true);
    expect(report.clipped, `card clipped its content at ${width}px`).toBe(false);
  }

  // §23 — zoom. 150% reports two-thirds of the CSS width, which is the same
  // pressure as a narrow screen and must behave the same way.
  for (const zoom of [1.25, 1.5]) {
    await page.setViewportSize({ width: Math.round(1280 / zoom), height: 900 });
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrolls, `horizontal scrollbar at ${zoom * 100}% zoom`).toBe(false);
  }
});
