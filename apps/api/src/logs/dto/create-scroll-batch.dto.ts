export interface ScrollEventDto {
  /** Page load id and per-stream sequence (Prompt B, B2/B4). */
  tabId?: string;
  clientSeq?: number;
  scrollY: number;
  scrollPercent: number;
  pageUrl: string;
  timestamp: number;
}

export interface CreateScrollBatchDto {
  sessionId: string;
  userId: string;
  events: ScrollEventDto[];
  /** Rows the browser dropped because its queue was full (B3). */
  overflow?: { dropped: number; sinceMs?: number | null };
}
