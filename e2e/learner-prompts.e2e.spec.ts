/**
 * Learner prompts in a real browser (Prompt B, P5d): the goal card at the
 * start of a session, the reflection at sign-out, both stored in the
 * session they belong to. Same local stack as capture-resilience.e2e.spec.ts.
 */
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { loginStudent } from './puzzles.helpers';

const env = process.env;
const PG = env.E2E_PG_CONTAINER ?? 'gals-milestone-1-monorepo-postgres-1';

test.use({ baseURL: env.E2E_BASE_URL ?? 'http://localhost:5175', actionTimeout: 30_000 });
test.describe.configure({ retries: 0 });
test.skip(
  !env.E2E_STUDENT_LOGIN || !env.E2E_COURSE_ID,
  'set the E2E_* variables from apps/api/.env.efa-e2e.local',
);

function sql(q: string): string {
  const args = ['-e', 'docker', 'exec', PG, 'psql', '-U', env.E2E_PG_USER ?? 'ats_user'];
  args.push('-d', env.E2E_PG_DB ?? 'ats_db', '-At', '-c', q);
  return execFileSync(process.platform === 'win32' ? 'wsl' : args.shift()!, args, {
    encoding: 'utf8',
  }).trim();
}

test('goal card at session start and reflection at sign-out are stored in the session', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await loginStudent(page, env.E2E_STUDENT_LOGIN!, env.E2E_STUDENT_PASSWORD!);
  await page.goto(`/student/courses/${env.E2E_COURSE_ID}`);
  const sid = await page.evaluate(() => sessionStorage.getItem('ats_session_id'));
  expect(sid).toBeTruthy();

  const goal = page.getByTestId('prompt-goal_card');
  await expect(goal).toBeVisible();
  await expect(goal).toContainText('What do you want to get done in this session?');
  await goal.getByRole('button', { name: 'Finish this lesson' }).click();
  await expect(goal).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new Event('gals:request-sign-out')));
  const refl = page.getByTestId('prompt-session_reflection');
  await expect(refl).toBeVisible();
  await refl.getByLabel('One thing I learned').fill('How to test prompts');
  await refl.getByLabel('One thing still unclear').fill('Temperature');
  await refl.getByRole('button', { name: 'Save and sign out' }).click();

  // The chatbot's intention tag also shows (once per item), so check each prompt by name.
  await expect
    .poll(
      () =>
        sql(
          `select count(*) from activity_logs where session_id='${sid}' and action='SESSION_REFLECTION_SUBMITTED'`,
        ),
      { timeout: 30_000, intervals: [1_000] },
    )
    .toBe('1');
  const shown = sql(
    `select string_agg(distinct metadata->>'affordance', ',') from activity_logs where session_id='${sid}' and action='AFFORDANCE_SHOWN'`,
  ).split(',');
  expect(shown).toEqual(expect.arrayContaining(['goal_card', 'session_reflection']));
  expect(
    sql(
      `select metadata->>'goal' || '|' || (metadata->>'source') from activity_logs where session_id='${sid}' and action='GOAL_SET'`,
    ),
  ).toBe('Finish this lesson|option');
  expect(
    sql(
      `select metadata->>'learned' from activity_logs where session_id='${sid}' and action='SESSION_REFLECTION_SUBMITTED'`,
    ),
  ).toBe('How to test prompts');
});
