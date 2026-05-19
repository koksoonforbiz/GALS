export interface ClipboardEventDto {
  action: string;
  textLength: number;
  sourceElement?: string;
  pageUrl: string;
  timestamp: number;
}

export interface CreateClipboardBatchDto {
  sessionId: string;
  userId: string;
  events: ClipboardEventDto[];
}
