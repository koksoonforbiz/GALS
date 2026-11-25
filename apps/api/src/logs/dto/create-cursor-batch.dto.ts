export interface CursorEventDto {
  /** Page load id and per-stream sequence (Prompt B, B2/B4). */
  tabId?: string;
  clientSeq?: number;
  x: number;
  y: number;
  pageUrl: string;
  elementTarget?: string;
  timestamp: number;
  batchId?: string;
}

export interface CreateCursorBatchDto {
  sessionId: string;
  userId: string;
  events: CursorEventDto[];
  /** Rows the browser dropped because its queue was full (B3). */
  overflow?: { dropped: number; sinceMs?: number | null };
}
