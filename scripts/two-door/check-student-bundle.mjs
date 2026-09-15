#!/usr/bin/env node
/**
 * Two-door student-bundle leak check (Phase 5).
 *
 * Scans the built public bundle (apps/web/dist-student: index.html + every
 * assets/*.js and *.css) for strings that only exist on the private door —
 * teacher routes, admin-only pages, private API prefixes. The import
 * boundary (dependency-cruiser) prevents teacher MODULES from being
 * bundled; this catches the strings a shared module could still carry.
 *
 * Third-party runtime folders shipped verbatim (pyodide/, mediapipe/,
 * webgazer.js) are not scanned — they are not our code and cannot contain
 * our route strings.
 *
 *   pnpm --filter @ats/web build:student && node scripts/two-door/check-student-bundle.mjs
 *
 * Exit 1 on any hit, printing the pattern and a little context.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'apps', 'web', 'dist-student');

// Each entry: a literal (or regex) that must not appear, and why.
const FORBIDDEN = [
  // Frontend routes that only the admin bundle has.
  ['/teacher', 'teacher route tree'],
  ['/dashboard/sessions', 'the one teacher route outside /teacher'],
  ['/register', 'self-registration page (admin door only)'],
  ['/health', 'frontend health page (admin door only)'],
  // Private API prefixes (docs/two-door/api-classification.md, "notably denied").
  ['auth/register', 'POST /api/auth/register is private'],
  ['/user-management', 'user management API'],
  ['bulk-provision', 'bulk provisioning API'],
  ['/question-generation', 'question generation API'],
  ['/api/questions', 'question bank API'],
  ['/api/rag/', 'teacher RAG API'],
  ['/llm-settings', 'LLM settings API'],
  ['/api/llm/', 'LLM model registry API'],
  ['/api/analytics', 'analytics API'],
  ['/affective-mapping', 'affective mapping API'],
  ['/text-mining', 'text-mining API + namespace'],
  ['/replay-annotations', 'replay annotations API'],
  ['/api/jobs', 'jobs API'],
  ['/openface3', 'OpenFace3 API'],
  ['/api/evaluation', 'evaluation API'],
  ['/course-structure', 'course structure API'],
  ['/page-content', 'page content API'],
  ['/api/admin', 'admin API prefix'],
  ['/activity-log/teacher', 'teacher activity-log reads'],
  ['/api/dev', 'dev seed endpoint'],
  ['prompt-config', 'teacher prompt-config API'],
  ['/api/security-events', 'security audit API'],
  // Product strings that only the teacher UI shows.
  ['ai-settings', 'AI settings page'],
  ['Bulk Provision', 'teacher sidebar label'],
];

if (!existsSync(DIST)) {
  console.error(`dist-student not found at ${DIST} — run \`pnpm --filter @ats/web build:student\` first`);
  process.exit(2);
}

const files = [join(DIST, 'index.html')];
const assets = join(DIST, 'assets');
if (existsSync(assets)) {
  for (const name of readdirSync(assets)) {
    if (/\.(js|css|map)$/.test(name)) files.push(join(assets, name));
  }
}

let hits = 0;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const [needle, why] of FORBIDDEN) {
    let idx = text.indexOf(needle);
    while (idx !== -1) {
      hits++;
      const start = Math.max(0, idx - 60);
      const end = Math.min(text.length, idx + needle.length + 60);
      console.error(
        `LEAK ${file.slice(ROOT.length + 1)}: "${needle}" (${why})\n      …${text
          .slice(start, end)
          .replace(/\s+/g, ' ')}…`,
      );
      if (hits > 50) break;
      idx = text.indexOf(needle, idx + needle.length);
    }
  }
}

console.log(`two-door bundle check: ${files.length} file(s) in dist-student scanned, ${FORBIDDEN.length} patterns`);
if (hits) {
  console.error(`\n${hits} leak(s) found — the public bundle carries private-door strings.`);
  process.exit(1);
}
console.log('OK — no private-door strings in the student bundle.');
