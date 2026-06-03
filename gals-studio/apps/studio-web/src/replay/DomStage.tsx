import { useEffect, useRef, useState } from 'react';
import type { SnapshotLite } from './lookup';

const AOI_COLORS: Record<string, string> = {
  header: '#64748b', sidebar: '#0ea5e9', lesson: '#16a34a', 'pdf-viewer': '#f59e0b', chatbot: '#8b5cf6',
};

/**
 * DOM replay surface: an iframe loading the snapshot HTML, scaled to fit, with
 * absolutely-positioned overlays (gaze dot, click ring, AOI rects) that track
 * the same scale transform. All effects are defensively wrapped — a render
 * failure must never blank the viewer.
 */
export function DomStage(props: {
  sessionId: string;
  snapshot: SnapshotLite | null;
  gaze: { x: number; y: number } | null;
  lastClick: { x: number; y: number; ageMs: number } | null;
  aoiVisible: Record<string, boolean>;
  showScreenshot: boolean;
}) {
  const { sessionId, snapshot, gaze, lastClick, aoiVisible, showScreenshot } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (!wrapRef.current || !snapshot) return;
    const ro = new ResizeObserver(() => {
      try {
        const w = wrapRef.current?.clientWidth ?? 0;
        if (w && snapshot.width) setScale(w / snapshot.width);
      } catch {
        /* never block */
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [snapshot?.width, snapshot?.id]);

  if (!snapshot) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400">
        No DOM snapshot at this moment
      </div>
    );
  }

  const scaledH = snapshot.height * scale;

  return (
    <div ref={wrapRef} className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-white" style={{ height: scaledH || 400 }}>
      <div
        className="absolute left-0 top-0"
        style={{ width: snapshot.width, height: snapshot.height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {showScreenshot && snapshot.hasScreenshot ? (
          <img
            src={`/api/media/snapshot/${sessionId}/${snapshot.id}.jpg`}
            alt="snapshot"
            style={{ width: snapshot.width, height: snapshot.height }}
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        ) : showScreenshot ? (
          <div className="flex h-full items-center justify-center text-slate-400">No pixel snapshot available</div>
        ) : (
          <iframe
            key={snapshot.id}
            title="dom-replay"
            sandbox="allow-same-origin"
            src={`/api/media/snapshot/${sessionId}/${snapshot.id}.html`}
            style={{ width: snapshot.width, height: snapshot.height, border: 'none' }}
          />
        )}

        {/* AOI overlays */}
        {snapshot.aois.map((a, i) =>
          aoiVisible[a.region] === false ? null : (
            <div
              key={i}
              className="pointer-events-none absolute"
              style={{
                left: a.x, top: a.y, width: a.width, height: a.height,
                border: `2px solid ${AOI_COLORS[a.region] ?? '#475569'}`,
                background: (AOI_COLORS[a.region] ?? '#475569') + '11',
              }}
            >
              <span className="absolute left-0 top-0 px-1 text-[10px] font-semibold" style={{ color: AOI_COLORS[a.region] ?? '#475569' }}>
                {a.region}
              </span>
            </div>
          ),
        )}

        {/* click ring (fades with age) */}
        {lastClick && (
          <div
            className="pointer-events-none absolute rounded-full border-2 border-amber-500"
            style={{
              left: lastClick.x - 14, top: lastClick.y - 14, width: 28, height: 28,
              opacity: Math.max(0, 1 - lastClick.ageMs / 2000),
            }}
          />
        )}

        {/* gaze marker */}
        {gaze && (
          <div
            className="pointer-events-none absolute rounded-full"
            style={{ left: gaze.x - 8, top: gaze.y - 8, width: 16, height: 16, background: 'rgba(6,182,212,0.6)', boxShadow: '0 0 8px rgba(6,182,212,0.8)' }}
          />
        )}
      </div>
    </div>
  );
}

export { AOI_COLORS };
