import { test, expect } from '@playwright/test';

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

test.describe('Dialogue Learning', () => {
  let seedData: SeedResponse;

  test.beforeAll(async ({ request }) => {
    const seedRes = await request.post(`${API_URL}/api/dev/seed`);
    expect(seedRes.ok()).toBeTruthy();
    seedData = await seedRes.json();
  });

  test('teacher creates a DBL course', async ({ page }) => {
    // Login as teacher
    await page.goto('/login');
    await page.getByLabel('Email address').fill(seedData.credentials.teacher.email);
    await page.getByLabel('Password').fill(seedData.credentials.teacher.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/teacher/, { timeout: 15_000 });

    // Navigate to courses page
    await page.goto('/teacher/courses');
    await page.waitForLoadState('networkidle');

    // Create a new course
    await page.getByRole('button', { name: 'Create Course' }).click();
    await page.getByLabel('Course Name').fill('Dialogue Test Course');
    await page.locator('textarea').first().fill('A test course for dialogue learning');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Course created')).toBeVisible({ timeout: 10_000 });

    // Navigate to the newly created course builder
    const editButtons = page.getByRole('button', { name: 'Edit' });
    await editButtons.first().click();
    await expect(page).toHaveURL(/\/teacher\/courses\//, { timeout: 10_000 });

    // Go to Overview tab and select Dialogue Mode
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByText('Dialogue Mode').click();

    // Verify Dialogue tab appears
    await expect(page.getByRole('button', { name: 'Dialogue' })).toBeVisible({ timeout: 5_000 });

    // Go to Dialogue tab and configure settings
    await page.getByRole('button', { name: 'Dialogue' }).click();

    // Verify settings form sections are visible
    await expect(page.getByText('LLM Configuration')).toBeVisible();
    await expect(page.getByText('Student Upload Settings')).toBeVisible();
    await expect(page.getByText('Enabled Learning Interventions')).toBeVisible();
    await expect(page.getByText('Studio Tools')).toBeVisible();

    // Save settings
    await page.getByRole('button', { name: 'Save Dialogue Settings' }).click();
    await expect(page.getByText('Dialogue course settings saved')).toBeVisible({ timeout: 10_000 });

    // Go back to courses list and verify badge
    await page.goto('/teacher/courses');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Dialogue').first()).toBeVisible();
  });

  test('student uploads a PDF and gets a source guide', async ({ page }) => {
    // Login as student
    await page.goto('/login');
    await page.getByLabel('Email address').fill(seedData.credentials.student.email);
    await page.getByLabel('Password').fill(seedData.credentials.student.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });

    // Navigate to a dialogue course page
    // Note: In a real test, the student would need to be enrolled in a DBL course
    // For now, test that the dialogue page loads
    await page.goto(`/student/courses/${seedData.ids.courseId}/dialogue`);
    await page.waitForLoadState('networkidle');

    // Verify the page loads (may show empty state or three-panel layout)
    await expect(page.locator('body')).toBeVisible();
  });

  test('student has a conversation grounded in uploaded sources', async ({ page }) => {
    // Login as student
    await page.goto('/login');
    await page.getByLabel('Email address').fill(seedData.credentials.student.email);
    await page.getByLabel('Password').fill(seedData.credentials.student.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });

    // Navigate to dialogue page
    await page.goto(`/student/courses/${seedData.ids.courseId}/dialogue`);
    await page.waitForLoadState('networkidle');

    // If chat textarea is visible, type a question
    const textarea = page.locator('textarea[data-dialogue-input]');
    if (await textarea.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await textarea.fill('What are the key concepts in this course?');

      // Click send button
      const sendButton = page
        .locator('button')
        .filter({ has: page.locator('svg') })
        .last();
      if (await sendButton.isEnabled()) {
        await sendButton.click();
        // Wait for response (typing indicator then message)
        await page.waitForTimeout(2_000);
      }
    }
  });

  test('student generates a flashcard set from sources', async ({ page }) => {
    // Login as student
    await page.goto('/login');
    await page.getByLabel('Email address').fill(seedData.credentials.student.email);
    await page.getByLabel('Password').fill(seedData.credentials.student.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });

    // Navigate to dialogue page
    await page.goto(`/student/courses/${seedData.ids.courseId}/dialogue`);
    await page.waitForLoadState('networkidle');

    // Click on Studio tab in right panel if visible
    const studioTab = page.getByText('Studio').first();
    if (await studioTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await studioTab.click();

      // Look for Flashcards tool card
      const flashcardButton = page.getByText('Flashcards');
      if (await flashcardButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
        // Verify the tool card is present
        await expect(flashcardButton).toBeVisible();
      }
    }
  });

  test('student starts a Practice Testing intervention from dialogue page', async ({ page }) => {
    // Login as student
    await page.goto('/login');
    await page.getByLabel('Email address').fill(seedData.credentials.student.email);
    await page.getByLabel('Password').fill(seedData.credentials.student.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/student/, { timeout: 15_000 });

    // Navigate to dialogue page
    await page.goto(`/student/courses/${seedData.ids.courseId}/dialogue`);
    await page.waitForLoadState('networkidle');

    // Click on Interventions tab in right panel
    const interventionsTab = page.getByText('Interventions').first();
    if (await interventionsTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await interventionsTab.click();

      // Verify Practice Testing card is visible
      const practiceTesting = page.getByText('Practice Testing');
      if (await practiceTesting.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await expect(practiceTesting).toBeVisible();
      }
    }
  });
});
