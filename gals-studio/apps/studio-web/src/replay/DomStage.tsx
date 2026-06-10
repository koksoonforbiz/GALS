import { useEffect, useRef, useState } from 'react';
import type { SnapshotLite } from './lookup';

const AOI_COLORS: Record<string, string> = {
  header: '#64748b',
  sidebar: '#0ea5e9',
  lesson: '#16a34a',
  'pdf-viewer': '#f59e0b',
  chatbot: '#8b5cf6',
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
  /** Lock the surface: no scroll/click, so it only ever shows the student's view. */
  locked?: boolean;
  /** Extra absolutely-positioned overlays (e.g. researcher AOI rects / draw layer). */
  overlay?: React.ReactNode;
}) {
  const { sessionId, snapshot, gaze, lastClick, aoiVisible, showScreenshot, locked, overlay } =
    props;
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
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-lg border border-slate-200 bg-white"
      style={{ height: scaledH || 400 }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          width: snapshot.width,
          height: snapshot.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <div style={{ pointerEvents: locked ? 'none' : 'auto' }}>
          {showScreenshot ? (
            <Screenshot
              url={
                snapshot.hasScreenshot
                  ? `/api/media/snapshot/${sessionId}/${snapshot.id}.jpg`
                  : null
              }
              width={snapshot.width}
              height={snapshot.height}
            />
          ) : (
            <DomFrame
              url={`/api/media/snapshot/${sessionId}/${snapshot.id}.html`}
              width={snapshot.width}
              height={snapshot.height}
              scroll={snapshot.scrollHosts as ScrollHost[]}
            />
          )}
        </div>

        {/* researcher overlay (AOI draw layer / rects) */}
        {overlay}

        {/* AOI overlays */}
        {snapshot.aois.map((a, i) =>
          aoiVisible[a.region] === false ? null : (
            <div
              key={i}
              className="pointer-events-none absolute"
              style={{
                left: a.x,
                top: a.y,
                width: a.width,
                height: a.height,
                border: `2px solid ${AOI_COLORS[a.region] ?? '#475569'}`,
                background: (AOI_COLORS[a.region] ?? '#475569') + '11',
              }}
            >
              <span
                className="absolute left-0 top-0 px-1 text-[10px] font-semibold"
                style={{ color: AOI_COLORS[a.region] ?? '#475569' }}
              >
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
              left: lastClick.x - 14,
              top: lastClick.y - 14,
              width: 28,
              height: 28,
              opacity: Math.max(0, 1 - lastClick.ageMs / 2000),
            }}
          />
        )}

        {/* gaze marker */}
        {gaze && (
          <div
            className="pointer-events-none absolute rounded-full"
            style={{
              left: gaze.x - 8,
              top: gaze.y - 8,
              width: 16,
              height: 16,
              background: 'rgba(6,182,212,0.6)',
              boxShadow: '0 0 8px rgba(6,182,212,0.8)',
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Double-buffered screenshot: only swap the visible frame once the next image
 * has finished decoding, and keep showing the last good frame when a snapshot
 * has no screenshot. Eliminates the white flash on every snapshot change.
 */
function Screenshot({ url, width, height }: { url: string | null; width: number; height: number }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return; // no screenshot for this moment — hold the last frame
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setShown(url);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!shown)
    return (
      <div className="flex h-full items-center justify-center text-slate-400">Loading frame…</div>
    );
  return <img src={shown} alt="snapshot" style={{ width, height }} />;
}

interface ScrollHost {
  region?: string | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Restore the student's inner-scroll positions. The recorder tags scroll
 * containers with `data-replay-region`, so we can match each captured host to
 * its element and scroll it — this is what makes the PDF/lesson show the page
 * the student was actually reading (react-pdf renders pages stacked in a
 * scroller; the visible page is purely a function of scrollTop).
 */
function applyScroll(iframe: HTMLIFrameElement | null, hosts?: ScrollHost[]): void {
  if (!iframe || !hosts?.length) return;
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    for (const h of hosts) {
      if (!h.region) continue;
      const el = doc.querySelector<HTMLElement>(`[data-replay-region="${h.region}"]`);
      if (el) el.scrollTop = h.scrollTop;
    }
  } catch {
    /* cross-origin or not ready — never block */
  }
}

/**
 * Double-buffered DOM iframe: load the incoming snapshot into a hidden iframe
 * and cross-fade only after it fires `load`, so the surface never blanks while
 * the next document parses. On load we also restore the student's scroll
 * positions so the correct PDF/lesson page is shown.
 */
function DomFrame({
  url,
  width,
  height,
  scroll,
}: {
  url: string;
  width: number;
  height: number;
  scroll?: ScrollHost[];
}) {
  const [slots, setSlots] = useState<[string, string]>([url, 'about:blank']);
  const [visible, setVisible] = useState(0);
  const target = useRef(url);
  useEffect(() => {
    if (url === target.current) return;
    target.current = url;
    const hidden = visible === 0 ? 1 : 0;
    setSlots((s) => (hidden === 0 ? [url, s[1]] : [s[0], url]));
  }, [url, visible]);
  return (
    <div style={{ width, height, position: 'relative' }}>
      {slots.map((src, i) => (
        <iframe
          key={i}
          title="dom-replay"
          sandbox="allow-same-origin"
          src={src}
          onLoad={(e) => {
            applyScroll(e.currentTarget, scroll);
            if (src === target.current && i !== visible) setVisible(i);
          }}
          style={{
            position: 'absolute',
            inset: 0,
            width,
            height,
            border: 'none',
            opacity: i === visible ? 1 : 0,
            transition: 'opacity 120ms',
          }}
        />
      ))}
    </div>
  );
}

export { AOI_COLORS };
