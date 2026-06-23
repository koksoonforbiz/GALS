/** Typed client for the local GALS Studio server (proxied at /api). */

export interface SessionListItem {
  id: string;
  userId: string;
  userDisplayName: string | null;
  courseId: string;
  courseTitle: string | null;
  startedAt: string;
  durationMs: number;
  hasWebcam: boolean;
  counts: {
    snapshots: number;
    gaze: number;
    emotion: number;
    webcamSegments: number;
    messages: number;
  };
  coding: { windows: number; pctRater1: number; pctRater2: number; disagreementsPending: number };
}

export interface ImportReport {
  ok: boolean;
  sessionId?: string;
  errors: string[];
  warnings: string[];
  inserted: Record<string, number>;
  windows: number;
  missingWebcam: string[];
  checksumMismatches: string[];
}

async function jget<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function jsend<T>(url: string, method: string, body?: unknown): Promise<T> {
  // Only set the JSON content-type when there's a body — Fastify rejects a
  // request that declares application/json but sends an empty body
  // (FST_ERR_CTP_EMPTY_JSON_BODY), which broke every bodiless DELETE.
  const res = await fetch(url, {
    method,
    headers: body == null ? undefined : { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 422) throw new Error(`${res.status} ${res.statusText}`);
  return data as T;
}

export const api = {
  health: () => jget<{ ok: boolean }>('/api/health'),
  sessions: () => jget<{ sessions: SessionListItem[] }>('/api/sessions'),
  importPath: (path: string) => jsend<ImportReport>('/api/import', 'POST', { path }),
  importZip: async (file: File): Promise<ImportReport> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/import', { method: 'POST', body: form });
    return res.json();
  },
  deleteSession: (id: string, deleteCoding: boolean) =>
    jsend<{ ok: boolean }>(`/api/sessions/${id}?deleteCoding=${deleteCoding}`, 'DELETE'),

  // Replay (stage 03)
  replayMeta: (id: string) => jget<any>(`/api/replay/${id}/meta`),
  replaySnapshotIndex: (id: string) => jget<any>(`/api/replay/${id}/snapshots/index`),
  replayStreams: (id: string, signals: string[], from?: number, to?: number) =>
    jget<any>(
      `/api/replay/${id}/streams?signals=${signals.join(',')}${from != null ? `&from=${from}` : ''}${to != null ? `&to=${to}` : ''}`,
    ),
  replaySparse: (id: string) => jget<any>(`/api/replay/${id}/sparse`),
  replayCoverage: (id: string) => jget<any>(`/api/replay/${id}/coverage`),

  // Coding (stage 04)
  codebook: () => jget<any>('/api/codebook'),
  saveCodebook: (body: unknown) => jsend<any>('/api/codebook', 'POST', body),
  coders: () => jget<any>('/api/coders'),
  createCoder: (name: string, role: string) => jsend<any>('/api/coders', 'POST', { name, role }),
  clearAnnotation: (body: unknown) => jsend<any>('/api/annotations/clear', 'POST', body),
  codingState: (id: string, coderId: string, pass: string) =>
    jget<any>(`/api/coding/${id}/state?coderId=${coderId}&pass=${pass}`),
  upsertAnnotation: (body: unknown) => jsend<any>('/api/annotations', 'POST', body),
  updateAnnotation: (annId: string, body: unknown) =>
    jsend<any>(`/api/annotations/${annId}`, 'PATCH', body),
  deleteAnnotation: (annId: string) => jsend<any>(`/api/annotations/${annId}`, 'DELETE'),
  timelineIntervals: (id: string, coderId: string) =>
    jget<any>(`/api/coding/${id}/intervals?coderId=${coderId}`),
  sessionSummary: (id: string, coderId: string) =>
    jget<any>(`/api/coding/${id}/summary?coderId=${coderId}`),
  analysisUsers: () => jget<any>('/api/analysis/users'),
  cohortSummary: (userIds: string[]) =>
    jget<any>(`/api/analysis/cohort-summary?userIds=${userIds.join(',')}`),
  affect: (
    sessionIds: string[],
    opts: {
      methods: string[];
      activationThreshold: number;
      persistenceWindowMs: number;
      personBaseline: boolean;
    },
  ) =>
    jget<any>(
      `/api/analysis/affect?sessionIds=${sessionIds.join(',')}&methods=${opts.methods.join(',')}` +
        `&activationThreshold=${opts.activationThreshold}&persistenceWindowMs=${opts.persistenceWindowMs}` +
        `&personBaseline=${opts.personBaseline}`,
    ),
  utteranceCodings: (id: string, coderId: string) =>
    jget<any>(`/api/coding/${id}/utterances?coderId=${coderId}`),
  upsertUtteranceCoding: (id: string, body: unknown) =>
    jsend<any>(`/api/coding/${id}/utterances`, 'POST', body),
  deleteUtteranceCoding: (codingId: string) =>
    jsend<any>(`/api/coding/utterances/${codingId}`, 'DELETE'),
  utteranceExportUrl: (id: string, coderId: string) =>
    `/api/coding/${id}/utterances/export?coderId=${coderId}`,
  aois: (id: string) => jget<any>(`/api/sessions/${id}/aois`),
  createAoi: (id: string, body: unknown) => jsend<any>(`/api/sessions/${id}/aois`, 'POST', body),
  deleteAoi: (aoiId: string) => jsend<any>(`/api/aois/${aoiId}`, 'DELETE'),
  disagreements: (id: string) => jget<any>(`/api/coding/${id}/disagreements`),
  deriveGold: (id: string) => jsend<any>(`/api/coding/${id}/derive-gold`, 'POST'),

  // Analysis (stage 05/06)
  reliability: (scope: string, dimension: string) =>
    jget<any>(`/api/analysis/reliability?scope=${scope}&dimension=${dimension}`),
  saveReliability: (body: unknown) => jsend<any>('/api/analysis/reliability', 'POST', body),
  dynamics: (id: string, params?: Record<string, unknown>) =>
    jget<any>(
      `/api/analysis/dynamics?session=${id}${params?.resolutionWindows ? `&resolutionWindows=${params.resolutionWindows}` : ''}`,
    ),
  attention: (id: string) => jget<any>(`/api/analysis/attention?session=${id}`),
  reading: (id: string) => jget<any>(`/api/analysis/reading?session=${id}`),
  groundTruth: (id: string) => jget<any>(`/api/analysis/ground-truth?session=${id}`),
  exportCsv: (kind: string, scope: string) => `/api/analysis/export/${kind}?scope=${scope}`,

  // Backup / restore (stage 06)
  exportCodingUrl: '/api/coding/export',
  importCoding: async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/coding/import', { method: 'POST', body: form });
    return res.json();
  },
};

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
