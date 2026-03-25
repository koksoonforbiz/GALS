export interface KeystrokeEventDto {
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
}
