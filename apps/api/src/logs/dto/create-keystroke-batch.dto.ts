export interface KeystrokeEventDto {
  /** Page load id and per-stream sequence (Prompt B, B2/B4). */
  tabId?: string;
  clientSeq?: number;
  /** Keys typed in this burst with ms offsets from burstStart. */
  keys?: Array<{ k: string; t: number }>;
  /** Field text at the end of the burst. */
  text?: string;
  burstStart?: number;
  fieldKind?: string;
  fieldId: string;
  keystrokeCount: number;
  pauseDurationMs: number;
  typingSpeedWPM?: number;
  timestamp: number;
}

export interface CreateKeystrokeBatchDto {
  sessionId: string;
  userId: string;
  events: KeystrokeEventDto[];
  /** Rows the browser dropped because its queue was full (B3). */
  overflow?: { dropped: number; sinceMs?: number | null };
}
