import { useState, useCallback, useEffect } from 'react';
import { Play, GitBranch } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { CodeConsole } from './CodeConsole';
import { DecompositionPanel } from './DecompositionPanel';
import { runPython, isPyodideReady, type PythonRunResult } from '../../lib/pyodideRunner';
import { usePageContext } from '../../contexts/PageContext';

const DEFAULT_SNIPPET = '# Try anything\nprint("Hello, world!")\n';
const GENERIC_QUESTION_LABEL = 'Playground (free-form code, not a generated exercise)';

/** Standalone, always-visible scratch space — a free-to-use Python
 *  editor independent of the chat and of any code question. Runs
 *  entirely client-side via Pyodide, same as CodeQuestionMessage, but
 *  with no backend call at all: this component never touches the API.
 *  Each run is still reported into the shared PageContext.codeContext so
 *  the chatbot can see what the student tried here too — not just in the
 *  inline code-question widget. Also listens for `pendingPlaygroundLoad`
 *  — the "Load into Playground" button on a chat exercise sets this to
 *  hand its code + question over here, overwriting whatever was in the
 *  editor. The editor uses `fill` so dragging the drawer bigger becomes
 *  more visible code instead of dead space below a content-sized box. */
export function CodePlayground() {
  const { setCodeContext, pendingPlaygroundLoad, clearPendingPlaygroundCode } = usePageContext();
  const [code, setCode] = useState(DEFAULT_SNIPPET);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [firstRunEver] = useState(() => !isPyodideReady());
  const [result, setResult] = useState<PythonRunResult | null>(null);
  const [decompositionOn, setDecompositionOn] = useState(false);
  const [highlightedRange, setHighlightedRange] = useState<{ start: number; end: number } | null>(
    null,
  );

  useEffect(() => {
    if (pendingPlaygroundLoad === null) return;
    setCode(pendingPlaygroundLoad.code);
    setActiveQuestion(pendingPlaygroundLoad.question);
    setResult(null);
    clearPendingPlaygroundCode();
  }, [pendingPlaygroundLoad, clearPendingPlaygroundCode]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const runResult = await runPython(code);
      setResult(runResult);
      setCodeContext({
        question: activeQuestion ?? GENERIC_QUESTION_LABEL,
        code,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        error: runResult.error,
      });
    } finally {
      setRunning(false);
    }
  }, [code, activeQuestion, setCodeContext]);

  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-y-auto">
      <div className="shrink-0 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Playground · Python
        </span>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDecompositionOn((v) => !v)}
            title="Break this problem into a step tree with guided, LLM-checked feedback"
            className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-lg border transition-colors ${
              decompositionOn
                ? 'bg-purple-600 text-white border-purple-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <GitBranch size={12} />
            Guided Decomposition
          </button>
          <button
            type="button"
            onClick={() => {
              setCode(DEFAULT_SNIPPET);
              setActiveQuestion(null);
              setResult(null);
            }}
            className="text-xs text-gray-500 hover:text-gray-700"
          >
            Reset
          </button>
        </div>
      </div>
      {activeQuestion && (
        <p className="shrink-0 text-sm font-medium bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
          {activeQuestion}
        </p>
      )}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3">
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running}
            className="shrink-0 self-start flex items-center gap-1.5 text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            <Play size={12} />
            {running ? 'Running…' : 'Run'}
          </button>
          <CodeEditor value={code} onChange={setCode} fill highlightedRange={highlightedRange} />
          {(running || result) && (
            <CodeConsole loading={running} isFirstRun={firstRunEver} result={result} />
          )}
        </div>
        {decompositionOn && (
          <div className="flex-1 min-h-0">
            <DecompositionPanel
              code={code}
              loadedQuestion={activeQuestion}
              onApplyCode={setCode}
              onHighlightRange={setHighlightedRange}
            />
          </div>
        )}
      </div>
    </div>
  );
}
