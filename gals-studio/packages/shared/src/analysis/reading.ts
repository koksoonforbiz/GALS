/**
 * Reading exposure — derived from scrollHosts (inner lesson container) and
 * pdfCurrentPage/Total. NEVER from window scrollY: in the docked layout it is
 * pinned near 0 and is misleading.
 */

export interface ScrollHost {
  region?: string | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ReadingSnapshot {
  wallMs: number;
  pageUrl: string;
  scrollHosts: ScrollHost[] | null;
  pdfCurrentPage: number | null;
  pdfTotalPages: number | null;
  /** window scrollY — diagnostic only, never used for progress. */
  scrollY?: number;
}

export interface ContentReadingStats {
  pageUrl: string;
  /** furthest-reached progress 0..1 (skim-resistant). */
  pctRead: number;
  /** last-position progress 0..1. */
  lastPositionPct: number;
  maxScrollDepth: number;
  pagesVisited: number[];
  dwellSec: number;
  /** true when only window-scroll was available (low confidence). */
  windowScrollOnly: boolean;
}

const scrollTopPercent = (h: ScrollHost): number => {
  const denom = h.scrollHeight - h.clientHeight;
  if (denom <= 0) return 0;
  return Math.max(0, Math.min(1, h.scrollTop / denom));
};

const lessonHost = (hosts: ScrollHost[] | null): ScrollHost | null => {
  if (!hosts || hosts.length === 0) return null;
  return hosts.find((h) => h.region === 'lesson') ?? hosts[0];
};

/** Per-content-item reading exposure across the snapshot timeline. */
export function readingExposure(snapshots: ReadingSnapshot[]): ContentReadingStats[] {
  const byUrl = new Map<string, ReadingSnapshot[]>();
  for (const s of snapshots) {
    (byUrl.get(s.pageUrl) ?? byUrl.set(s.pageUrl, []).get(s.pageUrl)!).push(s);
  }
  const out: ContentReadingStats[] = [];
  for (const [pageUrl, snaps] of byUrl) {
    snaps.sort((a, b) => a.wallMs - b.wallMs);
    let maxDepth = 0;
    let last = 0;
    const pages = new Set<number>();
    let anyHost = false;
    let anyPdf = false;
    for (const s of snaps) {
      const host = lessonHost(s.scrollHosts);
      if (host) {
        anyHost = true;
        const pct = scrollTopPercent(host);
        maxDepth = Math.max(maxDepth, pct);
        last = pct;
      }
      if (s.pdfTotalPages && s.pdfCurrentPage != null) {
        anyPdf = true;
        pages.add(s.pdfCurrentPage);
      }
    }
    let pctRead = maxDepth;
    let lastPositionPct = last;
    if (anyPdf) {
      const total = snaps.find((s) => s.pdfTotalPages)?.pdfTotalPages ?? 0;
      if (total > 0) {
        pctRead = Math.max(pctRead, pages.size / total);
        const lastPage = snaps[snaps.length - 1].pdfCurrentPage ?? 0;
        lastPositionPct = Math.max(lastPositionPct, lastPage / total);
      }
    }
    const dwellSec =
      snaps.length > 1 ? (snaps[snaps.length - 1].wallMs - snaps[0].wallMs) / 1000 : 0;
    out.push({
      pageUrl,
      pctRead,
      lastPositionPct,
      maxScrollDepth: maxDepth,
      pagesVisited: [...pages].sort((a, b) => a - b),
      dwellSec,
      windowScrollOnly: !anyHost && !anyPdf,
    });
  }
  return out;
}
