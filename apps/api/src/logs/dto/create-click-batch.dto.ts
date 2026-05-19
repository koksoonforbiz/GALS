export interface ClickEventDto {
  x: number;
  y: number;
  pageUrl: string;
  elementSelector: string;
  elementText?: string;
  timestamp: number;
}

export interface CreateClickBatchDto {
  sessionId: string;
  userId: string;
  events: ClickEventDto[];
}
