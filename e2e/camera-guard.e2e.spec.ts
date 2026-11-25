/**
 * Recording on the timed pages + the camera guard, in a real browser
 * (student bundle). On the attention and memory puzzles page the webcam is
 * recorded and screen/DOM snapshots are uploaded (gentle mode); if the
 * camera is covered or stopped, the page is blocked until it works again,
 * and CAMERA_BLOCKED / CAMERA_RESTORED are logged.
 *
 * The camera is a controllable fake: getUserMedia returns a canvas stream
 * that draws either a noisy scene or solid black ("covered").
 *
 *   pnpm --filter @ats/api run seed:efa-e2e-local
 *   pnpm --filter @ats/api run seed:camera-e2e-local
 *   API on :3100, student bundle (dev build) on :5175 (GALS_API_TARGET)
 *   E2E_BASE_URL=http://localhost:5175 dotenv -e apps/api/.env.efa-e2e.local -- npx playwright test e2e/camera-guard.e2e.spec.ts
 */
import { expect, test, type Page, type Request } from '@playwright/test';
import { loginStudent } from './puzzles.helpers';

const env = process.env;

test.use({
  baseURL: env.E2E_BASE_URL ?? 'http://localhost:5175',
  viewport: { width: 1700, height: 900 },
  actionTimeout: 30_000,
});
test.describe.configure({ retries: 0 });
test.skip(
  !env.E2E_STUDENT_LOGIN || !env.E2E_COURSE_ID,
  'set the E2E_* variables from apps/api/.env.efa-e2e.local',
);

declare global {
  interface Window {
    __cam: { mode: 'scene' | 'black'; streams: MediaStream[] };
  }
}

/** Replace the camera with a canvas we can switch between a scene and black. */
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    window.__cam = { mode: 'scene', streams: [] };
    const md = navigator.mediaDevices;
    md.getUserMedia = async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const ctx = c.getContext('2d')!;
      const draw = () => {
        if (window.__cam.mode === 'black') {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, c.width, c.height);
          return;
        }
        for (let i = 0; i < 300; i++) {
          const g = Math.floor(Math.random() * 255);
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          ctx.fillRect(Math.random() * 320, Math.random() * 240, 24, 24);
        }
      };
      draw();
      setInterval(draw, 60);
      const s = c.captureStream(15);
      window.__cam.streams.push(s);
      return s;
    };
  });
}

function activityHas(req: Request, action: string): boolean {
  if (!req.url().includes('/api/activity-log/batch')) return false;
  try {
    const body = JSON.parse(req.postData() ?? '{}') as { events?: { action: string }[] };
    return !!body.events?.some((e) => e.action === action);
  } catch {
    return false;
  }
}

test('puzzles: webcam + screen recorded; covered or stopped camera blocks the page', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await fakeCamera(page);
  await loginStudent(page, env.E2E_STUDENT_LOGIN!, env.E2E_STUDENT_PASSWORD!);

  const initiated = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes('/api/recording/segments/initiate'),
  );
  const snapshot = page.waitForRequest(
    (r) => r.method() === 'POST' && r.url().includes('/api/logs/replay-snapshots'),
    { timeout: 30_000 },
  );
  await page.goto(`/student/courses/${env.E2E_COURSE_ID}/puzzles/T0`);
  await expect(page.getByText('Session recording', { exact: false })).toBeVisible();
  await initiated; // webcam segment started on the puzzles page
  await snapshot; // screen/DOM snapshots are uploaded (no longer paused)
  expect(page.url()).toContain('/puzzles/');

  const overlay = page.getByTestId('camera-off-overlay');
  await expect(overlay).toHaveCount(0);

  // Cover the lens: blocked, inert, logged.
  const blocked = page.waitForRequest((r) => activityHas(r, 'CAMERA_BLOCKED'), {
    timeout: 30_000,
  });
  await page.evaluate(() => (window.__cam.mode = 'black'));
  await expect(overlay).toHaveAttribute('data-problem', 'covered', { timeout: 10_000 });
  await expect(page.locator('#root')).toHaveAttribute('inert', '');
  await blocked;

  // Uncover: unblocked, logged.
  const restored = page.waitForRequest((r) => activityHas(r, 'CAMERA_RESTORED'), {
    timeout: 30_000,
  });
  await page.evaluate(() => (window.__cam.mode = 'scene'));
  await expect(overlay).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('#root')).not.toHaveAttribute('inert', '');
  await restored;

  // Turn the camera off: blocked until "Turn camera on" gets a new stream.
  await page.evaluate(() =>
    window.__cam.streams.forEach((s) => s.getTracks().forEach((t) => t.stop())),
  );
  await expect(overlay).toHaveAttribute('data-problem', 'off', { timeout: 10_000 });
  await page.getByTestId('camera-restart').click();
  await expect(overlay).toHaveCount(0, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__cam.streams.length)).toBeGreaterThan(1);
});
