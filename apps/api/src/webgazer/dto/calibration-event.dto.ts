export interface CalibrationEventDto {
  sessionId: string;
  courseId: string;
  triggeredBy: 'new_session' | 'inactivity' | 'manual';
  completedAt?: string; // ISO8601
  accuracy?: number;
}
