import { createHash } from 'crypto';
import libraryV2 from '../config/library.v2.json';
import libraryV21 from '../config/library.v2_1.json';
import type { LibraryVersion, Params } from './types';

/**
 * Parameter defaults come from the workbook's Parameters sheet via the
 * generated library JSON (analysis/process_mining/export_library.py).
 * Researchers recalibrate by adding a LearningEventParameterSet version that
 * overrides any subset of these keys (values in ms / counts / ratios).
 *
 * Two libraries are kept runnable (Prompt B, P4; PI decision 8): v2 (the
 * workbook as first implemented) and v2.1 (v2 + the approved rule changes,
 * listed in library.v2_1.json `changes`). New parses use CURRENT_LIBRARY;
 * results of the other stay stored for comparison.
 */
type LibParam = { kind: string; value?: number; minSeconds?: number; wordsPerSecond?: number };

export interface Library {
  libraryVersion: string;
  rules: Array<{
    id: string;
    family?: string;
    parameters?: string[];
    evidenceClass?: string;
    inputs?: string;
  }>;
  parameters: Record<string, LibParam>;
}

export const LIBRARIES: Record<LibraryVersion, Library> = {
  v2: libraryV2 as unknown as Library,
  'v2.1': libraryV21 as unknown as Library,
};

/** The library new parses use. */
export const CURRENT_LIBRARY: LibraryVersion = 'v2.1';

/** Kept for callers that report "the" library version: the current one. */
export const LIBRARY_VERSION = LIBRARIES[CURRENT_LIBRARY].libraryVersion;

/** sha256 of a library's content, stored with every detection (CAP-62). */
export const LIBRARY_HASH: Record<LibraryVersion, string> = {
  v2: sha256(JSON.stringify(libraryV2)),
  'v2.1': sha256(JSON.stringify(libraryV21)),
};

/**
 * Engine version: bump when rule code changes behaviour for an existing
 * library version. Stored with the git build (APP_BUILD) on each detection.
 */
export const ENGINE_VERSION = 'engine-2026-11-26';

export function engineVersion(): string {
  return `${ENGINE_VERSION}+${process.env.APP_BUILD || 'dev'}`;
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function lib(v: LibraryVersion) {
  const P = LIBRARIES[v].parameters;
  const ms = (name: string, fallback?: number): number => {
    const p = P[name];
    if (!p && fallback !== undefined) return fallback;
    if (!p || p.kind !== 'ms' || typeof p.value !== 'number')
      throw new Error(`library ${v}: ${name} must be an ms parameter`);
    return p.value;
  };
  const n = (name: string): number => {
    const p = P[name];
    if (!p || p.kind !== 'number' || typeof p.value !== 'number')
      throw new Error(`library ${v}: ${name} must be numeric`);
    return p.value;
  };
  return { P, ms, n };
}

export function defaultParams(version: LibraryVersion = 'v2'): Params {
  const { P, ms, n } = lib(version);
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
    // v2 has no break threshold: M20 and M25 both use T_idle there.
    T_break: ms('T_break', 300_000),
  };
}

const KEYS = Object.keys(defaultParams()) as Array<keyof Params>;

/** Defaults overlaid with a stored set's values; unknown keys are ignored. */
export function resolveParams(overrides: unknown, version: LibraryVersion = 'v2'): Params {
  const base = defaultParams(version);
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

/** Engine parameter names used by each rule (library `parameters`, mapped to Params keys). */
export function ruleParameters(version: LibraryVersion): Map<string, Array<keyof Params>> {
  const map = new Map<string, Array<keyof Params>>();
  for (const r of LIBRARIES[version].rules) {
    const keys = (r.parameters ?? [])
      .map((p) => (p === 'ε_chars' ? 'eps_chars' : p))
      .filter((p): p is keyof Params => (KEYS as string[]).includes(p));
    map.set(r.id, keys);
  }
  return map;
}
