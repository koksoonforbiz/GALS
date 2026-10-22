import { useEffect, useState } from 'react';
import type { PuzzleOccasion } from '@ats/shared';
import { api, ApiError } from '../../../lib/api';
import type { OccasionView } from './PuzzlesPage';

const MIN_W = 1024;
const MIN_H = 700;

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

/** Notice + device check. Blocks small screens and touch-only devices. */
export function NoticeStep({
  courseId,
  occasion,
  notice,
  onStarted,
}: {
  courseId: string;
  occasion: PuzzleOccasion;
  notice: NonNullable<OccasionView['notice']>;
  onStarted: (v: OccasionView) => void;
}) {
  const vp = useViewport();
  const [accepted, setAccepted] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pointerFine = window.matchMedia('(pointer: fine)').matches;
  const hoverNone = window.matchMedia('(hover: none)').matches;
  const bigEnough = vp.w >= MIN_W && vp.h >= MIN_H;
  const deviceOk = pointerFine && !hoverNone;

  const start = async () => {
    setSaving(true);
    setError('');
    // Full screen is requested on the click (browsers require a user
    // gesture); declining is allowed and recorded.
    let fullscreenAccepted = false;
    try {
      await document.documentElement.requestFullscreen?.();
      fullscreenAccepted = !!document.fullscreenElement;
    } catch {
      fullscreenAccepted = false;
    }
    try {
      const v = await api.post<OccasionView>(
        `/puzzles/courses/${courseId}/occasions/${occasion}/start`,
        {
          noticeVersion: notice.version,
          accepted: true,
          device: {
            userAgent: navigator.userAgent.slice(0, 512),
            screenW: window.screen.width,
            screenH: window.screen.height,
            viewportW: window.innerWidth,
            viewportH: window.innerHeight,
            devicePixelRatio: window.devicePixelRatio,
            pointerFine,
            hoverNone,
            keyboardConfirmed: true,
            fullscreenAccepted,
          },
        },
      );
      onStarted(v);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start. Please try again.');
      setSaving(false);
    }
  };

  if (!deviceOk) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        <h2 className="text-base font-semibold">Please use a computer</h2>
        <p className="mt-2">
          These puzzles need a desktop or laptop computer with a keyboard and a mouse or trackpad.
          Please come back on a computer.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h1 className="text-xl font-semibold text-gray-900">{notice.title}</h1>
      <div className="mt-4 space-y-3 text-sm leading-relaxed text-gray-700">
        {notice.paragraphs.map((p) => (
          <p key={p.slice(0, 24)}>{p}</p>
        ))}
      </div>

      {!bigEnough && (
        <div
          className="mt-5 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
        >
          Please make your browser window larger (at least {MIN_W} × {MIN_H}; now {vp.w} × {vp.h})
          or use a bigger screen.
        </div>
      )}

      <label className="mt-5 flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={keyboard}
          onChange={(e) => setKeyboard(e.target.checked)}
        />
        I am using a computer with a physical keyboard, and I have closed other tabs and silenced
        notifications.
      </label>
      <label className="mt-3 flex items-start gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        {notice.acceptLabel}
      </label>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        onClick={() => void start()}
        disabled={!accepted || !keyboard || !bigEnough || saving}
        className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? 'Starting…' : 'Continue (opens full screen)'}
      </button>
    </div>
  );
}
