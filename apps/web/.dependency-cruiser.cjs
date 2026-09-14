/**
 * Two-door import boundary (Phase 1 guardrail).
 *
 * The student build must contain no teacher/admin code. This is enforced
 * here as a *reachability* rule, not a per-file import rule: anything
 * transitively reachable from the student entry that lands in a
 * teacher-only directory fails the build. ESLint's no-restricted-imports
 * can't express "reachable from", which is why this is dependency-cruiser.
 *
 * Directory lists come from docs/two-door/route-table.md (Phase 0 import
 * graph). The two whitelisted files are the read-only content renderer
 * that student pages legitimately need; the TipTap editor proper stays
 * forbidden.
 *
 * Phase 1: `from` seeds are the student page tree (the entry file does
 * not exist yet). Phase 2 re-points `from` to src/entry-student.tsx.
 *
 * Run: pnpm --filter @ats/web lint:boundaries  (also chained into `lint`)
 */

const TEACHER_ONLY =
  '^src/(pages/teacher|pages/dashboard|features/text-mining|features/openface3|components/teacher|components/dashboard|components/editor)/';

// Read-only renderer for teacher-authored content; needed by the student
// course view. Not the editor.
const SHARED_EXCEPTIONS = '^src/components/editor/(BlockRenderer\\.tsx|block-types\\.ts)$';

module.exports = {
  forbidden: [
    {
      name: 'student-must-not-reach-teacher-code',
      severity: 'error',
      comment:
        'A module reachable from the student entry lands in a teacher-only directory. ' +
        'This would leak admin code into the public student bundle. ' +
        'See docs/two-door/route-table.md.',
      from: { path: '^src/pages/student/' },
      to: { path: TEACHER_ONLY, pathNot: SHARED_EXCEPTIONS, reachable: true },
    },
    {
      name: 'student-must-not-import-teacher-code-directly',
      severity: 'error',
      comment: 'Direct import of a teacher-only module from student-side code.',
      from: {
        path: '^src/(pages/student|components/(FloatingChatbot|dialogue|code-practice|student))/',
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
