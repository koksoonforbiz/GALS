/**
 * Word-level edit statistics between two texts — used for
 * PromptLabVersion.diffFromPrev (stats only, never the text itself) and
 * mirrored client-side for OUTPUT_EDITED.editRatio.
 *
 * editRatio = (removed + added words) / words in `before`, the workbook's
 * "changed ÷ original" measure at word granularity (E_edit, rule M32).
 */
export interface DiffStats {
  addedWords: number;
  removedWords: number;
  editRatio: number;
}

const words = (t: string) => t.split(/\s+/).filter(Boolean);

/** LCS length over word arrays; O(n·m) with a guard for very long inputs. */
function lcsLength(a: string[], b: string[]): number {
  if (a.length * b.length > 4_000_000) {
    // Fallback for huge inputs: multiset overlap (upper bound on LCS).
    const counts = new Map<string, number>();
    for (const w of a) counts.set(w, (counts.get(w) ?? 0) + 1);
    let common = 0;
    for (const w of b) {
      const c = counts.get(w) ?? 0;
      if (c > 0) {
        common++;
        counts.set(w, c - 1);
      }
    }
    return common;
  }
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export function wordDiffStats(before: string, after: string): DiffStats {
  const a = words(before);
  const b = words(after);
  const common = lcsLength(a, b);
  const removedWords = a.length - common;
  const addedWords = b.length - common;
  const editRatio =
    a.length === 0 ? (b.length > 0 ? 1 : 0) : (removedWords + addedWords) / a.length;
  return { addedWords, removedWords, editRatio: Math.round(editRatio * 1000) / 1000 };
}

/** The course's approximation, matching CHARS_PER_TOKEN = 4 used by chunking. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
