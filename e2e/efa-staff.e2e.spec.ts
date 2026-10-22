/**
 * EF assessment staff pages in a real browser (admin bundle): progress
 * dashboard with the administration log, settings, raters, and the coding
 * page. Run after e2e/puzzles.e2e.spec.ts so the fixture student has a
 * completed T0 occasion.
 *
 *   `vite preview --config vite.config.admin.ts --port 5176` with GALS_API_TARGET
 *   E2E_ADMIN_URL=http://localhost:5176 dotenv -e apps/api/.env.efa-e2e.local -- npx playwright test e2e/efa-staff.e2e.spec.ts
 *
 * Skips unless E2E_TEACHER_EMAIL / E2E_TEACHER_PASSWORD / E2E_COURSE_ID are set.
 */
import { expect, test } from '@playwright/test';

const EMAIL = process.env.E2E_TEACHER_EMAIL;
const PASSWORD = process.env.E2E_TEACHER_PASSWORD;
const COURSE_ID = process.env.E2E_COURSE_ID;

test.use({
  baseURL: process.env.E2E_ADMIN_URL ?? 'http://localhost:5176',
  viewport: { width: 1400, height: 900 },
  actionTimeout: 30_000,
});
test.skip(
  !EMAIL || !PASSWORD || !COURSE_ID,
  'set E2E_TEACHER_EMAIL, E2E_TEACHER_PASSWORD and E2E_COURSE_ID',
);

test('staff pages: progress with admin log, settings, raters, coding', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/login');
  await page.getByPlaceholder('you@example.com or your login ID').fill(EMAIL!);
  await page.getByLabel('Password').fill(PASSWORD!);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/teacher/);

  await page.goto(`/teacher/courses/${COURSE_ID}/efa`);
  await expect(page.getByRole('heading', { name: 'EF assessment' })).toBeVisible();
  const table = page.getByTestId('efa-progress');
  await expect(table).toBeVisible();
  await expect(table.getByText('T0 puzzles')).toBeVisible();

  // Open the student's row: administration log + puzzles.
  await table.locator('tbody button').first().click();
  await expect(page.getByText('T0 administration log')).toBeVisible();
  await expect(page.getByText('W6 Colours (Stroop)')).toBeVisible();
  await expect(page.getByText('Focus lost (total)')).toBeVisible();

  await page.getByRole('button', { name: 'settings' }).click();
  await expect(page.getByRole('heading', { name: 'Occasions' })).toBeVisible();
  await expect(page.getByText('Gates in this course')).toBeVisible();

  await page.getByRole('button', { name: 'raters' }).click();
  await expect(page.getByRole('button', { name: 'Save raters' })).toBeVisible();

  await page.getByRole('link', { name: /Coding and exports/ }).click();
  await expect(page.getByRole('heading', { name: /coding and exports/ })).toBeVisible();
  await page
    .getByRole('row', { name: /W4 Word lists/ })
    .getByRole('button', { name: 'Code' })
    .click();
  const panel = page.getByTestId('efa-coding-panel');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('repeat').first()).toBeVisible(); // pre-scoring hint on the repeated word

  expect(errors).toEqual([]);
});
