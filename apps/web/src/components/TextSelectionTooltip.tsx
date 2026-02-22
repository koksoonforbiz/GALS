interface TextSelectionTooltipProps {
  selectionRect: DOMRect;
  onClick: () => void;
}

/**
 * Floating tooltip that appears near selected text.
 * Shows a button to trigger learning intervention.
 */
export function TextSelectionTooltip({
  selectionRect,
  onClick,
}: TextSelectionTooltipProps) {
  // Position the tooltip above the selection, centered horizontally
  const tooltipStyle: React.CSSProperties = {
    position: 'fixed',
    top: selectionRect.top - 48, // 48px above selection
    left: selectionRect.left + selectionRect.width / 2,
    transform: 'translateX(-50%)',
    zIndex: 50,
  };

  // If tooltip would go off the top of the screen, show it below instead
  if (selectionRect.top < 60) {
    tooltipStyle.top = selectionRect.bottom + 8;
  }

  return (
    <div style={tooltipStyle}>
      <button
        onClick={onClick}
        className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg shadow-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
      >
        <span>📚</span>
        <span>Apply Learning Strategy</span>
      </button>
      {/* Arrow pointing to selection */}
      <div
        className="absolute left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-r-8 border-t-8 border-l-transparent border-r-transparent border-t-blue-600"
        style={{
          bottom: selectionRect.top < 60 ? 'auto' : '-8px',
          top: selectionRect.top < 60 ? '-8px' : 'auto',
          transform:
            selectionRect.top < 60
              ? 'translateX(-50%) rotate(180deg)'
              : 'translateX(-50%)',
        }}
      />
    </div>
  );
}
