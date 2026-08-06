import { useState, useCallback } from 'react';
import { Play } from 'lucide-react';
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
 *  ran code in is what the assistant sees. */
export function CodeQuestionMessage({ question, starterCode }: CodeQuestionMessageProps) {
  const { setCodeContext } = usePageContext();
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
      <CodeEditor value={code} onChange={setCode} />
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
