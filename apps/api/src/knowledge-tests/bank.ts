import { createHash } from 'crypto';
import { maxMarksOf, type KnowledgeTestItem } from '@ats/shared';

/**
 * The item bank (docs/assessment/knowledge_tests_v2.json) as definitions.
 * Items are stored verbatim: never reworded, reordered or re-keyed. The
 * checks here only refuse a bank that breaks the stated design.
 */

export const SESSION_MAX_MARKS = 9; // 6 mcq + 1 sata + open (2)
export const STUDY_MAX_MARKS = 29; // mcq + sata + open (4) + open (3), from the items

export interface BankFile {
  version: string;
  built?: string;
  sessionTests: Record<string, { title?: string; forms: Record<string, KnowledgeTestItem[]> }>;
  studyTests: Record<string, KnowledgeTestItem[]>;
}

export interface BankDefinition {
  scope: 'session' | 'study';
  sessionNo: number; // 0 for study forms
  form: 'A' | 'B' | 'C';
  version: string;
  title: string | null;
  items: KnowledgeTestItem[];
  maxMarks: number;
}

function check(
  name: string,
  items: KnowledgeTestItem[],
  expectedMax: number,
  expectedCount: number,
) {
  const errors: string[] = [];
  if (items.length !== expectedCount)
    errors.push(`${name}: ${items.length} items, expected ${expectedCount}`);
  items.forEach((it, i) => {
    if (it.slot !== i + 1) errors.push(`${name}: slot ${it.slot} at position ${i + 1}`);
    const keyed = (it.options ?? []).filter((o) => o.correct).length;
    if (it.type === 'mcq' && keyed !== 1)
      errors.push(`${name} slot ${it.slot}: mcq with ${keyed} keyed options`);
    if (it.type === 'sata' && (keyed !== 3 || it.options?.length !== 5))
      errors.push(`${name} slot ${it.slot}: sata with ${keyed} of ${it.options?.length} keyed`);
    if (it.type === 'open' && (!it.maxMarks || !it.rubric))
      errors.push(`${name} slot ${it.slot}: open without maxMarks/rubric`);
    if (!['mcq', 'sata', 'open'].includes(it.type))
      errors.push(`${name} slot ${it.slot}: unknown type ${it.type}`);
  });
  const max = maxMarksOf(items);
  if (max !== expectedMax) errors.push(`${name}: maxMarks ${max}, expected ${expectedMax}`);
  return { max, errors };
}

/** Bank → 16 session definitions (8 × A/B) + 3 study definitions (A/B/C). Throws on any design violation. */
export function bankDefinitions(bank: BankFile): BankDefinition[] {
  const out: BankDefinition[] = [];
  const errors: string[] = [];
  for (let n = 1; n <= 8; n++) {
    const s = bank.sessionTests[`s${n}`];
    if (!s) {
      errors.push(`session ${n} missing`);
      continue;
    }
    for (const form of ['A', 'B'] as const) {
      const items = s.forms[form];
      if (!items) {
        errors.push(`s${n}.${form} missing`);
        continue;
      }
      const { max, errors: e } = check(`s${n}.${form}`, items, SESSION_MAX_MARKS, 8);
      errors.push(...e);
      out.push({
        scope: 'session',
        sessionNo: n,
        form,
        version: bank.version,
        title: s.title ?? null,
        items,
        maxMarks: max,
      });
    }
  }
  for (const form of ['A', 'B', 'C'] as const) {
    const items = bank.studyTests[form];
    if (!items) {
      errors.push(`study.${form} missing`);
      continue;
    }
    const { max, errors: e } = check(`study.${form}`, items, STUDY_MAX_MARKS, 24);
    errors.push(...e);
    out.push({
      scope: 'study',
      sessionNo: 0,
      form,
      version: bank.version,
      title: null,
      items,
      maxMarks: max,
    });
  }
  if (errors.length)
    throw new Error(`Knowledge-test bank does not match its design:\n- ${errors.join('\n- ')}`);
  return out;
}

/** Key-order-independent JSON (Postgres jsonb does not keep object key order). */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(',')}}`;
}

export function itemsHash(items: unknown): string {
  return createHash('sha256').update(canonical(items)).digest('hex');
}
