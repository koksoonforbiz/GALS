export interface CreateViewportLogDto {
  sessionId: string;
  userId: string;
  width: number;
  height: number;
  orientation: string;
  timestamp: number;
}
