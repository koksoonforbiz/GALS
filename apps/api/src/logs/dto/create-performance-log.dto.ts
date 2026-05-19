export interface CreatePerformanceLogDto {
  sessionId: string;
  userId: string;
  pageUrl: string;
  pageLoadMs?: number;
  apiLatencyMs?: number;
  resourceTimingsJson?: Record<string, unknown>;
  timestamp: number;
}
