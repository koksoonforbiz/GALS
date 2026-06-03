/**
 * Researcher annotation layer hook (prompt 06).
 *
 * Owns loading + CRUD against /replay-annotations. Annotations are
 * stored as ms offsets from the session's `baseWallClockMs` anchor —
 * the same coordinate as the CSV exporter's `relative_s` row.
 *
 * Optimistic updates aren't done here — every mutation refetches on
 * success. Annotation traffic is researcher-driven (sub-1 Hz at the
 * very worst), so the simpler "POST then GET" pattern is fine and
 * sidesteps tricky merge edge cases.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';

export interface ReplayCode {
  id: string;
  label: string;
  color: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ReplayAnnotation {
  id: string;
  sessionId: string;
  researcherId: string;
  codeId: string | null;
  code: ReplayCode | null;
  startMs: number;
  endMs: number | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useReplayAnnotations(sessionId: string | null | undefined) {
  const [annotations, setAnnotations] = useState<ReplayAnnotation[]>([]);
  const [codes, setCodes] = useState<ReplayCode[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    try {
      const [ann, cs] = await Promise.all([
        api.get<ReplayAnnotation[]>(
          `/replay-annotations?sessionId=${encodeURIComponent(sessionId)}`,
        ),
        api.get<ReplayCode[]>(`/replay-annotations/codes`),
      ]);
      setAnnotations(ann);
      setCodes(cs);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createCode = useCallback(
    async (label: string, color?: string) => {
      await api.post('/replay-annotations/codes', { label, color });
      await refresh();
    },
    [refresh],
  );

  const updateCode = useCallback(
    async (id: string, patch: { label?: string; color?: string | null }) => {
      await api.patch(`/replay-annotations/codes/${id}`, patch);
      await refresh();
    },
    [refresh],
  );

  const deleteCode = useCallback(
    async (id: string) => {
      await api.delete(`/replay-annotations/codes/${id}`);
      await refresh();
    },
    [refresh],
  );

  const createAnnotation = useCallback(
    async (body: {
      startMs: number;
      endMs?: number | null;
      codeId?: string | null;
      note?: string | null;
    }) => {
      if (!sessionId) return;
      await api.post('/replay-annotations', {
        sessionId,
        ...body,
      });
      await refresh();
    },
    [sessionId, refresh],
  );

  const updateAnnotation = useCallback(
    async (
      id: string,
      patch: {
        startMs?: number;
        endMs?: number | null;
        codeId?: string | null;
        note?: string | null;
      },
    ) => {
      await api.patch(`/replay-annotations/${id}`, patch);
      await refresh();
    },
    [refresh],
  );

  const deleteAnnotation = useCallback(
    async (id: string) => {
      await api.delete(`/replay-annotations/${id}`);
      await refresh();
    },
    [refresh],
  );

  return {
    annotations,
    codes,
    isLoading,
    error,
    refresh,
    createCode,
    updateCode,
    deleteCode,
    createAnnotation,
    updateAnnotation,
    deleteAnnotation,
  };
}
