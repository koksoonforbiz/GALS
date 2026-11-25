/**
 * Study notes in a real browser (student bundle): selecting slide text shows
 * the highlight toolbar; a highlight is painted (CSS Custom Highlight API)
 * and kept after a reload; "Note" opens the Notes tab in the same panel as
 * the assistant; a note can be edited, filtered and jumped back to; the
 * home page shows course progress.
 *
 *   pnpm --filter @ats/api run seed:efa-e2e-local
 *   pnpm --filter @ats/api run seed:notes-e2e-local
 *   API on :3100, student bundle on :5175 (GALS_API_TARGET)
 *   E2E_BASE_URL=http://localhost:5175 dotenv -e apps/api/.env.efa-e2e.local -- npx playwright test e2e/study-notes.e2e.spec.ts
 */
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { loginStudent } from './puzzles.helpers';

const env = process.env;
const ENV_FILE = 'apps/api/.env.efa-e2e.local';

/** The seed recreates the course: read its new id from the env file. */
function seedCourse(): string {
  execSync('pnpm --filter @ats/api run seed:notes-e2e-local', { stdio: 'ignore' });
  const m = /^E2E_NOTES_COURSE_ID=(.+)$/m.exec(readFileSync(ENV_FILE, 'utf8'));
  return m![1]!.trim();
}

test.use({
  baseURL: env.E2E_BASE_URL ?? 'http://localhost:5175',
  viewport: { width: 1700, height: 900 },
  actionTimeout: 30_000,
});
test.describe.configure({ retries: 0 });
test.skip(!env.E2E_STUDENT_LOGIN, 'set the E2E_* variables from apps/api/.env.efa-e2e.local');

/** Screen box of `text` inside the current slide. */
async function textBox(page: Page, text: string) {
  const box = await page.evaluate((t) => {
    const scope = document.querySelector('[data-note-scope]')!;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n as Text).data.indexOf(t);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + t.length);
      const rects = r.getClientRects();
      const a = rects[0]!;
      const b = rects[rects.length - 1]!;
      return {
        x1: a.left + 1,
        y1: a.top + a.height / 2,
        x2: b.right - 1,
        y2: b.top + b.height / 2,
      };
    }
    return null;
  }, text);
  expect(box, `"${text}" on the slide`).not.toBeNull();
  return box!;
}

/** Drag-select `text` inside the current slide with the real mouse. */
async function selectText(page: Page, text: string) {
  const box = await textBox(page, text);
  await page.mouse.move(box.x1, box.y1);
  await page.mouse.down();
  await page.mouse.move(box.x2, box.y2, { steps: 8 });
  await page.mouse.up();
}

const painted = (page: Page, name: string) =>
  page.evaluate((n) => {
    const reg = (CSS as unknown as { highlights?: Map<string, Set<Range>> }).highlights;
    const h = reg?.get(n);
    return h ? [...h].map((r) => r.toString()) : [];
  }, name);

async function gotoSlide(page: Page, index: number) {
  await page.getByLabel('Jump to slide').selectOption(String(index));
}

test('highlight, note, Notes tab, jump back, progress on the home page', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const COURSE = seedCourse();
  await loginStudent(page, env.E2E_STUDENT_LOGIN!, env.E2E_STUDENT_PASSWORD!);

  // Home page: the course is listed with its progress and next step.
  await page.goto('/student');
  const card = page.getByTestId('course-progress').filter({ hasText: 'Notes e2e course' });
  await expect(card).toContainText('0 of 2 steps done');
  await expect(card).toContainText('Next: Session 1 lesson');
  await page.screenshot({ path: 'test-results/study-notes-home.png', fullPage: true });
  await card.getByRole('link', { name: /Start/ }).click();
  await expect(page).toHaveURL(new RegExp(`/student/courses/${COURSE}\\?item=`));

  // First visit, then the theory slide. The in-app privacy notice shows only
  // when TEXT_CONSENT_IN_APP is on (default: consent is on the study form).
  await expect(page.getByText('Slide 1 of 3')).toBeVisible();
  const consent = page.getByRole('button', { name: 'Save my choices' });
  if (await consent.isVisible().catch(() => false)) await consent.click();
  await gotoSlide(page, 1);
  await expect(page.getByText('Missing context is the problem.')).toBeVisible();

  // Select → toolbar → green highlight, painted on the page.
  await selectText(page, 'Missing context');
  const toolbar = page.getByRole('toolbar', { name: 'Highlight or take a note' });
  await expect(toolbar).toBeVisible();
  await page.screenshot({ path: 'test-results/study-notes-toolbar.png' });
  await toolbar.getByRole('button', { name: 'Highlight green' }).click();
  await expect(toolbar).toBeHidden();
  await expect.poll(() => painted(page, 'gals-hl-green')).toEqual(['Missing context']);
  await expect(page.getByTestId('notes-tab')).toContainText('1');

  // Select → "Note": the Notes tab replaces the chat, with the editor open.
  await selectText(page, 'guess the goal');
  await toolbar.getByRole('button', { name: 'Note' }).click();
  const editor = page.getByLabel('Your note');
  await expect(editor).toBeFocused();
  await expect(page.getByLabel('Message the learning assistant')).toBeHidden();
  await editor.fill('The model cannot read my mind: say the goal first.');
  await page.getByLabel('Search notes').click(); // blur saves
  await expect(page.getByText('The model cannot read my mind: say the goal first.')).toBeVisible();
  await expect.poll(() => painted(page, 'gals-hl-noted')).toEqual(['guess the goal']);
  await page.screenshot({ path: 'test-results/study-notes-panel.png' });

  // A typed note on another slide; "This slide" filters, "All" groups.
  await gotoSlide(page, 2);
  await expect(page.getByText('No notes on this slide yet.')).toBeVisible();
  await page
    .getByLabel('Write a note about this slide')
    .fill('Context = what a new colleague needs.');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByText('Context = what a new colleague needs.')).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText('Missing context', { exact: true })).toBeVisible();

  // "Go to" from a highlight on the other slide: back to slide 2 of 3.
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Missing context' })
    .getByRole('button', { name: /Go to/ })
    .click();
  await expect(page.getByText('Slide 2 of 3')).toBeVisible();
  // "Note" used the last colour picked (green) for its highlight.
  await expect
    .poll(async () => (await painted(page, 'gals-hl-green')).sort())
    .toEqual(['Missing context', 'guess the goal']);

  // Click the highlight: recolour it from the same toolbar.
  const hl = await textBox(page, 'Missing context');
  await page.mouse.click((hl.x1 + hl.x2) / 2, hl.y1);
  const edit = page.getByRole('toolbar', { name: 'Edit highlight' });
  await expect(edit).toBeVisible();
  await edit.getByRole('button', { name: 'Highlight pink' }).click();
  await expect.poll(() => painted(page, 'gals-hl-pink')).toEqual(['Missing context']);

  // Assistant tab is still there, unchanged; "Ask" from a note fills its context.
  await page.getByRole('tab', { name: /Assistant/ }).click();
  await expect(page.getByLabel('Message the learning assistant')).toBeVisible();

  // Kept after a reload.
  await page.reload();
  await expect(page.getByText('Missing context is the problem.')).toBeVisible();
  await expect.poll(() => painted(page, 'gals-hl-pink')).toEqual(['Missing context']);
  await expect(page.getByTestId('notes-tab')).toContainText('3');
  await page.screenshot({ path: 'test-results/study-notes-reload.png' });
});
