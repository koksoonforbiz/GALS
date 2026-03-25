export interface CursorEventDto {
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
}
