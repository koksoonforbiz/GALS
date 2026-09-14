/**
 * Lightweight, best-effort PII detection for AI chat replies
 * (checklist item 63). Deliberately NON-BLOCKING and NON-REDACTING —
 * unlike `LlmService.moderateText`, this never alters what the
 * student sees.
 *
 * Why not redact/block: the grounding contract instructs the model to
 * faithfully reproduce whatever is in a teacher's uploaded document
 * (checklist items 57-58), which can legitimately contain PII the
 * teacher put there on purpose (a worked example with a sample NRIC,
 * a case study with a name and email). Silently redacting matches
 * here would fight that instruction and could make grounded answers
 * wrong without the student or teacher knowing why. Flagging without
 * altering the reply gives visibility (a paper trail for the PDPA
 * question in `docs/DATA_INVENTORY.md`) without making that
 * fidelity-vs-redaction call unilaterally — see the checklist audit's
 * item 63 entry for the open decision this still needs.
 *
 * Regexes are intentionally simple and will both over- and
 * under-match — this is a coarse signal for a human to review, not a
 * DLP guarantee.
 */

export type PiiCategory = 'email' | 'phone' | 'sg-nric-fin' | 'credit-card' | 'us-ssn';

const PII_PATTERNS: Record<PiiCategory, RegExp> = {
  email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  // Loose international phone number: 7+ digits with optional
  // separators/country code. Conservative length floor to cut down on
  // false positives from random digit sequences (page numbers, IDs).
  phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/,
  // Singapore NRIC/FIN — the highest-stakes PII category for an SMU
  // deployment specifically (PDPA's most sensitive identifier here).
  'sg-nric-fin': /\b[STFGstfg]\d{7}[A-Za-z]\b/,
  'credit-card': /\b(?:\d[ -]?){13,16}\b/,
  'us-ssn': /\b\d{3}-\d{2}-\d{4}\b/,
};

/** Returns the categories of PII-shaped content found in `text`, or
 *  an empty array if none. Never throws. */
export function detectPii(text: string): PiiCategory[] {
  if (!text || !text.trim()) return [];
  const found: PiiCategory[] = [];
  for (const [category, pattern] of Object.entries(PII_PATTERNS) as Array<[PiiCategory, RegExp]>) {
    if (pattern.test(text)) {
      found.push(category);
    }
  }
  return found;
}
