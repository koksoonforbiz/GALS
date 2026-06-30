import { useState, useCallback } from 'react';

export type EmotionOption = 'engaged' | 'bored' | 'confused' | 'frustrated' | 'neutral';

const OPTIONS: { value: EmotionOption; label: string; letter: string }[] = [
  { value: 'engaged', label: 'Engaged', letter: 'A' },
  { value: 'bored', label: 'Bored', letter: 'B' },
  { value: 'confused', label: 'Confused', letter: 'C' },
  { value: 'frustrated', label: 'Frustrated', letter: 'D' },
  { value: 'neutral', label: 'Neutral', letter: 'E' },
];

interface Props {
  onAnswer: (emotion: EmotionOption) => void;
}

export function EmotionSurveyModal({ onAnswer }: Props) {
  const [shaking, setShaking] = useState(false);
  const [showReminder, setShowReminder] = useState(false);

  const handleBackdropClick = useCallback(() => {
    if (shaking) return;
    setShaking(true);
    setShowReminder(true);
    setTimeout(() => setShaking(false), 500);
    setTimeout(() => setShowReminder(false), 3000);
  }, [shaking]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60"
      onClick={handleBackdropClick}
    >
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8 flex flex-col gap-5 ${shaking ? 'animate-[shake_0.4s_ease-in-out]' : ''}`}
        style={shaking ? { animation: 'shake 0.4s ease-in-out' } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500 mb-1">
            Quick Check-in
          </p>
          <h2 className="text-lg font-bold text-gray-800">How are you feeling right now?</h2>
        </div>

        <div className="flex flex-col gap-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onAnswer(opt.value)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all text-left group"
            >
              <span className="w-7 h-7 flex items-center justify-center rounded-full bg-gray-100 group-hover:bg-indigo-100 text-xs font-bold text-gray-500 group-hover:text-indigo-600 shrink-0">
                {opt.letter}
              </span>
              <span className="text-sm font-medium text-gray-700 group-hover:text-indigo-700">
                {opt.label}
              </span>
            </button>
          ))}
        </div>

        {showReminder && (
          <p className="text-center text-xs text-red-500 font-medium -mt-1">
            Please select how you are feeling to continue.
          </p>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}
