export interface CreateSegmentDto {
  sessionId: string;
  courseId: string;
  startWallTime: string; // ISO8601
  segmentIndex: number;
  mimeType?: string;
}
