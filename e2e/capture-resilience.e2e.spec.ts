/**
 * Capture with no silent loss, in a real browser (Prompt B, P1 / B10.4).
 *
 * A student types, pastes and clicks; the network drops; the page is
 * reloaded before anything could be sent. Everything must still reach the
 * database exactly once: events wait in localStorage, the next page load
 * adopts the closed page's queue, and the server dedupes on the client ids.
 *
 *   pnpm --filter @ats/api run seed:efa-e2e-local
 *   API on :3100; student bundle on :5175 as a DEV build (the e2e screen-share bypass is dev-only):
 *     NODE_ENV=development npx vite build --mode development --config vite.config.student.ts
 *   E2E_BASE_URL=http://localhost:5175 dotenv -e apps/api/.env.efa-e2e.local -- npx playwright test e2e/capture-resilience.e2e.spec.ts
 *
 * Reads the local database through `docker exec` (local stack only).
 */
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { loginStudent } from './puzzles.helpers';

const env = process.env;
const PG = env.E2E_PG_CONTAINER ?? 'gals-milestone-1-monorepo-postgres-1';
const DB = env.E2E_PG_DB ?? 'ats_db';
const DB_USER = env.E2E_PG_USER ?? 'ats_user';

test.use({ baseURL: env.E2E_BASE_URL ?? 'http://localhost:5175', actionTimeout: 30_000 });
test.describe.configure({ retries: 0 });
test.skip(
  !env.E2E_STUDENT_LOGIN || !env.E2E_COURSE_ID,
  'set the E2E_* variables from apps/api/.env.efa-e2e.local',
);

function sql(q: string): string {
  const args = ['-e', 'docker', 'exec', PG, 'psql', '-U', DB_USER, '-d', DB, '-At', '-c', q];
  return execFileSync(process.platform === 'win32' ? 'wsl' : args.shift()!, args, {
    encoding: 'utf8',
  }).trim();
}

async function sessionIdOf(page: Page): Promise<string> {
  const sid = await page.evaluate(() => sessionStorage.getItem('ats_session_id'));
  expect(sid).toBeTruthy();
  return sid!;
}

/** A plain text field for the collectors (they listen on the document). */
async function addField(page: Page, id: string) {
  await page.evaluate((fieldId) => {
    const t = document.createElement('textarea');
    t.id = fieldId;
    t.style.cssText = 'position:fixed;top:8px;left:8px;width:300px;height:60px;z-index:99999';
    document.body.appendChild(t);
  }, id);
}

async function paste(page: Page, selector: string, text: string) {
  await page.evaluate(
    ([sel, value]) => {
      const el = document.querySelector(sel)!;
      const dt = new DataTransfer();
      dt.setData('text', value);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    },
    [selector, text] as const,
  );
}

test('typing, paste and clicks survive going offline and a reload, stored once', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  await loginStudent(page, env.E2E_STUDENT_LOGIN!, env.E2E_STUDENT_PASSWORD!);
  await page.goto(`/student/courses/${env.E2E_COURSE_ID}`);
  const sid = await sessionIdOf(page);

  // Online: a burst of typing, a paste, some clicks.
  await addField(page, 'cap-a');
  await page.locator('#cap-a').click();
  await page.keyboard.type('hello capture', { delay: 40 });
  await paste(page, '#cap-a', 'pasted from somewhere');
  await page.mouse.click(600, 400);

  // Offline: more typing and navigation, nothing can be sent.
  await context.setOffline(true);
  await page.locator('#cap-a').click();
  await page.keyboard.type(' offline words', { delay: 40 });
  await page.mouse.click(620, 420);
  await page.waitForTimeout(2_500); // the burst ends (2 s pause)
  await page.evaluate(() => {
    window.history.pushState({}, '', window.location.pathname + '?offline=1');
  });
  await page.waitForTimeout(1_000);

  // Back online, then reload at once: the closing page's queue must be adopted.
  await context.setOffline(false);
  await page.reload();
  await page.waitForTimeout(1_000);
  expect(await sessionIdOf(page)).toBe(sid);

  // Everything arrives (initial flush of the new page load).
  await expect
    .poll(
      () =>
        sql(
          `select count(*) from keystroke_logs where "sessionId" = '${sid}' and text like 'hello capture offline words%'`,
        ),
      {
        timeout: 90_000,
        intervals: [2_000],
      },
    )
    .toBe('1');
  expect(
    sql(`select text from clipboard_logs where "sessionId" = '${sid}' and action = 'paste'`),
  ).toBe('pasted from somewhere');
  const clicks = Number(sql(`select count(*) from click_logs where "sessionId" = '${sid}'`));
  expect(clicks).toBeGreaterThanOrEqual(2);

  // Exactly once, and no sequence gaps, per stream and page load.
  for (const t of ['keystroke_logs', 'clipboard_logs', 'click_logs']) {
    const dup = sql(
      `select count(*) from (select "tabId","clientSeq" from ${t} where "sessionId"='${sid}' and "clientSeq" is not null group by 1,2 having count(*)>1) d`,
    );
    expect(dup, `${t} duplicates`).toBe('0');
    const gaps = sql(
      `select count(*) from (select "clientSeq" - lag("clientSeq") over (partition by "tabId" order by "clientSeq") as d from ${t} where "sessionId"='${sid}' and "clientSeq" is not null) x where d > 1`,
    );
    expect(gaps, `${t} gaps`).toBe('0');
  }
  const actGaps = sql(
    `select count(*) from (select client_seq - lag(client_seq) over (partition by tab_id order by client_seq) as d from activity_logs where session_id='${sid}' and client_seq is not null) x where d > 1`,
  );
  expect(actGaps, 'activity gaps').toBe('0');
  expect(
    Number(
      sql(
        `select count(*) from activity_logs where session_id='${sid}' and client_event_id is not null`,
      ),
    ),
  ).toBeGreaterThan(0);
});

/**
 * Return after T2 = a new, linked session; a second tab joins the open one
 * (Prompt B, P2). Needs the API started with a short T2, e.g.
 * SESSION_T2_MS=20000, and E2E_SHORT_T2_MS set to the same value.
 */
test('a second tab joins the session; input after T2 idle starts a linked one', async ({
  page,
  context,
}) => {
  const t2 = Number(env.E2E_SHORT_T2_MS);
  test.skip(!t2, 'start the API with SESSION_T2_MS and set E2E_SHORT_T2_MS');
  test.setTimeout(120_000);
  await loginStudent(page, env.E2E_STUDENT_LOGIN!, env.E2E_STUDENT_PASSWORD!);
  await page.goto(`/student/courses/${env.E2E_COURSE_ID}`);
  const first = await sessionIdOf(page);
  await page.mouse.click(500, 300);

  // A fresh second tab (no sessionStorage) joins the same session.
  const tab2 = await context.newPage();
  await tab2.goto(`/student/courses/${env.E2E_COURSE_ID}`);
  await expect
    .poll(() => tab2.evaluate(() => sessionStorage.getItem('ats_session_id')))
    .toBe(first);
  await tab2.close();

  // No input for longer than T2, then a click: a new session, linked.
  await page.waitForTimeout(t2 + 3_000);
  await page.mouse.click(520, 320);
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('ats_session_id')), { timeout: 15_000 })
    .not.toBe(first);
  const second = await sessionIdOf(page);
  expect(sql(`select close_reason from student_sessions where id='${first}'`)).toBe('idle_timeout');
  expect(sql(`select previous_session_id from student_sessions where id='${second}'`)).toBe(first);
});
