export interface ClipboardEventDto {
  /** Page load id and per-stream sequence (Prompt B, B2/B4). */
  tabId?: string;
  clientSeq?: number;
  /** Copied, cut or pasted text. */
  text?: string;
  action: string;
  textLength: number;
  sourceElement?: string;
  pageUrl: string;
  timestamp: number;
}

export interface CreateClipboardBatchDto {
  sessionId: string;
  userId: string;
  events: ClipboardEventDto[];
  /** Rows the browser dropped because its queue was full (B3). */
  overflow?: { dropped: number; sinceMs?: number | null };
}
