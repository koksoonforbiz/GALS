/**
 * Client-only memory of recent AI outputs, for OUTPUT_PASTED.matchesAiOutput.
 * Plan rule 5: clipboard text never leaves the browser — pasted text is
 * compared here against the last N responses and only the verdict (+ chars,
 * runId) is logged.
 */
const MAX_OUTPUTS = 20;
const recent: Array<{ runId: string; norm: string; shingles: Set<string> }> = [];

// Case-, whitespace- and punctuation-insensitive, so light edits still match.
const normalise = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function shingles(norm: string): Set<string> {
  const w = norm.split(' ');
  const out = new Set<string>();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  if (out.size === 0 && norm) out.add(norm);
  return out;
}

export function rememberOutput(runId: string, text: string) {
  const norm = normalise(text);
  if (!norm) return;
  const existing = recent.findIndex((r) => r.runId === runId);
  if (existing >= 0) recent.splice(existing, 1);
  recent.unshift({ runId, norm, shingles: shingles(norm) });
  if (recent.length > MAX_OUTPUTS) recent.length = MAX_OUTPUTS;
}

/**
 * Exact (pasted text is a substring of an output) or near match (≥ 80 % of
 * the pasted text's word trigrams occur in one output).
 */
export function matchPaste(text: string): { runId: string; kind: 'exact' | 'near' } | null {
  const norm = normalise(text);
  if (norm.length < 12) return null;
  for (const r of recent) if (r.norm.includes(norm)) return { runId: r.runId, kind: 'exact' };
  const sh = shingles(norm);
  for (const r of recent) {
    let hit = 0;
    for (const s of sh) if (r.shingles.has(s)) hit++;
    if (sh.size > 0 && hit / sh.size >= 0.8) return { runId: r.runId, kind: 'near' };
  }
  return null;
}

/** Test hook. */
export function _resetOutputs() {
  recent.length = 0;
}

/**
 * Paste memory for OUTPUT_EDITED: the text pasted from an AI output into a
 * field (by data-field-key), held in memory until that field is saved.
 */
const pastes = new Map<string, { text: string; runId: string }>();

export function notePaste(fieldKey: string, text: string, runId: string) {
  pastes.set(fieldKey, { text, runId });
}

export function takePaste(fieldKey: string): { text: string; runId: string } | null {
  const p = pastes.get(fieldKey) ?? null;
  pastes.delete(fieldKey);
  return p;
}
