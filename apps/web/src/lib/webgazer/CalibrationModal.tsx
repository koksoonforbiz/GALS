import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../api';

interface CalibrationModalProps {
  courseId: string;
  sessionId: string;
  triggeredBy: 'new_session' | 'inactivity' | 'manual';
  onComplete: () => void;
  onSkip: () => void;
  onTrainPoint: (screenX: number, screenY: number) => void;
  getCurrentPrediction: () => Promise<{ x: number; y: number } | null>;
  /** Forget previous training (Redo). */
  onReset?: () => void;
  /** Show/hide the camera view with the face box. */
  onPreview?: (show: boolean) => void;
}

// 9-point training grid (percentage of viewport), clicked 5 times each while
// looking at the dot (WebGazer's recommended procedure).
const CALIBRATION_POINTS = [
  { x: 10, y: 10 },
  { x: 50, y: 10 },
  { x: 90, y: 10 },
  { x: 10, y: 50 },
  { x: 50, y: 50 },
  { x: 90, y: 50 },
  { x: 10, y: 90 },
  { x: 50, y: 90 },
  { x: 90, y: 90 },
];

// Validation targets (not used for training): the student only LOOKS at
// each dot; predictions sampled while they fixate give the error.
const ACCURACY_TEST_POINTS = [
  { x: 30, y: 30 },
  { x: 70, y: 30 },
  { x: 50, y: 50 },
  { x: 30, y: 70 },
  { x: 70, y: 70 },
];
const FIXATE_MS = 2000;
const SETTLE_MS = 700;
const SAMPLE_EVERY_MS = 100;
// Error as a share of the screen diagonal: webcam eye tracking typically
// lands within ~10-15 %; above 20 % the data is not usable for AOIs.
const GOOD_PCT = 12;
const WEAK_PCT = 20;

type Phase = 'instructions' | 'calibrating' | 'accuracy_test' | 'done';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};

export function CalibrationModal({
  courseId,
  sessionId,
  triggeredBy,
  onComplete,
  onSkip,
  onTrainPoint,
  getCurrentPrediction,
  onReset,
  onPreview,
}: CalibrationModalProps) {
  const [phase, setPhase] = useState<Phase>('instructions');
  const [currentPoint, setCurrentPoint] = useState(0);
  const [testPoint, setTestPoint] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<{ px: number; pct: number } | null>(null);
  const clickCountRef = useRef(0);

  // Camera view with the face box while reading the instructions and
  // calibrating, so the student can position themselves.
  useEffect(() => {
    onPreview?.(phase === 'instructions' || phase === 'calibrating');
    return () => onPreview?.(false);
  }, [phase, onPreview]);

  const runAccuracyTest = useCallback(async () => {
    setPhase('accuracy_test');
    const errors: number[] = [];
    for (let i = 0; i < ACCURACY_TEST_POINTS.length; i++) {
      setTestPoint(i);
      const t = ACCURACY_TEST_POINTS[i]!;
      const targetX = (t.x / 100) * window.innerWidth;
      const targetY = (t.y / 100) * window.innerHeight;
      await new Promise((r) => setTimeout(r, SETTLE_MS));
      const xs: number[] = [];
      const ys: number[] = [];
      for (let elapsed = SETTLE_MS; elapsed < FIXATE_MS; elapsed += SAMPLE_EVERY_MS) {
        const p = await getCurrentPrediction();
        if (p) {
          xs.push(p.x);
          ys.push(p.y);
        }
        await new Promise((r) => setTimeout(r, SAMPLE_EVERY_MS));
      }
      // Median gaze point over the fixation (robust to blinks and outliers).
      if (xs.length) errors.push(Math.hypot(median(xs) - targetX, median(ys) - targetY));
    }
    setTestPoint(null);
    const diag = Math.hypot(window.innerWidth, window.innerHeight);
    const px = errors.length ? Math.round(errors.reduce((a, b) => a + b, 0) / errors.length) : 9999;
    setAccuracy({ px, pct: Math.round((px / diag) * 100) });
    setPhase('done');
  }, [getCurrentPrediction]);

  const handlePointClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      onTrainPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      clickCountRef.current += 1;
      if (clickCountRef.current >= 5) {
        clickCountRef.current = 0;
        if (currentPoint < CALIBRATION_POINTS.length - 1) setCurrentPoint((prev) => prev + 1);
        else void runAccuracyTest();
      }
    },
    [currentPoint, onTrainPoint, runAccuracyTest],
  );

  const redo = useCallback(() => {
    onReset?.();
    clickCountRef.current = 0;
    setCurrentPoint(0);
    setAccuracy(null);
    setPhase('instructions');
  }, [onReset]);

  const post = useCallback(
    (extra: Record<string, unknown>) =>
      api
        .post('/webgazer/calibration', { sessionId, courseId, triggeredBy, ...extra })
        .catch(() => {
          // best effort
        }),
    [sessionId, courseId, triggeredBy],
  );

  const handleComplete = useCallback(async () => {
    await post({ completedAt: new Date().toISOString(), accuracy: accuracy?.px });
    onComplete();
  }, [post, accuracy, onComplete]);

  const handleSkip = useCallback(async () => {
    await post({});
    onSkip();
  }, [post, onSkip]);

  const quality =
    accuracy == null
      ? null
      : accuracy.pct <= GOOD_PCT
        ? 'good'
        : accuracy.pct <= WEAK_PCT
          ? 'ok'
          : 'weak';

  return (
    <div className="fixed inset-0 z-[200] bg-black flex flex-col items-center justify-center text-white">
      {phase === 'instructions' && (
        <div className="text-center max-w-lg space-y-5 mt-56">
          <h2 className="text-2xl font-bold">Eye tracking calibration</h2>
          <p className="text-gray-300">
            Your camera view is shown above. Move until your face is centred and the box around it
            turns <span className="text-green-400 font-medium">green</span>.
          </p>
          <ul className="text-left text-sm text-gray-300 space-y-1 list-disc pl-6">
            <li>Sit about an arm&apos;s length from the screen, at eye level with the camera.</li>
            <li>Light should be on your face (no bright window behind you).</li>
            <li>Keep your head still; move only your eyes.</li>
            <li>Look straight at each red dot and click it 5 times while looking at it.</li>
          </ul>
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
              Start calibration
            </button>
          </div>
        </div>
      )}

      {phase === 'calibrating' && (
        <>
          <div className="absolute bottom-4 left-4 text-sm text-gray-400">
            Point {currentPoint + 1} / {CALIBRATION_POINTS.length} — look at the dot and click it 5
            times
          </div>
          {CALIBRATION_POINTS.map((point, idx) => (
            <button
              key={idx}
              onClick={idx === currentPoint ? handlePointClick : undefined}
              aria-label={idx === currentPoint ? `Calibration point ${idx + 1}` : undefined}
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

      {phase === 'accuracy_test' && (
        <>
          <p className="absolute top-6 text-gray-300">
            Now just <strong>look</strong> at the blue dot — do not click.
          </p>
          {testPoint != null && (
            <div
              className="absolute w-5 h-5 rounded-full bg-sky-400 shadow-lg shadow-sky-400/60"
              style={{
                left: `${ACCURACY_TEST_POINTS[testPoint]!.x}%`,
                top: `${ACCURACY_TEST_POINTS[testPoint]!.y}%`,
                transform: 'translate(-50%, -50%)',
              }}
            />
          )}
        </>
      )}

      {phase === 'done' && accuracy && (
        <div className="text-center max-w-md space-y-4">
          <h2 className="text-xl font-bold">Calibration complete</h2>
          <p className="text-gray-300">
            Average error: <span className="font-mono text-yellow-400">{accuracy.px}px</span> (
            {accuracy.pct}% of the screen)
          </p>
          {quality === 'good' && (
            <p className="text-sm text-green-400">Good — eye tracking is ready.</p>
          )}
          {quality === 'ok' && (
            <p className="text-sm text-yellow-300">
              Acceptable. Redo for better results if you can improve the lighting or sit more
              centrally.
            </p>
          )}
          {quality === 'weak' && (
            <p className="text-sm text-orange-400">
              Weak. Please redo: face the camera directly, light your face from the front and keep
              your head still.
            </p>
          )}
          <div className="flex gap-4 justify-center">
            {quality !== 'good' && (
              <button
                onClick={redo}
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
