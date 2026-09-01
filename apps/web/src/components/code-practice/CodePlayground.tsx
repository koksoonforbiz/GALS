import { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Maximize2, Minimize2 } from 'lucide-react';
import { CodeEditor } from './CodeEditor';
import { CodeConsole } from './CodeConsole';
import { runPython, isPyodideReady, type PythonRunResult } from '../../lib/pyodideRunner';
import { usePageContext } from '../../contexts/PageContext';

const DEFAULT_SNIPPET = '# Try anything\nprint("Hello, world!")\n';
const GENERIC_QUESTION_LABEL = 'Playground (free-form code, not a generated exercise)';

// Editor/console split. Same MouseDown/MouseMove/localStorage pattern as
// the sidebar and Playground-height resizers in StudentCourseViewPage —
// horizontal this time. Only takes effect at the md: breakpoint, where
// editor and console actually sit side by side (flex-col below that).
const CONSOLE_WIDTH_STORAGE_KEY = 'gals.codePlayground.consoleWidth';
const CONSOLE_MIN_WIDTH = 200;
const CONSOLE_MAX_WIDTH = 640;
const CONSOLE_DEFAULT_WIDTH = 320; // matches the old fixed md:w-80

function loadConsoleWidth(): number {
  try {
    const raw = localStorage.getItem(CONSOLE_WIDTH_STORAGE_KEY);
    if (!raw) return CONSOLE_DEFAULT_WIDTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return CONSOLE_DEFAULT_WIDTH;
    return Math.min(Math.max(n, CONSOLE_MIN_WIDTH), CONSOLE_MAX_WIDTH);
  } catch {
    // localStorage can throw in private-browsing modes / sandboxed iframes.
    return CONSOLE_DEFAULT_WIDTH;
  }
}

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
 *  more visible code instead of dead space below a content-sized box.
 *  Owns its own collapse/expand toggle (reading codePlaygroundCollapsed
 *  from PageContext, same state StudentCourseViewPage's drag-resize
 *  handle already checks) so there's no separate outer header row just
 *  for that one button — collapsing hides everything below this
 *  toolbar, leaving just the compact title/toggle strip.
 *
 *  DBox's "Guided Decomposition" used to live here as a toggle; it now
 *  triggers from the chatbot's "Stepwise Learning" strategy instead (see
 *  ChatbotPanel's `mode === 'stepwise-learning'` branch and
 *  interventions/CodeDecompositionView.tsx), so this component is back
 *  to being just the plain scratch editor. */
export function CodePlayground() {
  const {
    setCodeContext,
    pendingPlaygroundLoad,
    clearPendingPlaygroundCode,
    codePlaygroundCollapsed,
    setCodePlaygroundCollapsed,
  } = usePageContext();
  const [code, setCode] = useState(DEFAULT_SNIPPET);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [firstRunEver] = useState(() => !isPyodideReady());
  const [result, setResult] = useState<PythonRunResult | null>(null);
  const [consoleWidth, setConsoleWidth] = useState<number>(() => loadConsoleWidth());
  const isResizingConsole = useRef(false);
  const consoleResizeStart = useRef({ mouseX: 0, startWidth: 0 });

  const handleConsoleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      isResizingConsole.current = true;
      consoleResizeStart.current = { mouseX: e.clientX, startWidth: consoleWidth };
      e.preventDefault();
    },
    [consoleWidth],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isResizingConsole.current) return;
      // Handle sits left of the console; dragging it left (negative dx)
      // grows the console, dragging right shrinks it back toward the editor.
      const dx = e.clientX - consoleResizeStart.current.mouseX;
      const next = Math.min(
        Math.max(consoleResizeStart.current.startWidth - dx, CONSOLE_MIN_WIDTH),
        CONSOLE_MAX_WIDTH,
      );
      setConsoleWidth(next);
    };
    const handleUp = () => {
      if (!isResizingConsole.current) return;
      isResizingConsole.current = false;
      try {
        localStorage.setItem(CONSOLE_WIDTH_STORAGE_KEY, String(consoleWidth));
      } catch {
        // ignore storage errors
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [consoleWidth]);

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
    <div
      className={
        codePlaygroundCollapsed
          ? 'flex flex-col gap-2 p-3'
          : 'flex flex-col gap-2 p-3 h-full overflow-y-auto'
      }
    >
      <div className="shrink-0 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 shrink-0">
            Playground · Python
          </span>
          {!codePlaygroundCollapsed && (
            <button
              type="button"
              onClick={() => void handleRun()}
              disabled={running}
              className="shrink-0 flex items-center gap-1.5 text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              <Play size={12} />
              {running ? 'Running…' : 'Run'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {!codePlaygroundCollapsed && (
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
          )}
          <button
            type="button"
            onClick={() => setCodePlaygroundCollapsed(!codePlaygroundCollapsed)}
            className="text-gray-400 hover:text-gray-700"
            title={codePlaygroundCollapsed ? 'Expand' : 'Collapse'}
            aria-label={
              codePlaygroundCollapsed ? 'Expand code playground' : 'Collapse code playground'
            }
          >
            {codePlaygroundCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
          </button>
        </div>
      </div>
      {!codePlaygroundCollapsed && (
        <>
          {activeQuestion && (
            <p className="shrink-0 text-sm font-medium bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
              {activeQuestion}
            </p>
          )}
          <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3">
            <CodeEditor value={code} onChange={setCode} fill />
            {(running || result) && (
              <>
                {/* Drag handle only meaningful at md:+, where editor and
                    console actually sit side by side (flex-col below
                    that, so there's nothing to split horizontally). */}
                <div
                  onMouseDown={handleConsoleResizeStart}
                  className="hidden md:block w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors rounded-full"
                  title="Drag to resize the console"
                />
                <div
                  className="shrink-0 min-h-0 overflow-y-auto md:w-[var(--console-width)]"
                  style={{ '--console-width': `${consoleWidth}px` } as React.CSSProperties}
                >
                  <CodeConsole loading={running} isFirstRun={firstRunEver} result={result} />
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
