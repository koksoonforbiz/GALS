/**
 * WebGazer.js placeholder.
 *
 * Replace this file with the full WebGazer build from:
 *   https://github.com/kianyu/WebGazer
 *
 * Build instructions:
 *   git clone https://github.com/kianyu/WebGazer
 *   cd WebGazer && npm install && npm run build
 *   cp dist/webgazer.js <this-file>
 *
 * This stub provides a no-op implementation so the app loads
 * without errors when WebGazer is not yet installed.
 */
(function () {
  if (window.webgazer) return; // real webgazer already loaded

  window.webgazer = {
    setRegression: function () {
      return window.webgazer;
    },
    setTracker: function () {
      return window.webgazer;
    },
    showVideo: function () {
      return window.webgazer;
    },
    showFaceOverlay: function () {
      return window.webgazer;
    },
    showFaceFeedbackBox: function () {
      return window.webgazer;
    },
    saveDataAcrossSessions: function () {
      return window.webgazer;
    },
    begin: function () {
      return Promise.resolve(window.webgazer);
    },
    end: function () {},
    setGazeListener: function () {
      return window.webgazer;
    },
    clearData: function () {},
  };

  console.warn(
    '[WebGazer] Stub loaded. Replace public/webgazer.js with the real build for eye tracking.',
  );
})();
