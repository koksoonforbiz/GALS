export interface PyfeatConfigDto {
  isEnabled: boolean;
  extractionFps: number;
  enabledAus: string[];
  detectorBackend: 'retinaface' | 'mtcnn' | 'img2pose';
  auPredictor: 'xgb' | 'svm' | 'logistic';
}
