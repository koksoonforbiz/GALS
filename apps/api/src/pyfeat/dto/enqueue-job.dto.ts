export interface EnqueueJobDto {
  studentId: string;
  sessionId: string;
  courseId: string;
  sourceMinioKey: string;
  clipStartWallTime: string; // ISO8601
}
