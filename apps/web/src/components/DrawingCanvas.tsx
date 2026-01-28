import { useRef, useState, useEffect, useCallback } from 'react';

export interface Point {
  x: number;
  y: number;
  pressure?: number;
}

export interface Stroke {
  points: Point[];
  color: string;
  width: number;
}

interface DrawingCanvasProps {
  width?: number;
  height?: number;
  initialStrokes?: Stroke[];
  onStrokesChange?: (strokes: Stroke[]) => void;
  readOnly?: boolean;
}

export function DrawingCanvas({
  width = 800,
  height = 400,
  initialStrokes = [],
  onStrokesChange,
  readOnly = false,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(2);

  // Redraw canvas when strokes change
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw all strokes
    [...strokes, currentStroke].filter(Boolean).forEach((stroke) => {
      if (!stroke || stroke.points.length < 2) return;

      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const first = stroke.points[0];
      if (!first) return;

      ctx.moveTo(first.x, first.y);

      stroke.points.slice(1).forEach((point) => {
        ctx.lineTo(point.x, point.y);
      });

      ctx.stroke();
    });
  }, [strokes, currentStroke]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // Update parent when strokes change
  useEffect(() => {
    if (onStrokesChange) {
      onStrokesChange(strokes);
    }
  }, [strokes, onStrokesChange]);

  const getPointFromEvent = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      if (!touch) return { x: 0, y: 0 };
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
        pressure: (touch as unknown as { force?: number }).force,
      };
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleStart = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (readOnly) return;
    e.preventDefault();

    const point = getPointFromEvent(e);
    setIsDrawing(true);
    setCurrentStroke({
      points: [point],
      color: strokeColor,
      width: strokeWidth,
    });
  };

  const handleMove = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>,
  ) => {
    if (!isDrawing || readOnly || !currentStroke) return;
    e.preventDefault();

    const point = getPointFromEvent(e);
    setCurrentStroke((prev) =>
      prev
        ? {
            ...prev,
            points: [...prev.points, point],
          }
        : null,
    );
  };

  const handleEnd = () => {
    if (!isDrawing || !currentStroke) return;

    if (currentStroke.points.length >= 2) {
      setStrokes((prev) => [...prev, currentStroke]);
    }
    setCurrentStroke(null);
    setIsDrawing(false);
  };

  const handleClear = () => {
    setStrokes([]);
    setCurrentStroke(null);
  };

  const handleUndo = () => {
    setStrokes((prev) => prev.slice(0, -1));
  };

  // Export canvas as PNG data URL
  const exportAsPNG = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.toDataURL('image/png');
  }, []);

  // Expose export function via ref
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      (canvas as unknown as { exportAsPNG: () => string | null }).exportAsPNG = exportAsPNG;
    }
  }, [exportAsPNG]);

  const colors = ['#000000', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6'];
  const widths = [1, 2, 4, 6];

  return (
    <div className="space-y-2">
      {!readOnly && (
        <div className="flex items-center gap-4 p-2 bg-gray-50 rounded-lg">
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-600 mr-1">Color:</span>
            {colors.map((color) => (
              <button
                key={color}
                onClick={() => setStrokeColor(color)}
                className={`w-6 h-6 rounded-full border-2 transition-transform ${
                  strokeColor === color ? 'scale-125 border-gray-400' : 'border-transparent'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-600 mr-1">Width:</span>
            {widths.map((w) => (
              <button
                key={w}
                onClick={() => setStrokeWidth(w)}
                className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                  strokeWidth === w ? 'bg-blue-100' : 'hover:bg-gray-100'
                }`}
              >
                <div className="rounded-full bg-gray-800" style={{ width: w * 2, height: w * 2 }} />
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <button
            onClick={handleUndo}
            disabled={strokes.length === 0}
            className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Undo
          </button>
          <button
            onClick={handleClear}
            disabled={strokes.length === 0}
            className="px-3 py-1 text-sm bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        </div>
      )}

      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onMouseDown={handleStart}
        onMouseMove={handleMove}
        onMouseUp={handleEnd}
        onMouseLeave={handleEnd}
        onTouchStart={handleStart}
        onTouchMove={handleMove}
        onTouchEnd={handleEnd}
        className={`border border-gray-300 rounded-lg bg-white ${
          readOnly ? 'cursor-default' : 'cursor-crosshair'
        }`}
        style={{ touchAction: 'none', maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
}

// Helper to convert strokes to PNG Blob
export async function strokesToPNGBlob(
  strokes: Stroke[],
  width: number,
  height: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Draw strokes
  strokes.forEach((stroke) => {
    if (stroke.points.length < 2) return;

    ctx.beginPath();
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const first = stroke.points[0];
    if (!first) return;

    ctx.moveTo(first.x, first.y);

    stroke.points.slice(1).forEach((point) => {
      ctx.lineTo(point.x, point.y);
    });

    ctx.stroke();
  });

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
