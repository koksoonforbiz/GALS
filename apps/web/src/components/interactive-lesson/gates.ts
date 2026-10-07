/**
 * Minimum trimmed lengths the course HTML enforces before a save/reveal
 * (course_slides.html). Mirrors LESSON_GATES in packages/shared — the web
 * app only imports *types* from @ats/shared (its CJS dist is not
 * pre-bundled by Vite), so the values are repeated here. Keep in sync.
 */
export const LESSON_GATES = {
  think: 20,
  predict: 20,
  reflect: 20,
  results: 20,
  checkAnswer: 10,
  mcqRationale: 15,
  misconceptionReason: 8,
} as const;
