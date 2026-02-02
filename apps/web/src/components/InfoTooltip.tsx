import { useState, useRef, useEffect, useCallback } from 'react';

// ─── InfoTooltip ────────────────────────────────────────
// A small "ⓘ" icon that shows a tooltip on hover/focus.

interface InfoTooltipProps {
  text: string;
  warn?: boolean;
  /** Position relative to the icon */
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export function InfoTooltip({ text, warn, position = 'top' }: InfoTooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (!visible || !iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    const pad = 8;
    let top = 0;
    let left = 0;
    switch (position) {
      case 'top':
        top = rect.top - pad;
        left = rect.left + rect.width / 2;
        break;
      case 'bottom':
        top = rect.bottom + pad;
        left = rect.left + rect.width / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2;
        left = rect.left - pad;
        break;
      case 'right':
        top = rect.top + rect.height / 2;
        left = rect.right + pad;
        break;
    }
    setCoords({ top, left });
  }, [visible, position]);

  const positionClasses: Record<string, string> = {
    top: '-translate-x-1/2 -translate-y-full',
    bottom: '-translate-x-1/2',
    left: '-translate-x-full -translate-y-1/2',
    right: '-translate-y-1/2',
  };

  return (
    <>
      <span
        ref={iconRef}
        role="img"
        aria-label="info"
        tabIndex={0}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={`inline-flex items-center justify-center w-4 h-4 text-[10px] leading-none rounded-full cursor-help select-none
          ${warn ? 'bg-amber-100 text-amber-600' : 'bg-gray-200 text-gray-500'}
          hover:bg-blue-100 hover:text-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-400`}
      >
        i
      </span>
      {visible && coords && (
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 9999 }}
          className={`${positionClasses[position]} pointer-events-none max-w-xs px-3 py-2 text-xs leading-relaxed rounded-lg shadow-lg border
            ${warn ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-gray-900 border-gray-700 text-gray-100'}`}
        >
          {text}
        </div>
      )}
    </>
  );
}

// ─── ButtonWithInfo ─────────────────────────────────────
// A button with a small "ⓘ" icon in the top-right corner.

interface ButtonWithInfoProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  infoText: string;
  infoWarn?: boolean;
  infoPosition?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}

export function ButtonWithInfo({
  infoText,
  infoWarn,
  infoPosition = 'top',
  children,
  className = '',
  ...rest
}: ButtonWithInfoProps) {
  return (
    <span className="relative inline-flex">
      <button className={className} {...rest}>
        {children}
      </button>
      <span className="absolute -top-1.5 -right-1.5">
        <InfoTooltip text={infoText} warn={infoWarn} position={infoPosition} />
      </span>
    </span>
  );
}
