/**
 * Attention and memory puzzles — one full T0 occasion in a real browser
 * (EF assessment, docs/EF_battery_v2). Drives the built student bundle:
 * course checklist → notice/device check → questionnaire → colour check →
 * W1–W7 → after questions → course unlocked.
 *
 * Local run (see the Phase 5 notes in docs/EF_battery_v2/IMPLEMENTATION_PLAN.md):
 *   pnpm --filter @ats/api run seed:ef-battery
 *   pnpm --filter @ats/api run seed:efa-e2e-local -- --reset      # writes apps/api/.env.efa-e2e.local
 *   API on :3100, `vite preview --config vite.config.student.ts --port 5175` with GALS_API_TARGET
 *   E2E_BASE_URL=http://localhost:5175 dotenv -e apps/api/.env.efa-e2e.local -- npx playwright test e2e/puzzles.e2e.spec.ts
 *
 * Skips unless E2E_STUDENT_LOGIN / E2E_STUDENT_PASSWORD / E2E_COURSE_ID are set.
 */
import { expect, test, type Page } from '@playwright/test';
import { acceptNotice, answerQuestionnaire, colourCheck, loginStudent } from './puzzles.helpers';

const LOGIN = process.env.E2E_STUDENT_LOGIN;
const PASSWORD = process.env.E2E_STUDENT_PASSWORD;
const COURSE_ID = process.env.E2E_COURSE_ID;

test.use({
  baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5175',
  viewport: { width: 1700, height: 900 }, // ≥ 1600: module list starts expanded
  actionTimeout: 30_000,
});
test.describe.configure({ retries: 0 });
test.skip(
  !LOGIN || !PASSWORD || !COURSE_ID,
  'set E2E_STUDENT_LOGIN, E2E_STUDENT_PASSWORD and E2E_COURSE_ID',
);

const INK: Record<string, string> = {
  'rgb(200, 30, 30)': 'f',
  'rgb(20, 140, 60)': 'j',
  'rgb(30, 70, 200)': 'k',
};
const WORD: Record<string, string> = { RED: 'f', GREEN: 'j', BLUE: 'k' };

/** Press the correct key for the highlighted Stroop cell. */
async function stroopPress(page: Page, stepId: string) {
  const cell = page.locator('[data-current="true"]');
  // between a finished row and the next screen there is no current cell
  if (!(await cell.count())) return void (await page.waitForTimeout(100));
  // the row can finish between count() and evaluate(): treat that as "no cell"
  const read = await cell
    .evaluate((el) => [el.textContent ?? '', getComputedStyle(el).color], { timeout: 1_000 })
    .catch(() => null);
  if (!read) return;
  const [text, color] = read;
  const key = stepId.includes('.W.') ? WORD[text.trim()] : INK[color];
  if (!key) {
    // the row may have just finished (its result is on the way to the server)
    if (!(await page.locator(`[data-step-id="${stepId}"]`).count())) return;
    throw new Error(`no key for ${stepId}: text=${JSON.stringify(text)} color=${color}`);
  }
  await page.keyboard.press(key);
}

async function playStep(page: Page, stats: Record<string, number>) {
  const stepEl = page.locator('[data-step-kind]');
  const kind = await stepEl.getAttribute('data-step-kind');
  const id = (await stepEl.getAttribute('data-step-id'))!;
  const attempt = await stepEl.getAttribute('data-attempt');
  stats[kind!] = (stats[kind!] ?? 0) + 1;
  // Done with this step only once the server has answered and it has left the screen.
  const gone = () =>
    page
      .locator(`[data-step-id="${id}"][data-attempt="${attempt}"]`)
      .waitFor({ state: 'detached', timeout: 90_000 });

  switch (kind) {
    case 'sequence': {
      // Wrong on purpose: exercises practice repeat + discontinue in the browser.
      const box = page.getByLabel('Your answer');
      await box.waitFor({ timeout: 20_000 });
      await box.fill('5');
      await box.press('Enter');
      break;
    }
    case 'item':
      await page.getByLabel('Your answer').fill('20');
      await page.getByLabel('Your answer').press('Enter');
      break;
    case 'list':
      for (let i = 0; i < 30; i++) {
        await page.getByLabel('Your answer').fill(String(40 + i));
        await page.getByLabel('Your answer').press('Enter');
      }
      break;
    case 'sentence':
      await page.getByLabel('One word').fill('piano');
      await page.getByLabel('One word').press('Enter');
      break;
    case 'prompt':
      for (const w of ['fish', 'fern', 'frog']) {
        await page.getByLabel('A word').fill(w);
        await page.getByLabel('A word').press('Enter');
      }
      await stepEl.waitFor({ state: 'detached', timeout: 75_000 });
      break;
    case 'grid': {
      if (await page.getByText('Press the space bar to begin.').isVisible()) {
        await page.keyboard.press('Space');
        // timed page: answer correctly for a while, one deliberate mistake, then let 45 s run out
        for (let i = 0; i < 25; i++) await stroopPress(page, id);
        await page.keyboard.press(id.includes('.W.') ? 'f' : 'j');
        await stepEl.waitFor({ state: 'detached', timeout: 60_000 });
      } else {
        while ((await page.locator(`[data-step-id="${id}"]`).count()) > 0)
          await stroopPress(page, id);
      }
      break;
    }
    case 'trail': {
      const labels = await page
        .locator('g[data-label]')
        .evaluateAll((gs) => gs.map((g) => g.getAttribute('data-label')!));
      if (id === 'w7.P1')
        await page.locator(`g[data-label="${labels[2]}"]`).dispatchEvent('mousedown'); // one error
      for (const l of labels) await page.locator(`g[data-label="${l}"]`).dispatchEvent('mousedown');
      break;
    }
    default:
      throw new Error(`unknown step kind ${kind}`);
  }
  await gone();
}

async function runPuzzle(page: Page, n: number, stats: Record<string, number>) {
  await page.getByRole('button', { name: `Start puzzle ${n}` }).click();
  for (let guard = 0; guard < 400; guard++) {
    await page.waitForSelector('[data-step-kind], button:has-text("Continue")', {
      timeout: 90_000,
    });
    if (await page.getByText('that puzzle is done').isVisible()) {
      await page.getByRole('button', { name: 'Continue' }).click();
      return;
    }
    if (await page.locator('[data-step-kind]').count()) await playStep(page, stats);
    else await page.getByRole('button', { name: 'Continue' }).click();
  }
  throw new Error(`puzzle ${n} did not finish`);
}

test('one full T0 occasion: questionnaire, all seven puzzles, course unlocked', async ({
  page,
}) => {
  test.setTimeout(20 * 60_000);
  await loginStudent(page, LOGIN!, PASSWORD!);

  // Course page: locked, with the checklist and its Start button.
  await page.goto(`/student/courses/${COURSE_ID}`);
  await expect(page.locator('[data-testid="course-gate-checklist"]:visible').first()).toBeVisible();
  await expect(page.getByText('About you and how you feel today').first()).toBeVisible();
  await page.getByRole('link', { name: 'Start' }).first().click();
  await page.waitForURL(/\/puzzles\/T0$/);
  await expect(page).toHaveTitle('Attention and memory puzzles');

  await acceptNotice(page);

  await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
  await answerQuestionnaire(page);
  await expect(page.getByRole('heading', { name: 'Colours' })).toBeVisible();
  await colourCheck(page, true);

  const stats: Record<string, number> = {};
  for (let n = 1; n <= 7; n++) await runPuzzle(page, n, stats);

  await expect(page.getByRole('heading', { name: 'After the puzzles' })).toBeVisible();
  await answerQuestionnaire(page);
  await expect(page.getByRole('heading', { name: 'Thank you' })).toBeVisible();

  // Blinding: nothing on screen names a construct.
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/executive|inhibition|working memory|Stroop|Hayling|ADEXI/i);

  await page.getByRole('button', { name: 'Back to the course' }).click();
  await expect(page.getByTestId('course-gate-checklist')).toHaveCount(0);
  await expect(page.getByText('Welcome').first()).toBeVisible();
  console.log('step kinds served:', JSON.stringify(stats));
});
