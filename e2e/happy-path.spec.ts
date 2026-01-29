import { test, expect } from '@playwright/test';

/**
 * E2E Happy-Path Test
 *
 * Prerequisites: full stack running via `pnpm docker:up`
 * (api, web, worker, postgres, redis, minio)
 *
 * This test:
 * 1. Seeds test data via the dev/seed endpoint
 * 2. Registers a new student (tests registration flow)
 * 3. Logs in as the seeded student (who has an enrollment and assessment)
 * 4. Starts an assessment
 * 5. Draws a stroke on the canvas
 * 6. Fills in a text answer
 * 7. Submits
 * 8. Waits for the auto-grader to grade the submission
 */

const API_URL = 'http://localhost:3000';

interface SeedResponse {
  message: string;
  credentials: {
    teacher: { email: string; password: string };
    student: { email: string; password: string };
  };
  ids: {
    teacherId: string;
    studentId: string;
    courseId: string;
    topicId: string;
    questionId: string;
    assessmentId: string;
    attemptId: string;
  };
}

test.describe('Happy path: student assessment flow', () => {
  let seedData: SeedResponse;

  test.beforeAll(async ({ request }) => {
    // Seed test data (creates teacher, student, course, topic, question, assessment, attempt)
    const seedRes = await request.post(`${API_URL}/api/dev/seed`);
    expect(seedRes.ok()).toBeTruthy();
    seedData = await seedRes.json();
  });

  test('register a new student', async ({ page }) => {
    const timestamp = Date.now();
    await page.goto('/register');

    await page.getByLabel('Full Name').fill(`E2E Student ${timestamp}`);
    await page.getByLabel('Email address').fill(`e2e-${timestamp}@test.com`);
    await page.getByLabel('Password').fill('password123');
    // Select student role from dropdown
    await page.locator('select#role').selectOption('student');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Should redirect to student dashboard
    await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });
  });

  test('login as seeded student and complete assessment', async ({ page }) => {
    // Login as the seeded student (who has enrollment + assessment)
    await page.goto('/login');
    await page.getByLabel('Email address').fill(seedData.credentials.student.email);
    await page.getByLabel('Password').fill(seedData.credentials.student.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should redirect to student dashboard
    await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });

    // Navigate to assessments page
    await page.goto('/student/assessments');
    await page.waitForLoadState('networkidle');

    // Click Start or Continue on the first assessment
    const actionButton = page
      .getByRole('button', { name: /Start|Continue/ })
      .first();
    await expect(actionButton).toBeVisible({ timeout: 10_000 });
    await actionButton.click();

    // Wait for attempt page to load
    await expect(page).toHaveURL(/\/student\/attempt\//, { timeout: 10_000 });

    // Draw a stroke on the canvas (if visible)
    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 50, box.y + 50);
        await page.mouse.down();
        await page.mouse.move(box.x + 150, box.y + 150, { steps: 10 });
        await page.mouse.up();
      }
    }

    // Type a text response (if textarea is visible)
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await textarea.fill(
        'Photosynthesis is the process by which plants convert sunlight into energy using chlorophyll.',
      );
    }

    // Submit the answer
    const submitButton = page.getByRole('button', { name: /Submit/ });
    await expect(submitButton).toBeVisible();
    await submitButton.click();

    // Wait for submission status — should see "Grading in progress"
    await expect(
      page.getByText(/submitted|Grading in progress/i),
    ).toBeVisible({ timeout: 15_000 });

    // Wait for grade to complete (worker auto-grades via event queue)
    await expect(page.getByText(/Grading Complete/i)).toBeVisible({
      timeout: 30_000,
    });

    // Verify score is displayed
    await expect(page.locator('text=/\\d+\\/\\d+/')).toBeVisible();
  });
});
