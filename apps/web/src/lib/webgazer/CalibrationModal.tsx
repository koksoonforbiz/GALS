import { useState, useCallback, useRef } from 'react';
import { api } from '../api';

interface CalibrationModalProps {
  courseId: string;
  sessionId: string;
  triggeredBy: 'new_session' | 'inactivity' | 'manual';
  onComplete: () => void;
  onSkip: () => void;
  onTrainPoint: (screenX: number, screenY: number) => void;
  getCurrentPrediction: () => Promise<{ x: number; y: number } | null>;
}

// 9-point calibration grid positions (percentage of viewport)
const CALIBRATION_POINTS = [
  { x: 10, y: 10 }, // top-left
  { x: 50, y: 10 }, // top-center
  { x: 90, y: 10 }, // top-right
  { x: 10, y: 50 }, // middle-left
  { x: 50, y: 50 }, // center
  { x: 90, y: 50 }, // middle-right
  { x: 10, y: 90 }, // bottom-left
  { x: 50, y: 90 }, // bottom-center
  { x: 90, y: 90 }, // bottom-right
];

// Points used to measure accuracy after calibration
const ACCURACY_TEST_POINTS = [
  { x: 30, y: 30 },
  { x: 70, y: 30 },
  { x: 50, y: 50 },
  { x: 30, y: 70 },
  { x: 70, y: 70 },
];

type Phase = 'instructions' | 'calibrating' | 'accuracy_test' | 'done';

export function CalibrationModal({
  courseId,
  sessionId,
  triggeredBy,
  onComplete,
  onSkip,
  onTrainPoint,
  getCurrentPrediction,
}: CalibrationModalProps) {
  const [phase, setPhase] = useState<Phase>('instructions');
  const [currentPoint, setCurrentPoint] = useState(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const clickCountRef = useRef(0);

  const handlePointClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // Train WebGazer with the actual screen coordinates of the clicked point
      const rect = e.currentTarget.getBoundingClientRect();
      const screenX = rect.left + rect.width / 2;
      const screenY = rect.top + rect.height / 2;
      onTrainPoint(screenX, screenY);

      clickCountRef.current += 1;

      // Require 5 clicks per point for training
      if (clickCountRef.current >= 5) {
        clickCountRef.current = 0;
        if (currentPoint < CALIBRATION_POINTS.length - 1) {
          setCurrentPoint((prev) => prev + 1);
        } else {
          // All points done, run accuracy test
          runAccuracyTest();
        }
      }
    },
    [currentPoint, onTrainPoint],
  );

  const runAccuracyTest = useCallback(async () => {
    setPhase('accuracy_test');

    const errors: number[] = [];
    for (const testPoint of ACCURACY_TEST_POINTS) {
      const targetX = (testPoint.x / 100) * window.innerWidth;
      const targetY = (testPoint.y / 100) * window.innerHeight;

      // Wait briefly for the user to look at each region
      await new Promise((r) => setTimeout(r, 400));

      const prediction = await getCurrentPrediction();
      if (prediction) {
        const dx = prediction.x - targetX;
        const dy = prediction.y - targetY;
        errors.push(Math.sqrt(dx * dx + dy * dy));
      }
    }

    const avgError =
      errors.length > 0 ? Math.round(errors.reduce((a, b) => a + b, 0) / errors.length) : 999;

    setAccuracy(avgError);
    setPhase('done');
  }, [getCurrentPrediction]);

  const handleComplete = useCallback(async () => {
    try {
      await api.post('/webgazer/calibration', {
        sessionId,
        courseId,
        triggeredBy,
        completedAt: new Date().toISOString(),
        accuracy: accuracy ?? undefined,
      });
    } catch {
      // Best effort
    }
    onComplete();
  }, [sessionId, courseId, triggeredBy, accuracy, onComplete]);

  const handleSkip = useCallback(async () => {
    try {
      await api.post('/webgazer/calibration', {
        sessionId,
        courseId,
        triggeredBy,
      });
    } catch {
      // Best effort
    }
    onSkip();
  }, [sessionId, courseId, triggeredBy, onSkip]);

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center text-white">
      {/* Instructions phase */}
      {phase === 'instructions' && (
        <div className="text-center max-w-md space-y-6">
          <h2 className="text-2xl font-bold">Eye Tracking Calibration</h2>
          <p className="text-gray-300">
            Please look at each red dot and click it when your gaze is focused on it. Click each dot
            5 times.
          </p>
          <p className="text-sm text-gray-400">
            This helps the system track where you are looking on the screen.
          </p>
          <div className="flex gap-4 justify-center">
            <button
              onClick={handleSkip}
              className="px-6 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              Skip
            </button>
            <button
              onClick={() => setPhase('calibrating')}
              className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Start Calibration
            </button>
          </div>
        </div>
      )}

      {/* Calibrating phase */}
      {phase === 'calibrating' && (
        <>
          <div className="absolute top-4 left-4 text-sm text-gray-400">
            Point {currentPoint + 1} / {CALIBRATION_POINTS.length} — Click 5 times
          </div>
          {CALIBRATION_POINTS.map((point, idx) => (
            <button
              key={idx}
              onClick={idx === currentPoint ? handlePointClick : undefined}
              className={`absolute rounded-full transition-all duration-300 ${
                idx === currentPoint
                  ? 'w-6 h-6 bg-red-500 animate-pulse cursor-pointer shadow-lg shadow-red-500/50'
                  : idx < currentPoint
                    ? 'w-3 h-3 bg-green-500 opacity-50'
                    : 'w-3 h-3 bg-gray-600 opacity-30'
              }`}
              style={{
                left: `${point.x}%`,
                top: `${point.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          ))}
        </>
      )}

      {/* Accuracy test phase */}
      {phase === 'accuracy_test' && (
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-300">Testing calibration accuracy...</p>
        </div>
      )}

      {/* Done phase */}
      {phase === 'done' && accuracy !== null && (
        <div className="text-center max-w-md space-y-4">
          <h2 className="text-xl font-bold">Calibration Complete</h2>
          <p className="text-gray-300">
            Estimated accuracy: <span className="font-mono text-yellow-400">{accuracy}px</span>
          </p>
          {accuracy > 80 ? (
            <p className="text-sm text-orange-400">
              Accuracy is lower than ideal. You can redo calibration or continue.
            </p>
          ) : (
            <p className="text-sm text-green-400">Good accuracy! Eye tracking is ready.</p>
          )}
          <div className="flex gap-4 justify-center">
            {accuracy > 80 && (
              <button
                onClick={() => {
                  setPhase('instructions');
                  setCurrentPoint(0);
                  setAccuracy(null);
                }}
                className="px-6 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              >
                Redo
              </button>
            )}
            <button
              onClick={handleComplete}
              className="px-6 py-2 text-sm bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
