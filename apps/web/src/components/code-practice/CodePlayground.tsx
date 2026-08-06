import { useState, useCallback } from 'react';
import { Play } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { CodeConsole } from './CodeConsole';
import { runPython, isPyodideReady, type PythonRunResult } from '../../lib/pyodideRunner';
import { usePageContext } from '../../contexts/PageContext';

const DEFAULT_SNIPPET = '# Try anything\nprint("Hello, world!")\n';

/** Standalone, always-visible scratch space — a free-to-use Python
 *  editor independent of the chat and of any code question. Runs
 *  entirely client-side via Pyodide, same as CodeQuestionMessage, but
 *  with no backend call at all: this component never touches the API.
 *  Each run is still reported into the shared PageContext.codeContext so
 *  the chatbot can see what the student tried here too — not just in the
 *  inline code-question widget. */
export function CodePlayground() {
  const { setCodeContext } = usePageContext();
  const [code, setCode] = useState(DEFAULT_SNIPPET);
  const [running, setRunning] = useState(false);
  const [firstRunEver] = useState(() => !isPyodideReady());
  const [result, setResult] = useState<PythonRunResult | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const runResult = await runPython(code);
      setResult(runResult);
      setCodeContext({
        question: 'Playground (free-form code, not a generated exercise)',
        code,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        error: runResult.error,
      });
    } finally {
      setRunning(false);
    }
  }, [code, setCodeContext]);

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <div className="shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Playground · Python
        </span>
        <button
          type="button"
          onClick={() => {
            setCode(DEFAULT_SNIPPET);
            setResult(null);
          }}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          Reset
        </button>
      </div>
      <CodeEditor value={code} onChange={setCode} height="360px" />
      <button
        type="button"
        onClick={() => void handleRun()}
        disabled={running}
        className="shrink-0 self-start flex items-center gap-1.5 text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        <Play size={12} />
        {running ? 'Running…' : 'Run'}
      </button>
      {(running || result) && (
        <CodeConsole loading={running} isFirstRun={firstRunEver} result={result} />
      )}
    </div>
  );
}
