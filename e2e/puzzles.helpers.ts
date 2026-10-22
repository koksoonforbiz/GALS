/** Shared steps for the puzzles browser tests (not a spec file). */
import type { Page } from '@playwright/test';

export async function loginStudent(page: Page, login: string, password: string) {
  await page.addInitScript(() => sessionStorage.setItem('gals:permissions_granted', '1'));
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com or your login ID').fill(login);
  await page.getByLabel('Password').fill(password);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/student/);
}

/** Notice + device check. */
export async function acceptNotice(page: Page) {
  await page.getByLabel(/physical keyboard/).check();
  await page.getByLabel(/agree to take part/).check();
  await page.getByRole('button', { name: /Continue/ }).click();
}

async function answerQuestionnairePage(page: Page) {
  const items = page.locator('ol > li');
  await items.first().waitFor(); // the page loads its questions first
  const n = await items.count();
  for (let i = 0; i < n; i++) {
    const li = items.nth(i);
    const num = li.locator('input[type="number"]');
    if (await num.count()) {
      const min = Number((await num.getAttribute('min')) ?? 0);
      const max = Number((await num.getAttribute('max')) ?? 99);
      await num.fill(String(Math.min(max, Math.max(min, 7))));
      continue;
    }
    const radios = li.locator('input[type="radio"]');
    if (await radios.count()) {
      await radios.first().check();
      continue;
    }
    const scale = li.locator('[role="radio"]');
    if (await scale.count()) {
      await scale.first().click();
      continue;
    }
    const texts = li.locator('input:not([type])');
    for (let k = 0; k < (await texts.count()); k++) await texts.nth(k).fill('English');
  }
  await page.waitForTimeout(1200); // let the debounced autosaves land
}

export async function answerQuestionnaire(page: Page) {
  for (let guard = 0; guard < 5; guard++) {
    await answerQuestionnairePage(page);
    const next = page.getByRole('button', { name: /^(Next|Continue)$/ });
    const label = await next.textContent();
    if (!(await next.isEnabled())) {
      await page.screenshot({
        path: 'test-results/puzzles-questionnaire-stuck.png',
        fullPage: true,
      });
      const dump = await page
        .locator('ol > li')
        .evaluateAll((lis) => lis.map((li) => li.outerHTML.slice(0, 300)));
      throw new Error(`questionnaire page incomplete:\n${dump.join('\n')}`);
    }
    await next.click({ timeout: 10_000 });
    if (label?.trim() === 'Continue') return;
  }
}

/** Name the three colour patches; with `correct = false` the first one is named wrongly. */
export async function colourCheck(page: Page, correct: boolean) {
  const patches = page.locator('[aria-label^="patch "]');
  for (let i = 0; i < 3; i++) {
    const bg = await patches.nth(i).evaluate((el) => getComputedStyle(el).backgroundColor);
    const name = {
      'rgb(200, 30, 30)': 'red',
      'rgb(20, 140, 60)': 'green',
      'rgb(30, 70, 200)': 'blue',
    }[bg]!;
    const wrong = { red: 'green', green: 'blue', blue: 'red' }[name]!;
    const pick = correct || i > 0 ? name : wrong;
    await patches
      .nth(i)
      .locator('xpath=..')
      .getByRole('button', { name: pick, exact: true })
      .click();
  }
  await page.getByRole('button', { name: 'Continue' }).click();
}
