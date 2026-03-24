export interface ScrollEventDto {
  scrollY: number;
  scrollPercent: number;
  pageUrl: string;
  timestamp: number;
}

export interface CreateScrollBatchDto {
  sessionId: string;
  userId: string;
  events: ScrollEventDto[];
}
