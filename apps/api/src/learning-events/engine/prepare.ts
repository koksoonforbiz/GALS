import type { RawAction } from './types';

/**
 * De-duplicate and order a session's raw actions.
 *
 * The browser activity logger can POST the same buffered events twice
 * (unload flush without clearing the buffer — PHASE0_DISCOVERY.md §2 #2,
 * observed in practice), each copy with a fresh row id. Copies are
 * identical in action, client time and metadata (including the per-load
 * `seq` that lesson events carry), so that triple is the identity; the
 * first row id wins.
 *
 * Order: client time, then `seq` (exit/enter pairs share a millisecond),
 * then row id for stability.
 */
export function prepareActions(rows: RawAction[]): { actions: RawAction[]; duplicates: number } {
  const seen = new Set<string>();
  const out: RawAction[] = [];
  for (const r of rows) {
    const key = `${r.action}|${r.at}|${stableStringify(r.meta)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort((a, b) => a.at - b.at || seqOf(a) - seqOf(b) || a.id.localeCompare(b.id));
  return { actions: out, duplicates: rows.length - out.length };
}

function seqOf(a: RawAction): number {
  const s = a.meta.seq;
  return typeof s === 'number' ? s : 0;
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}
