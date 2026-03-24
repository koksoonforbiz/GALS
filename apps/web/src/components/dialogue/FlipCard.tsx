import { useState } from 'react';

interface FlipCardProps {
  front: string;
  back: string;
  index: number;
  total: number;
}

export function FlipCard({ front, back, index, total }: FlipCardProps) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="w-full">
      <div className="text-xs text-gray-500 mb-2 text-center">
        Card {index + 1} of {total}
      </div>
      <button
        onClick={() => setFlipped(!flipped)}
        className="w-full min-h-[200px] rounded-xl border-2 border-gray-200 p-6 text-left transition-all duration-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        style={{
          backgroundColor: flipped ? '#f0fdf4' : '#ffffff',
          borderColor: flipped ? '#86efac' : '#e5e7eb',
        }}
      >
        <div className="text-xs font-medium text-gray-400 uppercase mb-3">
          {flipped ? 'Answer' : 'Question'}
        </div>
        <div className="text-sm text-gray-800 whitespace-pre-wrap">{flipped ? back : front}</div>
        <div className="mt-4 text-xs text-gray-400 text-center">Click to flip</div>
      </button>
    </div>
  );
}
