/**
 * Minimal redaction for research exports of learner text (coding samples).
 * Same pattern families as rag/shared/pii-detection.ts, but replacing
 * instead of flagging. Phase 6 extends this with configurable name lists and
 * organisation terms (plan Phase 6.2 #3); until then it is deliberately
 * conservative and labelled as such in the export header.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'],
  [/\b[STFGstfg]\d{7}[A-Za-z]\b/g, '[NRIC]'],
  [/\b(?:\d[ -]?){13,16}\b/g, '[CARD]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  [/\+?(?:\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g, '[PHONE]'],
];

export function redactText(text: string, extraTerms: string[] = []): string {
  let out = text;
  for (const [re, tag] of PATTERNS) out = out.replace(re, tag);
  for (const term of extraTerms.filter((t) => t.trim().length >= 3)) {
    out = out.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[REDACTED]');
  }
  return out;
}
