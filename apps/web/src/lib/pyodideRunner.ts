import type { PyodideInterface } from 'pyodide';

// Lazy singleton: the ~11MB WASM runtime + stdlib only downloads on the
// first Run click anywhere in the app (not on page load), then stays
// cached in memory for the rest of the session. Served from
// public/pyodide/ (same origin) rather than a CDN — see
// apps/web/scripts/copy-pyodide-assets.mjs.
let pyodidePromise: Promise<PyodideInterface> | null = null;

function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = import('pyodide').then(async ({ loadPyodide }) => {
      const pyodide = await loadPyodide({ indexURL: '/pyodide/' });
      // CPython's input(prompt) always writes `prompt` to stdout itself,
      // then blocks reading stdin — it never passes the text to whatever
      // reads stdin. Since we redirect stdout into our own buffer (below)
      // for the console, Pyodide's default browser fallback for stdin
      // ends up popping a window.prompt() with no visible message. Fix:
      // replace input() outright so the prompt text goes straight to
      // window.prompt()'s own argument instead of through stdout.
      pyodide.runPython(`
import builtins
from js import prompt as _js_prompt

def _browser_input(prompt=''):
    result = _js_prompt(prompt)
    if result is None:
        raise EOFError('input() cancelled')
    return result

builtins.input = _browser_input
`);
      return pyodide;
    });
  }
  return pyodidePromise;
}

/** True once the interpreter has already been loaded this session — lets
 *  the UI show a "Starting Python…" state only on the very first run. */
export function isPyodideReady(): boolean {
  return pyodidePromise !== null;
}

export interface PythonRunResult {
  stdout: string;
  stderr: string;
  /** A real Python traceback string, or null if the code ran cleanly. */
  error: string | null;
}

/** The student's most recent Python run, wherever it happened — the
 *  inline code-question widget or the free-to-use Playground. Shared via
 *  PageContext (see setCodeContext) so the chatbot can see it on the
 *  next message, regardless of which surface produced it. */
export interface CodeContext {
  /** The exercise question, or a fixed label like "Playground" when the
   *  run wasn't tied to a generated exercise. */
  question: string;
  code: string;
  stdout: string;
  stderr: string;
  error: string | null;
}

/** Runs student code in the browser's own WASM sandbox — nothing here
 *  ever touches the backend. Captures real stdout/stderr, and on a
 *  Python exception returns the actual traceback (not a simulated
 *  message) as `error`. */
export async function runPython(code: string): Promise<PythonRunResult> {
  const pyodide = await getPyodide();

  let stdout = '';
  let stderr = '';
  pyodide.setStdout({
    batched: (chunk) => {
      stdout += stdout ? `\n${chunk}` : chunk;
    },
  });
  pyodide.setStderr({
    batched: (chunk) => {
      stderr += stderr ? `\n${chunk}` : chunk;
    },
  });

  try {
    await pyodide.runPythonAsync(code);
    return { stdout, stderr, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { stdout, stderr, error: message };
  } finally {
    // Reset to defaults so a later run doesn't keep appending into a
    // stale closure from this call.
    pyodide.setStdout({});
    pyodide.setStderr({});
  }
}
