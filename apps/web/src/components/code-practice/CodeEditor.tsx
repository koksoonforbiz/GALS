import { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { Decoration, EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
  /** When set, the editor grows/shrinks with its content (line count)
   *  instead of a fixed height, never going below this. Takes
   *  precedence over `height`. */
  minHeight?: string;
  /** When true, the editor grows to fill all remaining space in its
   *  flex-column parent instead of just sizing to content — for panels
   *  the student can resize larger than the code itself (the
   *  Playground), so extra room becomes more visible code instead of
   *  dead space below a content-sized box. Takes precedence over both
   *  `height` and `minHeight`; requires a flex-col parent. */
  fill?: boolean;
  /** 0-indexed, inclusive line range to highlight — used by DBox's
   *  stage-2 hover-link between a step-tree node and the code lines it
   *  maps to. Computed purely from `value` (no CodeMirror state access
   *  needed), so it's cheap to recompute on every hover. Additive only:
   *  callers that never pass this see no behavior change. */
  highlightedRange?: { start: number; end: number } | null;
}

const highlightTheme = EditorView.baseTheme({
  '.cm-dbox-highlight': { backgroundColor: 'rgba(147, 51, 234, 0.14)' },
});

function buildHighlightExtension(
  value: string,
  range: { start: number; end: number } | null | undefined,
): Extension {
  if (!range) return [];
  const lines = value.split('\n');
  if (lines.length === 0) return [];
  const start = Math.max(0, Math.min(range.start, lines.length - 1));
  const end = Math.max(start, Math.min(range.end, lines.length - 1));

  let offset = 0;
  const marks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (i >= start && i <= end) {
      marks.push(Decoration.line({ attributes: { class: 'cm-dbox-highlight' } }).range(offset));
    }
    offset += line.length + 1; // +1 for the newline this split() consumed
  }
  return [highlightTheme, EditorView.decorations.of(Decoration.set(marks))];
}

/** Thin shared wrapper around CodeMirror, used by both the inline
 *  code-question bubble and the standalone Playground so editor config
 *  lives in exactly one place. */
export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  height,
  minHeight,
  fill = false,
  highlightedRange,
}: CodeEditorProps) {
  const highlightExtension = useMemo(
    () => buildHighlightExtension(value, highlightedRange),
    [value, highlightedRange],
  );

  return (
    <CodeMirror
      value={value}
      height={fill ? '100%' : minHeight ? undefined : (height ?? '160px')}
      minHeight={fill ? undefined : minHeight}
      extensions={[python(), highlightExtension]}
      editable={!readOnly}
      readOnly={readOnly}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly }}
      onChange={onChange}
      className={`text-sm rounded-lg overflow-hidden border border-gray-300 ${fill ? 'flex-1 min-h-0' : 'shrink-0'}`}
    />
  );
}
