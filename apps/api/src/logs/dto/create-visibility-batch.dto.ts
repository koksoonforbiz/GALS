export interface VisibilityEventDto {
  /** Page load id and per-stream sequence (Prompt B, B2/B4). */
  tabId?: string;
  clientSeq?: number;
  visibleState: string;
  pageUrl: string;
  timestamp: number;
  hiddenDurationMs?: number;
}

export interface CreateVisibilityBatchDto {
  sessionId: string;
  userId: string;
  events: VisibilityEventDto[];
  /** Rows the browser dropped because its queue was full (B3). */
  overflow?: { dropped: number; sinceMs?: number | null };
}
