/**
 * Puzzles edge cases in a real browser, student and staff side by side:
 * a failed colour check skips the colour puzzle, a reload mid-puzzle marks
 * it interrupted and moves on (never re-run), staff see both on the
 * dashboard, unlock the puzzles gate with a reason (Session 1 opens) and
 * download an export.
 *
 * Needs a fresh fixture student and both bundles served:
 *   pnpm --filter @ats/api run seed:efa-e2e-local -- --reset
 *   student bundle on :5175, admin bundle on :5176 (GALS_API_TARGET → the API)
 *   E2E_BASE_URL=http://localhost:5175 E2E_ADMIN_URL=http://localhost:5176 \
 *     dotenv -e apps/api/.env.efa-e2e.local -- npx playwright test e2e/puzzles-edge.e2e.spec.ts
 */
import { readFileSync } from 'fs';
import { expect, test } from '@playwright/test';
import { acceptNotice, answerQuestionnaire, colourCheck, loginStudent } from './puzzles.helpers';

const env = process.env;
const STUDENT_URL = env.E2E_BASE_URL ?? 'http://localhost:5175';
const ADMIN_URL = env.E2E_ADMIN_URL ?? 'http://localhost:5176';
const COURSE_ID = env.E2E_COURSE_ID;

test.use({ viewport: { width: 1400, height: 900 }, actionTimeout: 30_000 });
test.describe.configure({ retries: 0 });
test.skip(
  !env.E2E_STUDENT_LOGIN || !env.E2E_TEACHER_EMAIL || !COURSE_ID,
  'set the E2E_* variables from apps/api/.env.efa-e2e.local',
);

test('colour check fails, reload interrupts a puzzle, staff unlock and export', async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const student = await (await browser.newContext({ baseURL: STUDENT_URL })).newPage();
  const staff = await (
    await browser.newContext({ baseURL: ADMIN_URL, acceptDownloads: true })
  ).newPage();

  // ── student: questionnaire, wrong colour name, then reload during puzzle 1
  await loginStudent(student, env.E2E_STUDENT_LOGIN!, env.E2E_STUDENT_PASSWORD!);
  await student.goto(`/student/courses/${COURSE_ID}/puzzles/T0`);
  await acceptNotice(student);
  await answerQuestionnaire(student);
  await colourCheck(student, false);

  await student.getByRole('button', { name: 'Start puzzle 1' }).click();
  await student.getByRole('button', { name: 'Continue' }).click(); // part instructions
  await expect(student.getByTestId('sequence-item')).toBeVisible();
  await student.reload();
  await expect(student.getByRole('button', { name: 'Start puzzle 2' })).toBeVisible();

  // ── staff: dashboard shows the interrupted and the skipped puzzle
  await staff.goto('/login');
  await staff.getByPlaceholder('you@example.com or your login ID').fill(env.E2E_TEACHER_EMAIL!);
  await staff.getByLabel('Password').fill(env.E2E_TEACHER_PASSWORD!);
  await staff.keyboard.press('Enter');
  await staff.waitForURL(/\/teacher/);
  await staff.goto(`/teacher/courses/${COURSE_ID}/efa`);
  const table = staff.getByTestId('efa-progress');
  await table.locator('tbody button').first().click();
  const w1 = staff.getByRole('row', { name: /W1 Number repetition/ });
  await expect(w1.getByText('interrupted').first()).toBeVisible();
  await expect(
    staff.getByRole('row', { name: /W6 Colours/ }).getByText('skipped', { exact: true }),
  ).toBeVisible();
  await expect(staff.getByText('failed (colours skipped)')).toBeVisible();

  // Unlock the puzzles gate with a reason.
  await table.getByRole('button', { name: 'Unlock…' }).first().click();
  await expect(staff.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await staff.getByPlaceholder('Reason (required)').fill('browser test: unlock after device issue');
  await staff.getByRole('button', { name: 'Confirm' }).click();
  await expect(table.getByText('✓ (unlocked)')).toBeVisible();

  // Export: task scores, pseudonymised. The reload came before any answer,
  // so W1 has no trials, but its interrupted run is scored and exported.
  await staff.getByRole('link', { name: /Coding and exports/ }).click();
  const [download] = await Promise.all([
    staff.waitForEvent('download'),
    staff.getByRole('button', { name: 'Task scores.csv' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('ef_task_scores.csv');
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv.startsWith('pid,occasion,form,order_code,task')).toBe(true);
  expect(csv).toMatch(/,w1,1,interrupted,efa-1\.0\.0,/);
  expect(csv).not.toContain(env.E2E_STUDENT_LOGIN!);

  // ── student: Session 1 is open now
  await student.goto(`/student/courses/${COURSE_ID}`);
  await expect(student.getByTestId('course-gate-checklist')).toHaveCount(0);
});
