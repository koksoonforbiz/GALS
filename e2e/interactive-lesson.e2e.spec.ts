/**
 * End-to-end: complete one slide of every interactive type in Session 1 of
 * the imported prompting course, then check the saved state and the
 * activity-log stream (plan Phase 2.2 #7 / Phase 7 #1).
 *
 * Needs a running stack with the course imported and a student enrolled:
 *   pnpm --filter @ats/api run seed:prompting-course-local -- --reset-state
 *   pnpm --filter @ats/api run import:prompting-course -- \
 *     --teacher-email prompting-teacher@gals.test --publish --enroll prompting-student
 * then, with the credentials from apps/api/.env.prompting-course.local:
 *   E2E_BASE_URL=http://localhost:5173 E2E_STUDENT_LOGIN=prompting-student \
 *   E2E_STUDENT_PASSWORD=… pnpm exec playwright test e2e/interactive-lesson.e2e.spec.ts
 * Skipped when E2E_STUDENT_LOGIN / E2E_STUDENT_PASSWORD are unset.
 * E2E_CHANNEL=msedge|chrome uses an installed browser.
 */
import { test, expect, type Page } from '@playwright/test';

const LOGIN = process.env.E2E_STUDENT_LOGIN;
const PASSWORD = process.env.E2E_STUDENT_PASSWORD;
const COURSE_TITLE = 'Advanced Prompt Engineering and AI Collaboration';

test.use({
  baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
  // Optional: run on an installed browser (e.g. E2E_CHANNEL=msedge) instead
  // of Playwright's downloaded Chromium.
  ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  // The course records the webcam and blocks the page without a camera
  // picture (CameraGuard): give Chromium its built-in fake camera.
  permissions: ['camera', 'microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});
test.skip(!LOGIN || !PASSWORD, 'set E2E_STUDENT_LOGIN and E2E_STUDENT_PASSWORD');

async function jumpTo(page: Page, slideKey: string) {
  const select = page.getByLabel('Jump to slide');
  const options = await select.locator('option').allTextContents();
  // Slide keys are s1-<n>; option value is the 0-based index == n for session 1.
  const n = Number(slideKey.split('-')[1]);
  expect(options.length).toBeGreaterThan(n);
  await select.selectOption(String(n));
  await expect(page.locator(`[data-slide-key="${slideKey}"]`)).toBeVisible();
}

test('Session 1: every interactive slide type gates, saves and logs', async ({ page }) => {
  // The webcam/screen PermissionGate is out of scope here.
  await page.addInitScript(() => sessionStorage.setItem('gals:permissions_granted', '1'));
  await page.goto('/student.html');
  await page.getByPlaceholder('you@example.com or your login ID').fill(LOGIN!);
  await page.getByLabel('Password').fill(PASSWORD!);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/student/);

  await page.goto('/student/courses');
  await expect(page.getByText(COURSE_TITLE).first()).toBeVisible();
  // Open the course by id (the card's View button is exercised manually;
  // headless Edge did not dispatch its React click reliably).
  const courseId = await page.evaluate(async (title) => {
    const res = await fetch('/api/enrollments/my', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    const rows = (await res.json()) as Array<{ course: { id: string; title: string } }>;
    return rows.find((r) => r.course.title.startsWith(title))?.course.id;
  }, COURSE_TITLE);
  expect(courseId).toBeTruthy();
  // Phase 6: decide text consent up front (none given), so the notice does
  // not cover the lesson and the "no text without consent" check holds.
  const consent = await page.evaluate(async (id) => {
    const res = await fetch(`/api/text-consent/courses/${id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ answerText: false, promptsAndOutputs: false, researchUse: false }),
    });
    return res.status;
  }, courseId);
  expect(consent).toBe(200);
  await page.goto(`/student/courses/${courseId}`);
  // The course runs eye tracking: skip its calibration screen if it shows.
  const skipCalibration = page.getByRole('button', { name: 'Skip' });
  if (
    await skipCalibration.waitFor({ timeout: 8_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await skipCalibration.click();
  }
  // Learner prompts (goal card) sit bottom-left: close it so it covers nothing.
  const goal = page.getByTestId('prompt-goal_card');
  if (
    await goal.waitFor({ timeout: 5_000 }).then(
      () => true,
      () => false,
    )
  ) {
    await goal.getByRole('button', { name: 'Close' }).click();
  }
  // The course page may already have opened the first lesson.
  if (!(await page.locator('.il-root').isVisible())) {
    await page.getByRole('button', { name: 'How Language Models See Text' }).click();
  }
  await expect(page.locator('.il-root')).toBeVisible();

  const batches: Array<{ events: Array<{ action: string; metadata?: Record<string, unknown> }> }> =
    [];
  page.on('request', (req) => {
    if (req.url().includes('/api/activity-log/batch') && req.method() === 'POST') {
      try {
        batches.push(req.postDataJSON());
      } catch {
        /* ignore */
      }
    }
  });
  // Every batch must be stored: record the outcome of each one.
  const outcomes: string[] = [];
  page.on('response', async (res) => {
    if (res.url().includes('/api/activity-log/batch') && res.request().method() === 'POST') {
      outcomes.push(String(res.status()));
    }
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/activity-log/batch')) {
      outcomes.push(`failed:${req.failure()?.errorText ?? '?'}`);
    }
  });

  // think (s1-3): gate, then save + auto-advance
  await jumpTo(page, 's1-3');
  const think = page.getByPlaceholder('Write your prediction before reading on…');
  await think.fill('short');
  await page.getByRole('button', { name: 'Save prediction and continue' }).click();
  await expect(page.getByText('Write at least a sentence first.')).toBeVisible();
  await think.fill('Tokens are sub-word pieces, so counting letters is hard.');
  await page.getByRole('button', { name: 'Save prediction and continue' }).click();
  await expect(page.locator('[data-slide-key="s1-4"]')).toBeVisible();

  // mcq (s1-9): options locked until rationale saved
  await jumpTo(page, 's1-9');
  await expect(page.locator('.il-root .opt').first()).toBeDisabled();
  await page
    .getByPlaceholder('Before choosing: in one sentence, what principle decides this?')
    .fill('Token cost depends on the tokenizer merges.');
  await page.getByRole('button', { name: 'Save reasoning and unlock options' }).click();
  await page.locator('.il-root .confidence button', { hasText: '3' }).click();
  await page.locator('.il-root .opt').first().click();
  await expect(page.locator('.il-root .fb.show')).toBeVisible();

  // misconceptions (s1-16): reveal needs a choice and an 8-char reason
  await jumpTo(page, 's1-16');
  const item = page.locator('.il-root .misc .item').first();
  await item.getByRole('button', { name: 'Agree', exact: true }).click();
  await expect(item.getByRole('button', { name: 'Reveal' })).toBeDisabled();
  await item.getByPlaceholder('because…').fill('more is better');
  await item.getByRole('button', { name: 'Reveal' }).click();
  await expect(item).toHaveClass(/open/);
  await item.getByRole('button', { name: 'Yes', exact: true }).click();

  // check (s1-18): answer → show → what I missed
  await jumpTo(page, 's1-18');
  const qa = page.locator('.il-root .qa').first();
  await expect(qa.getByRole('button', { name: 'Show answer' })).toBeDisabled();
  await qa.getByPlaceholder('Your answer…').fill('Attention cost grows with length.');
  await qa.getByRole('button', { name: 'Save answer' }).click();
  await qa.getByRole('button', { name: 'Show answer' }).click();
  await qa.getByPlaceholder('One sentence…').fill('I forgot position effects.');
  await qa.getByRole('button', { name: 'Save', exact: true }).click();

  // exercise (s1-19): results gate, then analysis template
  await jumpTo(page, 's1-19');
  await page
    .getByPlaceholder('Results…')
    .fill('Ran 5 strings; code was 1.4x prose tokens on my tokenizer.');
  await page.getByRole('button', { name: 'Save results' }).click();
  await page.getByRole('button', { name: 'Open analysis template' }).click();

  // selfscore (s1-24) + reflect (s1-25)
  await jumpTo(page, 's1-24');
  await page.locator('input[name="s1-24-0"][value="2"]').check();
  await jumpTo(page, 's1-25');
  await page
    .getByPlaceholder('Write your reflection…')
    .fill('My belief about tokens changed after 1.2.');
  await page
    .getByPlaceholder('In my next real task, I will…')
    .fill('In my next real task I will count tokens first.');
  await page.getByRole('button', { name: 'Save reflection' }).click();
  await expect(page.locator('.il-root .status.ok')).toHaveText('Saved');

  // Leave the page so the final SLIDE_EXITED + buffer flush happen.
  await page.goto('/student/courses');
  await expect
    .poll(() => batches.flatMap((b) => b.events).length, { timeout: 15_000 })
    .toBeGreaterThan(10);
  // Sent is not stored: the keepalive on navigation can be cut off; the next
  // page load re-sends the queue from localStorage. Wait until the server
  // has accepted it.
  await expect
    .poll(() => outcomes.filter((o) => o === '201').length, { timeout: 60_000 })
    .toBeGreaterThan(0);

  const events = batches.flatMap((b) => b.events);
  const actions = new Set(events.map((e) => e.action));
  for (const a of [
    'SLIDE_ENTERED',
    'SLIDE_EXITED',
    'ATTEMPT_STARTED',
    'PREDICTION_COMMITTED',
    'RATIONALE_SUBMITTED',
    'CONFIDENCE_RATED',
    'MCQ_ANSWERED',
    'BELIEF_COMMITTED',
    'REFERENCE_REVEALED',
    'BELIEF_REVISED',
    'SELF_CHECK_SUBMITTED',
    'GAP_NOTED',
    'RESULTS_RECORDED',
    'CRITERION_SELF_SCORED',
    'REFLECTION_SUBMITTED',
  ]) {
    expect(actions, a).toContain(a);
  }
  // Consent is collected on the study consent form (2026-11-25), so the
  // learner's answer text is recorded with the events (TEXT_CONSENT_IN_APP
  // off). With the in-app panel on, the earlier PUT (all false) would strip it.
  const withText = events.filter(
    (e) => typeof (e.metadata as { text?: unknown })?.text === 'string',
  );
  expect(withText.length).toBeGreaterThan(0);
});
