/**
 * Client-only memory of recent AI outputs, for OUTPUT_PASTED.matchesAiOutput.
 * Plan rule 5: clipboard text never leaves the browser — pasted text is
 * compared here against the last N responses and only the verdict (+ chars,
 * runId) is logged.
 */
const MAX_OUTPUTS = 20;
const recent: Array<{ runId: string; norm: string; shingles: Set<string>; channel: string }> = [];

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

/**
 * Remember an AI output the learner was shown. `channel`: prompt_lab (default)
 * or learning_assistant (the chatbot); `runId` is the Prompt Lab run or the
 * chatbot turn id. The last 3 outputs' word 5-grams are also kept, hashed,
 * in sessionStorage for copy provenance (no text is stored).
 */
export function rememberOutput(runId: string, text: string, channel = 'prompt_lab') {
  const norm = normalise(text);
  if (!norm) return;
  const existing = recent.findIndex((r) => r.runId === runId);
  if (existing >= 0) recent.splice(existing, 1);
  recent.unshift({ runId, norm, shingles: shingles(norm), channel });
  if (recent.length > MAX_OUTPUTS) recent.length = MAX_OUTPUTS;
  rememberFingerprint(runId, channel, norm);
}

// ── Copy provenance (Prompt B, P5 / WP5 G4) ──────────────────────────────
// Similarity of a paste to the last 3 AI outputs: Jaccard over word 5-grams,
// computed here; the score and the matched output's id and channel are
// logged with the paste.
const FP_KEY = 'gals.aiOutputs.fp.v1';
const FP_KEEP = 3;
interface Fingerprint {
  id: string;
  channel: string;
  grams: string[];
}

/** FNV-1a 32-bit, hex: 5-grams are compared as hashes, never stored as text. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function grams5(norm: string): Set<string> {
  const w = norm.split(' ').filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i + 4 < w.length; i++) out.add(fnv(w.slice(i, i + 5).join(' ')));
  if (out.size === 0 && norm) out.add(fnv(norm));
  return out;
}

function readFingerprints(): Fingerprint[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(FP_KEY) ?? '[]') as Fingerprint[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rememberFingerprint(id: string, channel: string, norm: string) {
  const list = readFingerprints().filter((f) => f.id !== id);
  list.unshift({ id, channel, grams: [...grams5(norm)] });
  try {
    sessionStorage.setItem(FP_KEY, JSON.stringify(list.slice(0, FP_KEEP)));
  } catch {
    // Storage full or unavailable: similarity is then computed on nothing.
  }
}

export interface CopyProvenance {
  /** Jaccard similarity of word 5-grams with the best-matching output (0-1). */
  similarity: number;
  /** Share of the pasted 5-grams found in that output (0-1). */
  containment: number;
  matchedTurnId: string;
  sourceChannel: string;
}

/** The paste compared with the last 3 AI outputs shown; null when there are none. */
export function provenanceOf(text: string): CopyProvenance | null {
  const norm = normalise(text);
  if (!norm) return null;
  const g = grams5(norm);
  let best: CopyProvenance | null = null;
  for (const f of readFingerprints()) {
    const out = new Set(f.grams);
    let inter = 0;
    for (const x of g) if (out.has(x)) inter++;
    const union = g.size + out.size - inter;
    const similarity = union ? inter / union : 0;
    const containment = g.size ? inter / g.size : 0;
    if (
      !best ||
      containment > best.containment ||
      (containment === best.containment && similarity > best.similarity)
    ) {
      best = {
        similarity: Math.round(similarity * 1000) / 1000,
        containment: Math.round(containment * 1000) / 1000,
        matchedTurnId: f.id,
        sourceChannel: f.channel,
      };
    }
  }
  return best;
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
  try {
    sessionStorage.removeItem(FP_KEY);
  } catch {
    // ignore
  }
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
