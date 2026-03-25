const API_BASE = '/api';

/** Background biometric paths that should NOT trigger a login redirect on 401. */
const BACKGROUND_PATHS = [
  '/pupil-size/logs',
  '/webgazer/logs',
  '/webgazer/calibration',
  '/recording/segments/',
  '/logs/',
];

function isBackgroundPath(path: string): boolean {
  return BACKGROUND_PATHS.some((p) => path.startsWith(p));
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

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token');
  const sessionId = sessionStorage.getItem('ats_session_id');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
    ...options?.headers,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // For background biometric requests, throw without clearing token/redirecting.
    // This prevents a single 401 from killing all in-flight biometric flushes.
    if (isBackgroundPath(path)) {
      throw new ApiError(401, 'Unauthorized');
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new ApiError(401, 'Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message || `API error: ${res.status}`, body.errors);
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

  post: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

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
