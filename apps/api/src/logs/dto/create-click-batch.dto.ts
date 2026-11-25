export interface ClickEventDto {
  /** Page load id and per-stream sequence (Prompt B, B2/B4). */
  tabId?: string;
  clientSeq?: number;
  x: number;
  y: number;
  pageUrl: string;
  elementSelector: string;
  elementText?: string;
  timestamp: number;
}

export interface CreateClickBatchDto {
  sessionId: string;
  userId: string;
  events: ClickEventDto[];
  /** Rows the browser dropped because its queue was full (B3). */
  overflow?: { dropped: number; sinceMs?: number | null };
}
