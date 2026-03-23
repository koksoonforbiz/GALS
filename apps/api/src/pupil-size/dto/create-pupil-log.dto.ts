export interface CreatePupilLogDto {
  timestamp: string; // ISO8601
  pupilDiameter: number;
  rawData?: Record<string, unknown>;
}

export interface PupilSizeBatchDto {
  sessionId: string;
  courseId: string;
  readings: CreatePupilLogDto[];
}
