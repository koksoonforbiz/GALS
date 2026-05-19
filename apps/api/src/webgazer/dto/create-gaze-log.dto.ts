export interface CreateGazeLogDto {
  timestamp: string; // ISO8601
  gazeX: number;
  gazeY: number;
  confidence?: number;
  pageUrl?: string;
}

export interface WebgazerBatchDto {
  sessionId: string;
  courseId: string;
  readings: CreateGazeLogDto[];
}
