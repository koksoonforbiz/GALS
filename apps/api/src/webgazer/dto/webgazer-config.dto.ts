export interface WebgazerConfigDto {
  isEnabled: boolean;
  eyeTrackerType: 'webgazer' | 'webeyetrack';
  calibrationOnNewSession: boolean;
  recalibrationEnabled: boolean;
  inactivityTimeoutSecs: number;
}
