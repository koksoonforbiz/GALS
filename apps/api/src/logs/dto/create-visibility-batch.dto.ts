export interface VisibilityEventDto {
  visibleState: string;
  pageUrl: string;
  timestamp: number;
  hiddenDurationMs?: number;
}

export interface CreateVisibilityBatchDto {
  sessionId: string;
  userId: string;
  events: VisibilityEventDto[];
}
