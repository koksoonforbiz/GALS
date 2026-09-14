/**
 * Two-door import boundary (Phase 1 guardrail, Phase 2 wiring).
 *
 * The student build must contain no teacher/admin code. This is enforced
 * here as a *reachability* rule, not a per-file import rule: anything
 * transitively reachable from the student entry that lands in a
 * teacher-only module fails the build. ESLint's no-restricted-imports
 * can't express "reachable from", which is why this is dependency-cruiser.
 *
 * Directory lists come from docs/two-door/route-table.md (Phase 0 import
 * graph). The two whitelisted files are the read-only content renderer
 * that student pages legitimately need; the TipTap editor proper stays
 * forbidden.
 *
 * Phase 2 seeds `from` at src/entry-student.tsx — the exact root Vite
 * bundles for the public door — and adds the admin-only wiring modules
 * (admin entry/app, teacher routes + nav, Register, Health) to the
 * forbidden set.
 *
 * Run: pnpm --filter @ats/web lint:boundaries  (also chained into `lint`)
 */

const TEACHER_ONLY =
  '^src/(' +
  // teacher-only directories
  'pages/teacher|pages/dashboard|features/text-mining|features/openface3|' +
  'components/teacher|components/dashboard|components/editor' +
  ')/' +
  '|^src/(' +
  // admin-door wiring and admin-only pages
  'entry-admin\\.tsx|app/AdminApp\\.tsx|routes/teacherRoutes\\.tsx|routes/adminOnlyRoutes\\.tsx|' +
  'nav/teacherNav\\.tsx|pages/Register\\.tsx|pages/Health\\.tsx' +
  ')$';

// Read-only renderer for teacher-authored content; needed by the student
// course view. Not the editor. The stylesheet is included because
// BlockRenderer renders with the `.tiptap` class it defines.
const SHARED_EXCEPTIONS =
  '^src/components/editor/(BlockRenderer\\.tsx|block-types\\.ts|editor-styles\\.css)$';

module.exports = {
  forbidden: [
    {
      name: 'student-must-not-reach-teacher-code',
      severity: 'error',
      comment:
        'A module reachable from the student entry lands in a teacher-only module. ' +
        'This would leak admin code into the public student bundle. ' +
        'See docs/two-door/route-table.md.',
      from: { path: '^src/entry-student\\.tsx$' },
      to: { path: TEACHER_ONLY, pathNot: SHARED_EXCEPTIONS, reachable: true },
    },
    {
      name: 'student-must-not-import-teacher-code-directly',
      severity: 'error',
      comment: 'Direct import of a teacher-only module from student-side code.',
      from: {
        path:
          '^src/(pages/student|components/(FloatingChatbot|dialogue|code-practice|student))/' +
          '|^src/(app/StudentApp|routes/studentRoutes|routes/authRoutes|routes/shell|nav/studentNav)\\.tsx$',
      },
      to: { path: TEACHER_ONLY, pathNot: SHARED_EXCEPTIONS },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
