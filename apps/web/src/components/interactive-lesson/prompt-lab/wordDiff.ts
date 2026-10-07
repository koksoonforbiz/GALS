/**
 * Word-level edit ratio, mirroring apps/api/src/prompt-lab/text-diff.ts:
 * (removed + added words) ÷ words in `before` (workbook E_edit, rule M32).
 */
const words = (t: string) => t.split(/\s+/).filter(Boolean);

export function editRatio(before: string, after: string): number {
  const a = words(before);
  const b = words(after);
  if (a.length === 0) return b.length > 0 ? 1 : 0;
  let common: number;
  if (a.length * b.length > 4_000_000) {
    const counts = new Map<string, number>();
    for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
    common = 0;
    for (const w of b) {
      const c = counts.get(w) ?? 0;
      if (c > 0) {
        common++;
        counts.set(w, c - 1);
      }
    }
  } else {
    let prev = new Array<number>(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      const cur = new Array<number>(b.length + 1).fill(0);
      for (let j = 1; j <= b.length; j++) {
        cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
      }
      prev = cur;
    }
    common = prev[b.length]!;
  }
  const ratio = (a.length - common + (b.length - common)) / a.length;
  return Math.round(ratio * 1000) / 1000;
}
