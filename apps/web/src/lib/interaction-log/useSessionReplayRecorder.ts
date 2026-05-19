import { useCallback, useEffect, useRef } from 'react';
import { api } from '../api';

const API_BASE = '/api';
const FLUSH_INTERVAL_MS = 10_000;
const PERIODIC_SNAPSHOT_MS = 1_000;
const MAX_HTML_CHARS = 250_000;
const MAX_BATCH_BYTES = 700_000;

interface UseSessionReplayRecorderParams {
  sessionId: string;
  userId: string;
  enabled?: boolean;
}

interface ReplaySnapshotPayload {
  pageUrl: string;
  html: string;
  screenshotDataUrl?: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  capturedAt: number;
  trigger: string;
}

function sendKeepalive(body: object) {
  try {
    const token = localStorage.getItem('token');
    fetch(`${API_BASE}/logs/replay-snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore unload failures
  }
}

function splitIntoSizedChunks(
  sessionId: string,
  userId: string,
  events: ReplaySnapshotPayload[],
): ReplaySnapshotPayload[][] {
  const chunks: ReplaySnapshotPayload[][] = [];
  let currentChunk: ReplaySnapshotPayload[] = [];

  for (const event of events) {
    const candidateChunk = [...currentChunk, event];
    const candidateSize = JSON.stringify({
      sessionId,
      userId,
      events: candidateChunk,
    }).length;

    if (currentChunk.length > 0 && candidateSize > MAX_BATCH_BYTES) {
      chunks.push(currentChunk);
      currentChunk = [event];
    } else {
      currentChunk = candidateChunk;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function syncInputState(sourceRoot: ParentNode, cloneRoot: ParentNode) {
  const inputs = Array.from(sourceRoot.querySelectorAll('input'));
  const cloneInputs = Array.from(cloneRoot.querySelectorAll('input'));
  inputs.forEach((input, index) => {
    const clone = cloneInputs[index];
    if (!clone) return;

    if (input.type === 'password' || input.autocomplete.includes('password')) {
      clone.setAttribute('value', '[REDACTED]');
    } else if (input.type !== 'file') {
      clone.setAttribute('value', input.value);
    } else {
      clone.removeAttribute('value');
      clone.setAttribute('data-selected-files', String(input.files?.length ?? 0));
    }

    if (input.checked) clone.setAttribute('checked', 'checked');
    else clone.removeAttribute('checked');
  });

  const textareas = Array.from(sourceRoot.querySelectorAll('textarea'));
  const cloneTextareas = Array.from(cloneRoot.querySelectorAll('textarea'));
  textareas.forEach((textarea, index) => {
    const clone = cloneTextareas[index];
    if (!clone) return;
    clone.textContent = textarea.value;
  });

  const selects = Array.from(sourceRoot.querySelectorAll('select'));
  const cloneSelects = Array.from(cloneRoot.querySelectorAll('select'));
  selects.forEach((select, index) => {
    const clone = cloneSelects[index];
    if (!clone) return;
    Array.from(clone.options).forEach((option, optionIndex) => {
      option.selected = select.options[optionIndex]?.selected ?? false;
    });
  });
}

function serializeDocument(): string {
  const clone = document.documentElement.cloneNode(true) as HTMLHtmlElement;
  syncInputState(document, clone);

  clone.querySelectorAll('script').forEach((node) => node.remove());
  clone.querySelectorAll('noscript').forEach((node) => node.remove());

  let head = clone.querySelector('head');
  if (!head) {
    head = document.createElement('head');
    clone.insertBefore(head, clone.firstChild);
  }
  if (!head.querySelector('base')) {
    const base = document.createElement('base');
    base.setAttribute('href', window.location.origin);
    head.prepend(base);
  }

  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
    html, body { pointer-events: none !important; }
  `;
  head.appendChild(style);

  const html = `<!DOCTYPE html>\n${clone.outerHTML}`;
  return html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
}

export function useSessionReplayRecorder({
  sessionId,
  userId,
  enabled = true,
}: UseSessionReplayRecorderParams) {
  const bufferRef = useRef<ReplaySnapshotPayload[]>([]);
  const lastSerializedRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setInterval>>();
  const periodicTimerRef = useRef<ReturnType<typeof setInterval>>();
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const flush = useCallback(
    async (useKeepalive = false) => {
      if (bufferRef.current.length === 0) return;
      const events = bufferRef.current.splice(0);
      const chunks = splitIntoSizedChunks(sessionId, userId, events);

      if (useKeepalive) {
        chunks.forEach((chunk) => {
          sendKeepalive({ sessionId, userId, events: chunk });
        });
        return;
      }

      try {
        for (const chunk of chunks) {
          await api.post('/logs/replay-snapshots', {
            sessionId,
            userId,
            events: chunk,
          });
        }
      } catch {
        bufferRef.current.unshift(...events);
      }
    },
    [sessionId, userId],
  );

  const captureScreenshot = useCallback((): string | undefined => {
    const video = screenVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return undefined;

    const width = Math.max(1, Math.floor(video.videoWidth || window.innerWidth));
    const height = Math.max(1, Math.floor(video.videoHeight || window.innerHeight));
    let canvas = screenCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      screenCanvasRef.current = canvas;
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }, []);

  const captureSnapshot = useCallback((trigger: string) => {
    const html = serializeDocument();
    if (trigger !== 'periodic' && html === lastSerializedRef.current) return;

    lastSerializedRef.current = html;
    bufferRef.current.push({
      pageUrl: window.location.pathname + window.location.search + window.location.hash,
      html,
      screenshotDataUrl: captureScreenshot(),
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      capturedAt: Date.now(),
      trigger,
    });
  }, [captureScreenshot]);

  useEffect(() => {
    if (!enabled || !sessionId || !userId) return;

    const initScreenCapture = async () => {
      if (!navigator.mediaDevices?.getDisplayMedia) return;
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: false,
        });
        screenStreamRef.current = stream;
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        screenVideoRef.current = video;
      } catch {
        // Permission denied or capture unavailable; fallback to DOM-only replay.
      }
    };

    void initScreenCapture().finally(() => {
      captureSnapshot('initial');
    });
    const onPageHide = () => {
      captureSnapshot('pagehide');
      flush(true);
    };
    const onBeforeUnload = () => {
      captureSnapshot('beforeunload');
      flush(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        captureSnapshot('hidden');
        flush(true);
      }
    };
    const onRouteChange = () => captureSnapshot('route');

    const originalPushState = window.history.pushState.bind(window.history) as History['pushState'];
    const originalReplaceState = window.history.replaceState.bind(
      window.history,
    ) as History['replaceState'];
    window.history.pushState = ((...args: Parameters<History['pushState']>) => {
      const result = originalPushState(...args);
      window.dispatchEvent(new Event('ats:route-change'));
      return result;
    }) as History['pushState'];
    window.history.replaceState = ((...args: Parameters<History['replaceState']>) => {
      const result = originalReplaceState(...args);
      window.dispatchEvent(new Event('ats:route-change'));
      return result;
    }) as History['replaceState'];

    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('ats:route-change', onRouteChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);

    flushTimerRef.current = setInterval(() => {
      void flush(false);
    }, FLUSH_INTERVAL_MS);
    periodicTimerRef.current = setInterval(() => {
      captureSnapshot('periodic');
    }, PERIODIC_SNAPSHOT_MS);

    return () => {
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('hashchange', onRouteChange);
      window.removeEventListener('ats:route-change', onRouteChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      clearInterval(flushTimerRef.current);
      clearInterval(periodicTimerRef.current);
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
      screenVideoRef.current = null;
      screenCanvasRef.current = null;
      captureSnapshot('cleanup');
      void flush(false);
    };
  }, [captureSnapshot, enabled, flush, sessionId, userId]);
}
