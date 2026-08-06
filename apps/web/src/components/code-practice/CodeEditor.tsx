import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';

interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: string;
}

/** Thin shared wrapper around CodeMirror, used by both the inline
 *  code-question bubble and the standalone Playground so editor config
 *  lives in exactly one place. */
export function CodeEditor({
  value,
  onChange,
  readOnly = false,
  height = '160px',
}: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      height={height}
      extensions={[python()]}
      editable={!readOnly}
      readOnly={readOnly}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: !readOnly }}
      onChange={onChange}
      className="shrink-0 text-sm rounded-lg overflow-hidden border border-gray-300"
    />
  );
}
