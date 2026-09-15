const API_BASE = '/api';

/** Background biometric paths that should NOT trigger a login redirect on 401. */
const BACKGROUND_PATHS = [
  '/pupil-size/logs',
  '/webgazer/logs',
  '/webgazer/calibration',
  '/recording/segments/',
  '/logs/',
];

// Auth-flow endpoints where a 401 means "wrong password/code", not "your
// session expired" — some of these run before any token exists at all
// (login, 2FA verify/resend), so there's no session to have expired. The
// global redirect below would otherwise hard-navigate to /login mid-flow
// (e.g. after a wrong 2FA/TOTP-setup code, or the wrong current password
// on the change-password form), wiping the in-progress step before the
// caller's own catch block can show an inline error and let the user
// retry. Every /auth/2fa/* route (email-OTP and TOTP alike),
// /auth/login, and /auth/change-password (its 401 means "current
// password is wrong," from an otherwise still-valid session) fall into
// this bucket — the caller handles the 401 instead of the global redirect.
function skipsAuthRedirect(path: string): boolean {
  return (
    BACKGROUND_PATHS.some((p) => path.startsWith(p)) ||
    path === '/auth/login' ||
    path === '/auth/change-password' ||
    path.startsWith('/auth/2fa/')
  );
}

// CompressionStream landed in Chrome 80, Firefox 113, Safari 16.4 — decent
// coverage, but feature-detected with a plain-JSON fallback for anything
// older rather than assumed.
const supportsGzipCompression = typeof CompressionStream !== 'undefined';

async function gzipJson(data: unknown): Promise<Blob> {
  const json = JSON.stringify(data);
  const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public errors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// The backend's GlobalExceptionFilter (apps/api/src/common/http-
// exception.filter.ts) types its `message` field as `string | string[]`
// — ZodValidationPipe in particular sends one "field: reason" string
// per failed field. Join those into one readable line rather than
// leaving every caller of api.* to guess whether `err.message` is a
// string or an array.
function toMessage(raw: unknown, fallback: string): string {
  if (Array.isArray(raw)) return raw.length > 0 ? raw.join('; ') : fallback;
  return typeof raw === 'string' && raw ? raw : fallback;
}

/** Default abort timeout: only meant to catch a genuinely unreachable API
 *  (see the commit that introduced it) — not tuned for how long a legit
 *  request can take. LLM-backed generation endpoints (RAG retrieval + a
 *  completion call) routinely run past this, so those call sites pass a
 *  longer `timeoutMs` explicitly rather than everyone paying for a
 *  looser default. */
const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiFetch<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const token = localStorage.getItem('token');
  const sessionId = sessionStorage.getItem('ats_session_id');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
    ...options?.headers,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new ApiError(0, 'Request timed out — is the server running?');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    // For background biometric requests and auth-flow endpoints (see
    // AUTH_FLOW_PATHS above), throw the server's actual message (e.g.
    // "Incorrect code.") without clearing token/redirecting, so the
    // caller can show it inline and let the user retry.
    if (skipsAuthRedirect(path)) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(401, toMessage(body.message, 'Unauthorized'), body.errors);
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized');
  }

  if (res.status === 403) {
    const body = await res.json().catch(() => ({}));
    // Checklist item 5 — RolesGuard blocks every RolesGuard-covered
    // route once a password change is outstanding (forced reset, or
    // 180-day expiry). Normally the client already knows this from
    // user.mustChangePassword (set by /auth/login or /auth/me) and
    // ProtectedRoute redirects before any such request fires; this is
    // the fallback for expiry crossing mid-session, before the next
    // /auth/me refresh. change-password/logout/me themselves never hit
    // this (RolesGuard isn't in their guard chain), so there's no loop.
    if (
      body.code === 'PASSWORD_CHANGE_REQUIRED' &&
      window.location.pathname !== '/change-password'
    ) {
      window.location.href = '/change-password';
    }
    // Checklist item 12 — same fallback for the mandatory-MFA gate
    // (MFA_REQUIRED_ROLES turned on server-side mid-session). The 2FA
    // enrolment routes are on AuthController without RolesGuard, so the
    // Account Security page itself can never trigger this.
    if (
      body.code === 'MFA_ENROLMENT_REQUIRED' &&
      window.location.pathname !== '/account/security'
    ) {
      window.location.href = '/account/security';
    }
    throw new ApiError(403, toMessage(body.message, 'Forbidden'), body.errors);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      toMessage(body.message, `API error: ${res.status}`),
      body.errors,
    );
  }

  // Handle empty responses
  const text = await res.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

// Convenience methods
export const api = {
  get: <T>(path: string) => apiFetch<T>(path),

  post: <T>(path: string, data?: unknown, opts?: { timeoutMs?: number }) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
      timeoutMs: opts?.timeoutMs,
    }),

  /**
   * POST JSON, gzip-compressed client-side (falls back to plain JSON on
   * browsers without CompressionStream). Text/HTML compresses ~10:1
   * losslessly, so this is meant for bandwidth-heavy payloads — currently
   * just session-replay snapshots — not a general-purpose replacement for
   * `post`. The server decompresses transparently based on Content-Encoding.
   */
  postCompressed: async <T>(path: string, data: unknown): Promise<T> => {
    if (!supportsGzipCompression) {
      return apiFetch<T>(path, { method: 'POST', body: JSON.stringify(data) });
    }
    const compressed = await gzipJson(data);
    return apiFetch<T>(path, {
      method: 'POST',
      body: compressed,
      headers: { 'Content-Encoding': 'gzip' },
    });
  },

  patch: <T>(path: string, data: unknown) =>
    apiFetch<T>(path, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  put: <T>(path: string, data: unknown) =>
    apiFetch<T>(path, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  delete: <T>(path: string) =>
    apiFetch<T>(path, {
      method: 'DELETE',
    }),

  // For file uploads (binary data)
  upload: async (path: string, blob: Blob, contentType: string) => {
    const token = localStorage.getItem('token');
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: blob,
    });

    if (!res.ok) {
      throw new ApiError(res.status, `Upload failed: ${res.status}`);
    }

    return res;
  },
};
