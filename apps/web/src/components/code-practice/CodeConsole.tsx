import type { PythonRunResult } from '../../lib/pyodideRunner';

interface CodeConsoleProps {
  loading: boolean;
  isFirstRun: boolean;
  result: PythonRunResult | null;
}

/** Renders the real output of a Pyodide run — actual stdout/stderr and,
 *  on failure, the actual Python traceback (never a simulated message). */
export function CodeConsole({ loading, isFirstRun, result }: CodeConsoleProps) {
  if (loading) {
    return (
      <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
        {isFirstRun ? 'Starting Python… (first run only, a few seconds)' : 'Running…'}
      </div>
    );
  }

  if (!result) return null;

  const hasError = result.error !== null;

  return (
    <div
      className={`text-xs font-mono whitespace-pre-wrap rounded-lg p-2.5 border max-h-48 overflow-y-auto ${
        hasError
          ? 'bg-red-50 border-red-200 text-red-700'
          : 'bg-green-50 border-green-200 text-green-800'
      }`}
    >
      {result.stdout && (
        <div>
          <span className="font-sans font-semibold not-italic text-[10px] uppercase tracking-wide opacity-70">
            stdout
          </span>
          <div>{result.stdout}</div>
        </div>
      )}
      {result.stderr && (
        <div className={result.stdout ? 'mt-2' : ''}>
          <span className="font-sans font-semibold not-italic text-[10px] uppercase tracking-wide opacity-70">
            stderr
          </span>
          <div>{result.stderr}</div>
        </div>
      )}
      {result.error && (
        <div className={result.stdout || result.stderr ? 'mt-2' : ''}>
          <span className="font-sans font-semibold not-italic text-[10px] uppercase tracking-wide opacity-70">
            error
          </span>
          <div>{result.error}</div>
        </div>
      )}
      {!result.stdout && !result.stderr && !result.error && (
        <span className="italic text-gray-500 font-sans">Ran with no output.</span>
      )}
    </div>
  );
}
