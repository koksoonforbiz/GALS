import library from '../config/library.v2.json';
import type { Params } from './types';

/**
 * Parameter defaults come from the workbook's Parameters sheet via the
 * generated library.v2.json (analysis/process_mining/export_library.py).
 * Researchers recalibrate by adding a LearningEventParameterSet version that
 * overrides any subset of these keys (values in ms / counts / ratios).
 */
type LibParam = { kind: string; value?: number; minSeconds?: number; wordsPerSecond?: number };
const P = library.parameters as Record<string, LibParam>;

function ms(name: string): number {
  const p = P[name];
  if (!p || p.kind !== 'ms' || typeof p.value !== 'number')
    throw new Error(`library.v2.json: ${name} must be an ms parameter`);
  return p.value;
}
function n(name: string): number {
  const p = P[name];
  if (!p || p.kind !== 'number' || typeof p.value !== 'number')
    throw new Error(`library.v2.json: ${name} must be numeric`);
  return p.value;
}

export const LIBRARY_VERSION = library.libraryVersion;

export function defaultParams(): Params {
  const tOut = P.T_out!;
  return {
    T_read: ms('T_read'),
    T_orient: ms('T_orient'),
    T_out: { minSeconds: tOut.minSeconds ?? 5, wordsPerSecond: tOut.wordsPerSecond ?? 4 },
    T_idle: ms('T_idle'),
    T_rapid: ms('T_rapid'),
    eps_chars: n('ε_chars'),
    W_seq: ms('W_seq'),
    W_plan: ms('W_plan'),
    W_mon: ms('W_mon'),
    W_recover: ms('W_recover'),
    N_fail: n('N_fail'),
    E_edit: n('E_edit'),
  };
}

const KEYS = Object.keys(defaultParams()) as Array<keyof Params>;

/** Defaults overlaid with a stored set's values; unknown keys are ignored. */
export function resolveParams(overrides: unknown): Params {
  const base = defaultParams();
  if (!overrides || typeof overrides !== 'object') return base;
  const o = overrides as Record<string, unknown>;
  for (const k of KEYS) {
    const v = o[k];
    if (k === 'T_out') {
      if (v && typeof v === 'object') base.T_out = { ...base.T_out, ...(v as Params['T_out']) };
    } else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
      (base[k] as number) = v;
    }
  }
  return base;
}
