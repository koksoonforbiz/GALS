import { useState, useRef, useCallback, useEffect } from 'react';
import { ChatbotPanel } from './ChatbotPanel';
import { api } from '../../lib/api';

const STORAGE_KEY = 'chatbot-position';
const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 900;
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 550;

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

function loadPosition(): Position {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const pos = JSON.parse(raw) as Position;
      // Validate bounds
      if (pos.x >= 0 && pos.y >= 0 && pos.width >= MIN_WIDTH && pos.height >= MIN_HEIGHT) {
        return pos;
      }
    }
  } catch {
    // ignore
  }
  return {
    x: Math.max(0, window.innerWidth - DEFAULT_WIDTH - 20),
    y: Math.max(0, window.innerHeight - DEFAULT_HEIGHT - 20),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
}

function savePosition(pos: Position) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function FloatingChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [position, setPosition] = useState<Position>(loadPosition);
  const [preMaxPosition, setPreMaxPosition] = useState<Position | null>(null);
  const [dueCount, setDueCount] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const isResizing = useRef(false);
  const resizeDir = useRef('');
  const dragStart = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const resizeStart = useRef({
    mouseX: 0,
    mouseY: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  });

  // Save position whenever it changes
  useEffect(() => {
    if (!isMaximized) {
      savePosition(position);
    }
  }, [position, isMaximized]);

  // Fetch due cards count periodically
  useEffect(() => {
    const fetchDueCount = async () => {
      try {
        const stats = await api.get<{ dueToday: number }>(
          '/learning-interventions/distributed-practice/stats',
        );
        setDueCount(stats.dueToday);
      } catch {
        // silently fail — user may not be authenticated yet
      }
    };

    void fetchDueCount();
    const interval = setInterval(() => void fetchDueCount(), 5 * 60 * 1000); // refresh every 5 min
    return () => clearInterval(interval);
  }, []);

  // ─── Drag Handlers ──────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // Only start drag when mousedown is on the drag handle header
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      if (!target.closest('.chatbot-drag-handle')) return;

      isDragging.current = true;
      dragStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        posX: position.x,
        posY: position.y,
      };

      e.preventDefault();
    },
    [position.x, position.y],
  );

  // ─── Resize Handlers ───────────────────────────────────

  const handleResizeStart = useCallback(
    (dir: string) => (e: React.MouseEvent) => {
      isResizing.current = true;
      resizeDir.current = dir;
      resizeStart.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        x: position.x,
        y: position.y,
        w: position.width,
        h: position.height,
      };
      e.preventDefault();
      e.stopPropagation();
    },
    [position],
  );

  // ─── Mouse Move & Up (global) ──────────────────────────

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) {
        const dx = e.clientX - dragStart.current.mouseX;
        const dy = e.clientY - dragStart.current.mouseY;

        const newX = clamp(dragStart.current.posX + dx, 0, window.innerWidth - position.width);
        const newY = clamp(
          dragStart.current.posY + dy,
          0,
          window.innerHeight - 40, // Keep at least header visible
        );

        setPosition((prev) => ({ ...prev, x: newX, y: newY }));
      }

      if (isResizing.current) {
        const dx = e.clientX - resizeStart.current.mouseX;
        const dy = e.clientY - resizeStart.current.mouseY;
        const dir = resizeDir.current;
        const s = resizeStart.current;

        let newX = s.x;
        let newY = s.y;
        let newW = s.w;
        let newH = s.h;

        if (dir.includes('e')) newW = s.w + dx;
        if (dir.includes('w')) {
          newW = s.w - dx;
          newX = s.x + dx;
        }
        if (dir.includes('s')) newH = s.h + dy;
        if (dir.includes('n')) {
          newH = s.h - dy;
          newY = s.y + dy;
        }

        newW = clamp(newW, MIN_WIDTH, MAX_WIDTH);
        newH = clamp(newH, MIN_HEIGHT, MAX_HEIGHT);

        // Adjust position if width/height was clamped from left/top resize
        if (dir.includes('w')) {
          newX = s.x + s.w - newW;
        }
        if (dir.includes('n')) {
          newY = s.y + s.h - newH;
        }

        newX = Math.max(0, newX);
        newY = Math.max(0, newY);

        setPosition({ x: newX, y: newY, width: newW, height: newH });
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      isResizing.current = false;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [position.width]);

  // ─── Maximize Toggle ───────────────────────────────────

  const handleToggleMaximize = useCallback(() => {
    if (isMaximized) {
      // Restore
      if (preMaxPosition) {
        setPosition(preMaxPosition);
      }
      setIsMaximized(false);
    } else {
      // Maximize
      setPreMaxPosition(position);
      setPosition({
        x: Math.max(0, window.innerWidth - 600 - 20),
        y: 20,
        width: 600,
        height: Math.min(700, window.innerHeight - 40),
      });
      setIsMaximized(true);
    }
  }, [isMaximized, position, preMaxPosition]);

  // ─── Collapsed State (Floating Button) ─────────────────

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed z-[9999] bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 hover:shadow-xl transition-all flex items-center justify-center text-2xl"
        title="Open Learning Assistant"
      >
        &#128172;
        {dueCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {dueCount > 99 ? '99+' : dueCount}
          </span>
        )}
      </button>
    );
  }

  // ─── Expanded State ────────────────────────────────────

  return (
    <div
      ref={containerRef}
      onMouseDown={handleDragStart}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        width: position.width,
        height: position.height,
        zIndex: 9999,
      }}
      className="flex flex-col rounded-lg shadow-2xl border border-gray-300 overflow-hidden"
    >
      <ChatbotPanel
        onMinimize={() => setIsOpen(false)}
        onToggleMaximize={handleToggleMaximize}
        isMaximized={isMaximized}
      />

      {/* Resize handles */}
      {/* Right */}
      <div
        onMouseDown={handleResizeStart('e')}
        className="absolute right-0 top-0 w-1.5 h-full cursor-e-resize"
      />
      {/* Bottom */}
      <div
        onMouseDown={handleResizeStart('s')}
        className="absolute bottom-0 left-0 w-full h-1.5 cursor-s-resize"
      />
      {/* Left */}
      <div
        onMouseDown={handleResizeStart('w')}
        className="absolute left-0 top-0 w-1.5 h-full cursor-w-resize"
      />
      {/* Top */}
      <div
        onMouseDown={handleResizeStart('n')}
        className="absolute top-0 left-0 w-full h-1.5 cursor-n-resize"
      />
      {/* Bottom-right corner */}
      <div
        onMouseDown={handleResizeStart('se')}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
      />
      {/* Bottom-left corner */}
      <div
        onMouseDown={handleResizeStart('sw')}
        className="absolute bottom-0 left-0 w-4 h-4 cursor-sw-resize"
      />
      {/* Top-right corner */}
      <div
        onMouseDown={handleResizeStart('ne')}
        className="absolute top-0 right-0 w-4 h-4 cursor-ne-resize"
      />
      {/* Top-left corner */}
      <div
        onMouseDown={handleResizeStart('nw')}
        className="absolute top-0 left-0 w-4 h-4 cursor-nw-resize"
      />
    </div>
  );
}
