import { expect, test, type Page } from '@playwright/test';

/**
 * v183 — every control a phone reaches is a 44px touch target.
 *
 * The design-system check measured Today and nothing else, so the rule held
 * there and nowhere it was never looked for: measuring every page found filter
 * fields and settings inputs at 36-40px, menus at 34-40px, drawer tabs and
 * header buttons at 38-42px, routine fields at 25-38px, weekday toggles at
 * 34px, and disclosures at 15-20px. Most were cascade losses — a later, more
 * specific rule declaring the desktop density — which is why this measures the
 * rendered result on each page rather than trusting a rule.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function undersized(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'button, a.btn, .mobile-nav a, input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, summary',
      ),
    ]
      .filter((element) => {
        if (element.closest('.visually-hidden, [hidden], [aria-hidden="true"]')) return false;
        // Its ::after extends the touch area past the 24-28px circle.
        if (element.classList.contains('task-age-info')) return false;
        // Layout size, not the painted box: a dialog still finishing its
        // opening scale reports every control a pixel short.
        const html = element as HTMLElement;
        return html.offsetWidth > 0 && html.offsetHeight > 0 && html.offsetHeight < 44;
      })
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 20)}" ${(element as HTMLElement).offsetHeight}px`,
      ),
  );
}

const PAGES: Array<[string, string[]]> = [
  [
    'admin@tamco.local',
    [
      '/more/admin/users?user=f0c05000-0000-4000-a000-000000000003',
      '/more/admin/organisation',
      '/more/admin/organisation?import=1',
      '/more/settings',
      '/more/records',
      '/more/attachments',
    ],
  ],
  [
    'izzul@tamco.local',
    [
      '/work?scope=team',
      '/work?task=f0c05300-0000-4000-a000-000000000008',
      '/work/routine?new=Weekly%20check',
      '/goals',
      '/today?capture=1',
      '/plan',
    ],
  ],
];

for (const [email, paths] of PAGES) {
  test(`controls are 44px on a phone for ${email.split('@')[0]}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Touch sizing applies to the mobile build.');
    test.setTimeout(180_000);
    await signIn(page, email);
    const findings: string[] = [];
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await page.waitForTimeout(300);
      for (const entry of await undersized(page)) findings.push(`${path} ${entry}`);
    }
    expect(findings).toEqual([]);
  });
}
