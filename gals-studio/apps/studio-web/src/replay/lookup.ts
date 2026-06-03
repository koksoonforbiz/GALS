/** Snapshot + webcam-segment lookups and an in-place max (no spread over 65k+). */

export interface SnapshotLite {
  id: string;
  wallMs: number;
  trigger: string;
  pageUrl: string;
  width: number;
  height: number;
  pdfCurrentPage: number | null;
  pdfTotalPages: number | null;
  aois: { region: string; x: number; y: number; width: number; height: number }[];
  scrollHosts: { region?: string | null; scrollTop: number; scrollHeight: number; clientHeight: number }[];
  hasScreenshot: boolean;
}

export interface WebcamSeg {
  segmentId: string;
  startWallMs: number;
  endWallMs: number | null;
  status: string;
  url: string | null;
}

/** Last item with wallMs <= absoluteMs (binary search over the sorted index). */
export function snapshotAt(snaps: SnapshotLite[], absoluteMs: number): SnapshotLite | null {
  if (snaps.length === 0) return null;
  let lo = 0;
  let hi = snaps.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (snaps[mid].wallMs <= absoluteMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans >= 0 ? snaps[ans] : null;
}

export function segmentAt(segs: WebcamSeg[], absoluteMs: number): WebcamSeg | null {
  for (const seg of segs) {
    if (seg.status !== 'ok' || !seg.url) continue;
    const end = seg.endWallMs ?? Infinity;
    if (absoluteMs >= seg.startWallMs && absoluteMs <= end) return seg;
  }
  return null;
}

/** Nearest sample to absoluteMs by wallMs (linear pointer maintained by caller). */
export function nearestByWall<T extends { wallMs: number }>(arr: T[], absoluteMs: number): T | null {
  if (arr.length === 0) return null;
  let lo = 0;
  let hi = arr.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].wallMs <= absoluteMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // pick closer of ans / ans+1
  const a = arr[ans];
  const b = arr[Math.min(ans + 1, arr.length - 1)];
  return Math.abs(a.wallMs - absoluteMs) <= Math.abs(b.wallMs - absoluteMs) ? a : b;
}

/** In-place max walk (avoids Math.max(...arr) stack overflow on 65k+ samples). */
export function maxWall<T extends { wallMs: number }>(arr: T[]): number {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i].wallMs > m) m = arr[i].wallMs;
  return m;
}
