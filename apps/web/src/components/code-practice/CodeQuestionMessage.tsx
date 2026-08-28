import { useState, useCallback } from 'react';
import { Play, ExternalLink } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { CodeConsole } from './CodeConsole';
import { runPython, isPyodideReady, type PythonRunResult } from '../../lib/pyodideRunner';
import { usePageContext } from '../../contexts/PageContext';

interface CodeQuestionMessageProps {
  question: string;
  starterCode: string;
}

/** Renders inline in a chat bubble — a coding exercise the assistant
 *  generated because the student asked for one. Runs entirely
 *  client-side via Pyodide; there's no grading, so there's no Submit,
 *  just Run. Reports each run into the shared PageContext.codeContext so
 *  the chatbot can see it on the next message — same mechanism the
 *  standalone Playground uses, so whichever surface the student last
 *  ran code in is what the assistant sees. "Load into Playground" is a
 *  deliberate, explicit action (not automatic) — it hands the student's
 *  current edits over to the bigger Playground editor and expands it if
 *  collapsed, but never happens without the student choosing it, so it
 *  never silently overwrites whatever they were already doing there. */
export function CodeQuestionMessage({ question, starterCode }: CodeQuestionMessageProps) {
  const { setCodeContext, loadPlaygroundCode } = usePageContext();
  const [code, setCode] = useState(starterCode);
  const [running, setRunning] = useState(false);
  const [firstRunEver] = useState(() => !isPyodideReady());
  const [result, setResult] = useState<PythonRunResult | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const runResult = await runPython(code);
      setResult(runResult);
      setCodeContext({
        question,
        code,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        error: runResult.error,
      });
    } finally {
      setRunning(false);
    }
  }, [code, question, setCodeContext]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <p className="shrink-0 text-sm font-medium">{question}</p>
      <CodeEditor value={code} onChange={setCode} minHeight="40px" />
      <div className="shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void handleRun()}
          disabled={running}
          className="flex items-center gap-1.5 text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <Play size={12} />
          {running ? 'Running…' : 'Run'}
        </button>
        <button
          type="button"
          onClick={() => loadPlaygroundCode(code, question)}
          className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          title="Open this code in the bigger Playground editor below"
        >
          <ExternalLink size={12} />
          Load into Playground
        </button>
      </div>
      {(running || result) && (
        <CodeConsole loading={running} isFirstRun={firstRunEver} result={result} />
      )}
    </div>
  );
}
