#!/usr/bin/env node
/**
 * Two-door verification (docs/two-door/, Phase 6) — runs against a live
 * stack and prints PASS/FAIL per check. Exit 1 if anything fails.
 *
 *   node deploy/scripts/verify-twodoor.mjs                       # unauthenticated checks
 *   STUDENT_LOGIN=twodoor-student STUDENT_PASSWORD=... \
 *   TEACHER_EMAIL=twodoor-teacher@gals.test TEACHER_PASSWORD=... \
 *   node deploy/scripts/verify-twodoor.mjs                       # + authenticated checks
 *
 * Credentials come from `pnpm run seed:twodoor` (printed once). Override
 * the door origins with STUDENT_URL / ADMIN_URL (defaults below). The
 * `--insecure` flag (default ON for *.gals.test / localhost) accepts the
 * mkcert certificate, since Node does not consult the OS trust store.
 *
 * Needs Node 18+ (global fetch). No dependencies.
 */

const STUDENT_URL = (process.env.STUDENT_URL ?? 'https://student.gals.test:8443').replace(/\/$/, '');
const ADMIN_URL = (process.env.ADMIN_URL ?? 'https://admin.gals.test:9443').replace(/\/$/, '');
const insecure =
  process.argv.includes('--insecure') || /gals\.test|localhost|127\.0\.0\.1/.test(STUDENT_URL);
if (insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const creds = {
  student: { login: process.env.STUDENT_LOGIN, password: process.env.STUDENT_PASSWORD },
  teacher: { login: process.env.TEACHER_EMAIL, password: process.env.TEACHER_PASSWORD },
};

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function req(base, path, init = {}) {
  const res = await fetch(base + path, { redirect: 'manual', ...init });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function expectStatus(name, base, path, want, init) {
  try {
    const r = await req(base, path, init);
    const ok = Array.isArray(want) ? want.includes(r.status) : r.status === want;
    record(name, ok, `${init?.method ?? 'GET'} ${path} → ${r.status}${ok ? '' : ` (wanted ${want})`}`);
    return r;
  } catch (err) {
    record(name, false, `${path} → ${err.message}`);
    return null;
  }
}

async function login(base, identifier, password) {
  const r = await req(base, '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (r.status !== 200 && r.status !== 201) throw new Error(`login ${r.status}: ${r.text.slice(0, 120)}`);
  const body = JSON.parse(r.text);
  if (!body.accessToken) throw new Error(`login returned no accessToken (2FA pending?): ${r.text.slice(0, 120)}`);
  return body.accessToken;
}

/**
 * Socket.IO over long-polling with plain fetch: open the Engine.IO
 * session, send a CONNECT packet for `namespace` with `auth`, and read
 * back either `40<ns>,{sid}` (accepted) or `44<ns>,{message}` (refused).
 */
async function socketConnect(base, namespace, auth) {
  const open = await req(base, '/socket.io/?EIO=4&transport=polling');
  if (open.status !== 200) return { status: open.status, accepted: false, detail: `handshake ${open.status}` };
  const sid = JSON.parse(open.text.replace(/^0/, '')).sid;
  const ns = namespace === '/' ? '' : namespace;
  await req(base, `/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8' },
    body: `40${ns},${JSON.stringify(auth ?? {})}`,
  });
  const poll = await req(base, `/socket.io/?EIO=4&transport=polling&sid=${sid}`);
  const accepted = poll.text.startsWith(`40${ns},`);
  const refused = poll.text.startsWith(`44${ns},`);
  return { status: poll.status, accepted, refused, detail: poll.text.slice(0, 80) };
}

async function main() {
  console.log(`student door: ${STUDENT_URL}\nadmin door:   ${ADMIN_URL}\n`);

  // ── Static shells ───────────────────────────────────────────────────
  const s = await expectStatus('public door serves the student shell', STUDENT_URL, '/', 200);
  if (s) record('  …with the student entry chunk, not the admin one', /assets\/student-[\w-]+\.js/.test(s.text), s.text.match(/assets\/[\w-]+\.js/)?.[0] ?? 'no script tag');
  const a = await expectStatus('private door serves the admin shell', ADMIN_URL, '/', 200);
  if (a) record('  …with the admin (index) entry chunk', /assets\/index-[\w-]+\.js/.test(a.text), a.text.match(/assets\/[\w-]+\.js/)?.[0] ?? 'no script tag');
  const hdr = await req(STUDENT_URL, '/index.html');
  record('security headers present on the public door', hdr.headers.get('x-frame-options') === 'DENY' && hdr.headers.get('x-content-type-options') === 'nosniff', `x-frame-options=${hdr.headers.get('x-frame-options')}`);
  record('SPA fallback: unknown path → shell (200), not 404', (await req(STUDENT_URL, '/student/courses')).status === 200);

  // ── nginx allowlist (unauthenticated) ────────────────────────────────
  await expectStatus('public: /api/health is not served', STUDENT_URL, '/api/health', 404);
  await expectStatus('private: /api/health is served', ADMIN_URL, '/api/health', 200);
  await expectStatus('public: private API prefix → 404 (not 401 — nginx, before the API)', STUDENT_URL, '/api/user-management/users', 404);
  await expectStatus('public: private teacher read → 404', STUDENT_URL, '/api/activity-log/teacher/students/0f1e2d3c-4b5a-4697-8899-aabbccddeeff/sessions', 404);
  await expectStatus('public: allowlisted route reaches the API → 401 (JWT required)', STUDENT_URL, '/api/courses/catalog', 401);
  await expectStatus('public: method limit — POST /api/courses → 404', STUDENT_URL, '/api/courses', 404, { method: 'POST' });
  await expectStatus('public: POST /api/auth/register → 404', STUDENT_URL, '/api/auth/register', 404, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await expectStatus('private: POST /api/auth/register reaches the API (400 on empty body)', ADMIN_URL, '/api/auth/register', 400, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  await expectStatus('public: spoofed X-GALS-Door: private is ignored by nginx', STUDENT_URL, '/api/health', 404, { headers: { 'X-GALS-Door': 'private' } });
  await expectStatus('public: bad login reaches the API → 401', STUDENT_URL, '/api/auth/login', 401, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier: 'nobody@gals.test', password: 'x' }) });
  {
    // An unsigned GET must reach MinIO (S3 XML error body), not die at nginx.
    const r = await req(STUDENT_URL, '/s3/gals-verify-probe/key');
    record('public: /s3/ proxy reaches MinIO (S3 error XML, not an nginx 404 page)', [403, 404].includes(r.status) && r.text.includes('<Error>'), `${r.status} ${r.text.slice(0, 60).replace(/\s+/g, ' ')}`);
  }

  // ── Socket.IO without a token ────────────────────────────────────────
  for (const [base, label] of [[STUDENT_URL, 'public'], [ADMIN_URL, 'private']]) {
    const r = await socketConnect(base, '/dialogue');
    record(`${label}: /dialogue socket without a token is refused`, r.refused, r.detail);
  }

  // ── Authenticated checks (need seed credentials) ─────────────────────
  let studentToken;
  let teacherToken;
  if (creds.student.login && creds.student.password) {
    try {
      studentToken = await login(STUDENT_URL, creds.student.login, creds.student.password);
      record('student can log in on the public door', true);
    } catch (err) {
      record('student can log in on the public door', false, err.message);
    }
  }
  if (creds.teacher.login && creds.teacher.password) {
    try {
      teacherToken = await login(ADMIN_URL, creds.teacher.login, creds.teacher.password);
      record('teacher can log in on the private door', true);
    } catch (err) {
      record('teacher can log in on the private door', false, err.message);
    }
  }
  if (!studentToken && !teacherToken) {
    console.log('\n(no STUDENT_LOGIN/TEACHER_EMAIL credentials given — authenticated checks skipped)');
  }

  if (studentToken) {
    const auth = { headers: { authorization: `Bearer ${studentToken}` } };
    await expectStatus('student: GET /api/auth/me on the public door', STUDENT_URL, '/api/auth/me', 200, auth);
    await expectStatus('student: teacher route with a valid student token → still 404 on the public door', STUDENT_URL, '/api/attempts/review', 404, auth);
    await expectStatus('student: biometric export (no longer role-less) → 403 on the private door', ADMIN_URL, '/api/webgazer/logs/0f1e2d3c-4b5a-4697-8899-aabbccddeeff/0f1e2d3c-4b5a-4697-8899-aabbccddeeff/export', 403, auth);

    // PDF through /s3/: find the seeded course → module → PDF item.
    try {
      const my = JSON.parse((await req(STUDENT_URL, '/api/enrollments/my', auth)).text);
      // GET /api/enrollments/my returns Enrollment[] (with `course` included).
      const courseId = Array.isArray(my) ? my[0]?.courseId : undefined;
      if (!courseId) throw new Error('student has no enrollment — run the seed');
      const course = JSON.parse((await req(STUDENT_URL, `/api/courses/${courseId}`, auth)).text);
      const pdfItem = (course.modules ?? []).flatMap((m) => m.items ?? []).find((i) => i.type === 'PDF' && i.pdfBlobKey);
      if (!pdfItem) throw new Error('no PDF item on the seeded course');
      const dl = JSON.parse((await req(STUDENT_URL, `/api/items/${pdfItem.id}/download-url`, auth)).text);
      const url = dl.url; // ItemsService.getDownloadUrl → { url, filename }
      record('download-url is a relative /s3/ path (no MinIO hostname)', typeof url === 'string' && url.startsWith('/s3/'), String(url).slice(0, 60));
      const pdf = await fetch(STUDENT_URL + url);
      const ct = pdf.headers.get('content-type') ?? '';
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      record('presigned PDF fetch through nginx → MinIO succeeds (SigV4 Host preserved)', pdf.status === 200 && bytes[0] === 0x25 && bytes[1] === 0x50, `${pdf.status} ${ct} ${bytes.length} bytes`);
    } catch (err) {
      record('PDF through /s3/', false, err.message);
    }

    const ws = await socketConnect(STUDENT_URL, '/dialogue', { token: studentToken });
    record('student: /dialogue socket with a token is accepted on the public door', ws.accepted, ws.detail);
    const tm = await socketConnect(STUDENT_URL, '/text-mining', { token: studentToken });
    record('student: /text-mining socket is refused on the public door', tm.refused, tm.detail);
  }

  if (teacherToken) {
    const auth = { headers: { authorization: `Bearer ${teacherToken}` } };
    await expectStatus('teacher: private teacher read works on the private door', ADMIN_URL, '/api/attempts/review', 200, auth);
    await expectStatus('teacher: same read with the same token → 404 on the public door', STUDENT_URL, '/api/attempts/review', 404, auth);
    const tmPriv = await socketConnect(ADMIN_URL, '/text-mining', { token: teacherToken });
    record('teacher: /text-mining socket accepted on the private door', tmPriv.accepted, tmPriv.detail);
    const tmPub = await socketConnect(STUDENT_URL, '/dialogue', { token: teacherToken });
    record('teacher: /dialogue socket refused on the public door (staff role)', tmPub.refused, tmPub.detail);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error('verification aborted:', err);
  process.exit(1);
});
