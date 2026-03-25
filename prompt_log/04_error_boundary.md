# Prompt 04 — React ErrorBoundary with Logging

## Stack Context

- **Frontend**: Vite + React 18 SPA with React Router v6
- **Styling**: Tailwind CSS v4 + Lucide icons (no shadcn/ui — build custom UI)
- **No Next.js** — no server components, no `app/` directory
- All files go in `src/components/`
- API calls go to the NestJS backend — reuse the same fetch/axios pattern
  already used in the codebase to attach the JWT Bearer token

---

## Part A — `LoggingErrorBoundary` Component

Create `src/components/LoggingErrorBoundary.tsx`:

```typescript
// Must be a CLASS component — componentDidCatch cannot be used in function components

interface Props {
  sessionId: string;
  userId: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string | null;
}
```

**`static getDerivedStateFromError(error)`**:
Return `{ hasError: true, errorMessage: error.message }`

**`componentDidCatch(error, errorInfo)`**:
Fire-and-forget POST to `/logs/errors` (use `fetch` directly since hooks unavailable):

```json
{
  "sessionId": "...",
  "userId": "...",
  "errorMessage": "error.message",
  "stack": "error.stack (first 2000 chars)",
  "componentName": "errorInfo.componentStack (first 500 chars)",
  "pageUrl": "window.location.pathname",
  "timestamp": "Date.now()",
  "errorType": "react_boundary"
}
```

Attach the JWT token from localStorage/memory using the same method as the rest of the codebase.

**Render when `hasError === true`** (custom Tailwind UI — no shadcn):

```tsx
<div className="flex flex-col items-center justify-center min-h-[400px] p-8 text-center">
  <div className="mb-4 text-red-500">
    <AlertCircle size={48} /> {/* from lucide-react */}
  </div>
  <h2 className="text-xl font-semibold text-gray-800 mb-2">Something went wrong</h2>
  <p className="text-gray-500 mb-6">
    Your session data has been saved. You can reload to continue.
  </p>
  <button
    onClick={() => window.location.reload()}
    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
  >
    Reload Page
  </button>
</div>
```

If a custom `fallback` prop is provided, render that instead of the default UI.

**Render when `hasError === false`**: render `children` normally.

---

## Part B — `withLoggingErrorBoundary` HOC

```typescript
// src/components/withLoggingErrorBoundary.tsx

function withLoggingErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  sessionId: string,
  userId: string,
): React.ComponentType<P>;
```

Wraps the given component in `<LoggingErrorBoundary sessionId={sessionId} userId={userId}>`.

---

## Part C — `LoggingProvider` Wrapper Component

Create `src/components/LoggingProvider.tsx` as a single entry point for all logging:

```tsx
'use client'; // NOT needed — this is Vite/React, just a normal component

interface LoggingProviderProps {
  sessionId: string;
  userId: string;
  children: React.ReactNode;
}

export function LoggingProvider({ sessionId, userId, children }: LoggingProviderProps) {
  // 1. Call useInteractionLogger (from Prompt 03)
  useInteractionLogger({ sessionId, userId });

  // 2. Wrap children in LoggingErrorBoundary
  return (
    <LoggingErrorBoundary sessionId={sessionId} userId={userId}>
      {children}
    </LoggingErrorBoundary>
  );
}
```

---

## Part D — Integration in App Root

In `src/App.tsx` (or wherever the authenticated shell/layout is rendered):

- Import `LoggingProvider`
- Wrap the authenticated content with:
  ```tsx
  <LoggingProvider sessionId={sessionId} userId={userId}>
    {/* existing routes / outlet */}
  </LoggingProvider>
  ```
- Obtain `sessionId` and `userId` from the existing auth context
  (check how other components access the JWT-decoded user — e.g., `useAuth()` hook
  or a React context — and use the same approach)
- Only render `LoggingProvider` when the user is authenticated; do not wrap
  the login/register pages
