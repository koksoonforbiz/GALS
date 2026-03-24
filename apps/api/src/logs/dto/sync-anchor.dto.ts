export interface SyncAnchorDto {
  sessionId: string;
  userId: string;
  wallClockMs: number;
  monotonicMs: number;
  timezone: string;
  userAgent: string;
}
