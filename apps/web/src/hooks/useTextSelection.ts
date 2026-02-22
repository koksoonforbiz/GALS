import { useState, useCallback, useEffect, RefObject } from 'react';

interface TextSelectionState {
  selectedText: string;
  selectionRect: DOMRect | null;
}

interface UseTextSelectionReturn extends TextSelectionState {
  clearSelection: () => void;
}

const MIN_SELECTION_LENGTH = 20;

/**
 * Custom hook to track text selection within a container element.
 * Only triggers when selection is >= 20 characters.
 */
export function useTextSelection(
  containerRef: RefObject<HTMLElement>,
): UseTextSelectionReturn {
  const [state, setState] = useState<TextSelectionState>({
    selectedText: '',
    selectionRect: null,
  });

  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setState({ selectedText: '', selectionRect: null });
      return;
    }

    const text = selection.toString().trim();
    if (text.length < MIN_SELECTION_LENGTH) {
      setState({ selectedText: '', selectionRect: null });
      return;
    }

    // Check if selection is within the container
    const container = containerRef.current;
    if (!container) {
      setState({ selectedText: '', selectionRect: null });
      return;
    }

    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;

    if (!anchorNode || !focusNode) {
      setState({ selectedText: '', selectionRect: null });
      return;
    }

    // Verify both ends of selection are within container
    const isAnchorInContainer = container.contains(anchorNode);
    const isFocusInContainer = container.contains(focusNode);

    if (!isAnchorInContainer || !isFocusInContainer) {
      setState({ selectedText: '', selectionRect: null });
      return;
    }

    // Get the bounding rect of the selection
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    setState({
      selectedText: text,
      selectionRect: rect,
    });
  }, [containerRef]);

  const clearSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setState({ selectedText: '', selectionRect: null });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('mouseup', handleMouseUp);

    // Also clear selection when clicking outside
    const handleClickOutside = (e: MouseEvent) => {
      if (container && !container.contains(e.target as Node)) {
        clearSelection();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [containerRef, handleMouseUp, clearSelection]);

  return {
    ...state,
    clearSelection,
  };
}
