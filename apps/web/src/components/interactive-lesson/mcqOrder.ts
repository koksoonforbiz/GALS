/**
 * The course HTML's deterministic per-slide MCQ option shuffle, reproduced
 * exactly (course_slides.html, case "mcq") so learners see the same order
 * in GALS as in the study edition. Returns ORIGINAL option indices in
 * display order; `mcq_answered.option` always logs the original index.
 */
export function mcqOrder(key: string, n: number): number[] {
  let seed = 0;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => ((seed * (a + 7)) % 97) - ((seed * (b + 7)) % 97),
  );
}
