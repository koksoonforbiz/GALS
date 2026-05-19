export interface RecordingConfigDto {
  isEnabled?: boolean;
  // OpenFace 3 emotion-detection fields (course-scoped, stored on the same row).
  openface3Enabled?: boolean;
  openface3ExtractionFps?: number;
  openface3DetectorBackend?: string;
  openface3RunOnNewSegments?: boolean;
}
