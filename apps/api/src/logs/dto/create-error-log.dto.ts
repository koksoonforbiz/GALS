export interface CreateErrorLogDto {
  sessionId: string;
  userId: string;
  errorMessage: string;
  stack?: string;
  componentName?: string;
  pageUrl: string;
  timestamp: number;
  errorType?: string;
}
