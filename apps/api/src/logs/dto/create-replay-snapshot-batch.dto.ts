export interface ReplaySnapshotEventDto {
  pageUrl: string;
  html: string;
  screenshotDataUrl?: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  capturedAt: number;
  trigger: string;
}

export interface CreateReplaySnapshotBatchDto {
  sessionId: string;
  userId: string;
  events: ReplaySnapshotEventDto[];
}
