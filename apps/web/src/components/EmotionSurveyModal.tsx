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
  const [selected, setSelected] = useState<EmotionOption | null>(null);
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
          <h2 className="text-lg font-bold text-gray-800">How are you feeling right now?</h2>
        </div>

        <div className="flex flex-col gap-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSelected(opt.value)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all text-left group ${
                selected === opt.value
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-gray-200 hover:border-indigo-400 hover:bg-indigo-50'
              }`}
            >
              <span
                className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-bold shrink-0 ${
                  selected === opt.value
                    ? 'bg-indigo-500 text-white'
                    : 'bg-gray-100 text-gray-500 group-hover:bg-indigo-100 group-hover:text-indigo-600'
                }`}
              >
                {opt.letter}
              </span>
              <span
                className={`text-sm font-medium ${
                  selected === opt.value
                    ? 'text-indigo-700'
                    : 'text-gray-700 group-hover:text-indigo-700'
                }`}
              >
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

        <button
          onClick={() => selected && onAnswer(selected)}
          disabled={!selected}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-600 hover:bg-indigo-700 text-white"
        >
          Confirm
        </button>
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
