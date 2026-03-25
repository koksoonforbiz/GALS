# Prompt 03 — React Hook: `useInteractionLogger`

## Stack Context

- **Frontend**: Vite + React 18 SPA with React Router v6
- **Styling**: Tailwind CSS v4 + Lucide icons (no shadcn/ui)
- **No Next.js** — no `app/` directory, no server components, no App Router
- All frontend code lives in `src/`
- API calls go to the **NestJS backend** (check the existing base URL config/env var)
- Auth token is stored in memory or localStorage — check existing API call patterns
  in the codebase to find how the JWT Bearer token is attached to requests,
  and use the same method here

## Task

Create `src/hooks/useInteractionLogger.ts` with the full implementation below.

---

## Hook Signature

```typescript
function useInteractionLogger(params: {
  sessionId: string;
  userId: string;
  enabled?: boolean; // default true — set false to disable all tracking
}): {
  flushAll: () => Promise<void>;
};
```

---

## Initialisation (on mount)

1. Capture `wallClockMs = Date.now()` and `monotonicMs = Math.round(performance.now())`
2. POST to `/logs/sync-anchor`:
   ```json
   { "sessionId", "userId", "wallClockMs", "monotonicMs",
     "timezone": Intl.DateTimeFormat().resolvedOptions().timeZone,
     "userAgent": navigator.userAgent }
   ```
3. Capture initial viewport → POST to `/logs/viewport`
4. Set up `PerformanceObserver` for `'navigation'` entries → POST once to `/logs/performance`

---

## API Call Helper

Use the same fetch wrapper / axios instance / API client already used in the codebase
to attach the JWT Bearer token. Do not hardcode fetch — find and reuse the existing
`api` or `httpClient` utility. Fall back to:

```typescript
const post = (path: string, body: object) =>
  fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`, // use existing token getter
    },
    body: JSON.stringify(body),
  });
```

For unload flushes, use `navigator.sendBeacon` with a `Blob`:

```typescript
navigator.sendBeacon(url, new Blob([JSON.stringify(body)], { type: 'application/json' }));
```

---

## Collector 1 — Cursor Movement

- Listen: `window.mousemove`, throttled to **one event per 100ms**
- Capture: `{ x: e.clientX, y: e.clientY, pageUrl: window.location.pathname, elementTarget: buildElementTarget(e.target), timestamp: Date.now() }`
- `buildElementTarget(el)`: `tagName + '#' + id` if id present, else `tagName + '.' + firstClassName`
- Buffer in `useRef` → flush every 30s to `POST /logs/cursor`

## Collector 2 — Click Tracker

- Listen: `window.addEventListener('click', handler, true)` (capture phase)
- Capture: `{ x: e.clientX, y: e.clientY, pageUrl: window.location.pathname, elementSelector: buildCssSelector(e.target), elementText: (e.target.innerText || '').slice(0, 50), timestamp: Date.now() }`
- `buildCssSelector(el)`: short selector from tagName + id or first className, max 80 chars
- Buffer → flush every 30s to `POST /logs/clicks`

## Collector 3 — Scroll Tracker

- Listen: `window.scroll`, throttled to **one event per 200ms**
- Capture: `{ scrollY: window.scrollY, scrollPercent: computeScrollPercent(), pageUrl: window.location.pathname, timestamp: Date.now() }`
- `computeScrollPercent()`: `(scrollY / Math.max(1, document.body.scrollHeight - window.innerHeight)) * 100` clamped 0–100
- Buffer → flush every 30s to `POST /logs/scroll`

## Collector 4 — Keystroke Metrics (privacy-safe, aggregate only)

- Event delegation: one `keydown` listener on `document`, fires only when `e.target` is `INPUT` or `TEXTAREA`
- Per field: track keystroke count and inter-keystroke gaps
- On field `blur`: compute and emit `{ fieldId: el.id || el.name || generateStableId(el), keystrokeCount, pauseDurationMs: longestGap, typingSpeedWPM: estimatedWPM, timestamp: Date.now() }`
- **Never capture actual key values** — counts and timings only
- Buffer → flush every 30s to `POST /logs/keystrokes`

## Collector 5 — Page Visibility

- Listen: `document.visibilitychange`
- On `hidden`: store `hiddenAt = Date.now()`
- Emit immediately (not batched):
  - `visible` event: `{ visibleState: 'visible', hiddenDurationMs: Date.now() - hiddenAt, pageUrl, timestamp: Date.now() }`
  - `hidden` event: `{ visibleState: 'hidden', hiddenDurationMs: null, pageUrl, timestamp: Date.now() }`
- POST immediately to `POST /logs/visibility` (these are sparse, no need to batch)

## Collector 6 — Clipboard Tracker

- Listen: `window copy`, `window cut`, `window paste`
- Capture: `{ action: 'copy'|'cut'|'paste', textLength, sourceElement: buildElementTarget(e.target), pageUrl, timestamp: Date.now() }`
  - copy/cut: `textLength = window.getSelection()?.toString().length ?? 0`
  - paste: `textLength = e.clipboardData?.getData('text').length ?? 0`
- POST immediately to `POST /logs/clipboard`

## Collector 7 — Viewport / Resize

- Listen: `window resize` and `window orientationchange`, debounced 500ms
- Capture: `{ width: window.innerWidth, height: window.innerHeight, orientation: screen.orientation?.type ?? 'unknown', timestamp: Date.now() }`
- POST immediately to `POST /logs/viewport`

## Collector 8 — Performance

- On mount: `PerformanceObserver` observing `'navigation'`
- Capture: `{ pageUrl: window.location.pathname, pageLoadMs: Math.round(entry.loadEventEnd - entry.startTime), resourceTimingsJson: getTop10Resources(), timestamp: Date.now() }`
- `getTop10Resources()`: top 10 resources by duration from `performance.getEntriesByType('resource')`
- POST once to `POST /logs/performance`

## Collector 9 — Error Tracker

- `window.onerror = (msg, src, line, col, err) =>` POST to `/logs/errors` with `errorType: 'window_error'`
- `window.onunhandledrejection = (e) =>` POST to `/logs/errors` with `errorType: 'unhandled_rejection'`
- POST immediately (no batching)

---

## Flush Strategy

- All batched collectors (cursor, clicks, scroll, keystrokes): flush every **30 seconds** via `setInterval`
- On `window.beforeunload`: call `flushAll()` using `navigator.sendBeacon` for each non-empty buffer
- Export `flushAll()` from the hook for use before React Router v6 navigation transitions

---

## Implementation Rules

- Use `useRef` for all event buffers — **not** `useState` (avoids re-renders)
- Use `useRef` for throttle/debounce timers
- Every `useEffect` must return a cleanup that removes event listeners and clears intervals
- Guard all `window`/`document` access — this is a SPA but be defensive
- If `enabled === false`, skip all setup and return a no-op `flushAll`

---

## Integration

In `src/App.tsx` or the top-level authenticated layout component, call:

```tsx
const { flushAll } = useInteractionLogger({ sessionId, userId });
```

Obtain `sessionId` and `userId` from whatever auth context / JWT decode already
exists in the codebase — check how other components access the current user.
