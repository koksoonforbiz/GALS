/**
 * Knowledge tests in a real browser (student bundle): the pre-study check is
 * refused before the warm-up; Session 1 stays hidden until the pre-study and
 * Session 1 pre-checks are submitted; the student payload has no keys; a
 * submitted check only shows "Submitted. Thank you!"; the post-session check
 * waits for the lesson.
 *
 *   pnpm --filter @ats/api run seed:efa-e2e-local
 *   pnpm --filter @ats/api run seed:kt-e2e-local -- --reset
 *   API on :3100, student bundle on :5175 (GALS_API_TARGET)
 *   E2E_BASE_URL=http://localhost:5175 dotenv -e apps/api/.env.efa-e2e.local -- npx playwright test e2e/knowledge-tests.e2e.spec.ts
 */
import { execSync } from 'child_process';
import { expect, test, type Page } from '@playwright/test';
import { loginStudent } from './puzzles.helpers';

const env = process.env;
const COURSE = env.E2E_KT_COURSE_ID;

test.use({
  baseURL: env.E2E_BASE_URL ?? 'http://localhost:5175',
  viewport: { width: 1700, height: 900 }, // ≥ 1600: module list starts expanded
  actionTimeout: 30_000,
});
test.describe.configure({ retries: 0 });
test.skip(
  !env.E2E_STUDENT_LOGIN || !COURSE,
  'set the E2E_* variables from apps/api/.env.efa-e2e.local',
);

/** Answer the first question, skip the rest, submit with confirmation. */
async function takeCheck(page: Page) {
  await expect(page.getByTestId('knowledge-test')).toBeVisible();
  const first = page.locator('input[type="radio"], input[type="checkbox"]').first();
  if (await first.count()) await first.check();
  for (let guard = 0; guard < 30; guard++) {
    const next = page.getByRole('button', { name: /^(Next|Review)$/ });
    if (!(await next.count())) break;
    await next.click();
  }
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await expect(page.getByText(/questions? (are|is) unanswered/)).toBeVisible();
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(page.getByText('Submitted. Thank you!')).toBeVisible();
}

test('gate order, no keys in the payload, submitted checks are final', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  execSync('pnpm --filter @ats/api run seed:kt-e2e-local -- --reset', { stdio: 'ignore' });
  await loginStudent(page, env.E2E_STUDENT_LOGIN!, env.E2E_STUDENT_PASSWORD!);

  // Before the warm-up: refused with the reason; no session visible.
  await page.goto(`/student/courses/${COURSE}/knowledge-check/pre-study`);
  await expect(page.getByText(/Complete “About you and how you feel today” first/)).toBeVisible();
  await page.goto(`/student/courses/${COURSE}`);
  await expect(page.locator('[data-testid="course-gate-checklist"]:visible').first()).toContainText(
    'About you and how you feel today',
  );
  await expect(page.getByText('Session 1: fixture')).toHaveCount(0);

  // Warm-up passed (fixture) → the pre-study check is next.
  execSync('pnpm --filter @ats/api run seed:kt-e2e-local -- --warmup-done', { stdio: 'ignore' });
  await page.reload();
  const checklist = page.locator('[data-testid="course-gate-checklist"]:visible').first();
  await expect(checklist).toContainText('Knowledge check: before the course');
  const [start] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/knowledge-tests/courses/') && r.url().endsWith('/attempts'),
    ),
    checklist.getByRole('link', { name: 'Continue' }).click(),
  ]);
  const payload = await start.text();
  expect(payload).not.toMatch(/"correct"|"rubric"|"objective"/);
  expect(JSON.parse(payload).items).toHaveLength(24);
  await takeCheck(page);
  await page.reload();
  await expect(page.getByText('Submitted. Thank you!')).toBeVisible();
  await expect(page.getByTestId('knowledge-test')).toHaveCount(0);

  // Session 1 appears only after its pre-check.
  await page.goto(`/student/courses/${COURSE}`);
  await expect(page.getByText('Session 1: fixture')).toHaveCount(0);
  await expect(page.locator('[data-testid="course-gate-checklist"]:visible').first()).toContainText(
    'Session 1: knowledge check before the lesson',
  );
  await page
    .locator('[data-testid="course-gate-checklist"]:visible')
    .first()
    .getByRole('link', { name: 'Continue' })
    .click();
  await takeCheck(page);
  await page.goto(`/student/courses/${COURSE}`);
  await expect(page.getByText('Session 1: fixture').first()).toBeVisible();
  await expect(page.getByText('Session 2: fixture')).toHaveCount(0);

  // The post-session check waits for the lesson's reflect slide.
  await page.goto(`/student/courses/${COURSE}/knowledge-check/post-session/1`);
  await expect(page.getByText(/Finish the Session 1 lesson first/)).toBeVisible();
});
