declare module 'webgazer' {
  interface GazeData {
    x: number;
    y: number;
    confidence?: number;
  }

  interface WebGazer {
    setRegression(type: string): WebGazer;
    setTracker(type: string): WebGazer;
    showVideo(show: boolean): WebGazer;
    showFaceOverlay(show: boolean): WebGazer;
    showFaceFeedbackBox(show: boolean): WebGazer;
    saveDataAcrossSessions(save: boolean): WebGazer;
    begin(): Promise<WebGazer>;
    end(): void;
    setGazeListener(callback: (data: GazeData | null, timestamp: number) => void): WebGazer;
    clearData(): void;
  }

  const webgazer: WebGazer;
  export default webgazer;
}
