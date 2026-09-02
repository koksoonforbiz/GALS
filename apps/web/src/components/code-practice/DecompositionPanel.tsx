import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, FileCode2, CheckCircle2, Flag, Eye, EyeOff, Play } from 'lucide-react';
import { api } from '../../lib/api';
import { usePageContext } from '../../contexts/PageContext';
import { StepTree, type StepNode, type TreeActions } from './StepTree';
import { CodeEditor } from './CodeEditor';
import { CodeConsole } from './CodeConsole';
import { runPython, isPyodideReady, type PythonRunResult } from '../../lib/pyodideRunner';

interface DecompositionPanelProps {
  /** Stage-2 (implementation) editor contents — DecompositionPanel owns
   *  its own editor once implementation starts, but the string itself is
   *  held by the parent so it survives this component staying mounted
   *  across session resets. */
  code: string;
  /** The question text this view was launched for — the session is
   *  always generated for exactly this question (see `handleStart`). */
  loadedQuestion: string | null;
  /** Pushes new code up to the parent — called on every edit in Stage 2,
   *  and once by "Copy to Comments". */
  onApplyCode: (code: string) => void;
}

type Stage = 'formation' | 'implementation';

interface GenerateResponse {
  sessionId: string;
  problem: { question: string; starterCode: string; language: string };
  stage: Stage;
  nodes: StepNode[];
}

interface TreeResponse {
  nodes: StepNode[];
  stage: Stage;
}

type MutateAction =
  | { action: 'add'; parentId: string | null; content: string }
  | { action: 'edit'; nodeId: string; content: string }
  | { action: 'delete'; nodeId: string }
  | { action: 'reorder'; nodeId: string; direction: 'up' | 'down' };

type Phase = 'idle' | 'starting' | 'tree' | 'completed' | 'error';
type Busy = 'check' | 'advance' | 'copy' | 'match' | 'complete' | 'revealSolution' | null;

function storageKey(courseId: string) {
  return `code_decomp_session_${courseId}`;
}

/** DBox session shell mounted inside CodePlayground when the "Guided
 *  Decomposition" toggle is on. Covers the full plan: start a session,
 *  build/edit a step tree (from code or by hand), check it, per-node
 *  hints and reveal, the formation→implementation gate, and stage-2
 *  code-vs-tree matching (Copy to Comments / Check Match / reveal code /
 *  hover-linked line highlighting). */
export function DecompositionPanel({ code, loadedQuestion, onApplyCode }: DecompositionPanelProps) {
  const { courseId, activeCodeQuestion, setCodeContext } = usePageContext();
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('formation');
  const [nodes, setNodes] = useState<StepNode[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [nodeBusy, setNodeBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completionSummary, setCompletionSummary] = useState<{
    totalNodes: number;
    correctNodes: number;
  } | null>(null);
  // "Show Complete Tree/Solution" preview — never touches `nodes`/the
  // real editor. Cached per-stage so toggling back on after the first
  // reveal doesn't re-fetch; a stage change invalidates both caches.
  const [revealedNodes, setRevealedNodes] = useState<StepNode[] | null>(null);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);
  const [showingRevealed, setShowingRevealed] = useState(false);
  // True once `loadedQuestion` no longer matches the active session's
  // locked-in problem — e.g. the student asked chat for a different
  // exercise while this session was still in progress. Session progress
  // is never silently discarded; this only surfaces a banner offering
  // to switch.
  const [questionChanged, setQuestionChanged] = useState(false);
  // Stage-2 "Run" — same client-side Pyodide flow the old standalone
  // Playground editor used, now scoped to just the implementation stage.
  const [highlightedRange, setHighlightedRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [running, setRunning] = useState(false);
  const [firstRunEver] = useState(() => !isPyodideReady());
  const [runResult, setRunResult] = useState<PythonRunResult | null>(null);

  const handleStart = useCallback(async () => {
    if (!courseId) return;
    setPhase('starting');
    setErrorMessage(null);
    try {
      // Prefer whatever's actually visible right now over
      // PageContext.activeCodeQuestion — the latter is just "whatever
      // chat most recently generated" and can silently drift from
      // `loadedQuestion` (e.g. a second exercise was generated but this
      // view is still showing the first one).
      const result = await api.post<GenerateResponse>('/code-decomposition/generate', {
        courseId,
        question: loadedQuestion ?? activeCodeQuestion?.question,
        starterCode: loadedQuestion ? code : activeCodeQuestion?.starterCode,
        language: activeCodeQuestion?.language,
      });
      setSessionId(result.sessionId);
      setProblem(result.problem.question);
      setStage(result.stage);
      setNodes(result.nodes);
      setPhase('tree');
      localStorage.setItem(
        storageKey(courseId),
        JSON.stringify({ sessionId: result.sessionId, timestamp: Date.now() }),
      );
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start a session.');
      setPhase('error');
    }
  }, [courseId, activeCodeQuestion, loadedQuestion, code]);

  // Resume an in-progress session for this course, if one exists and
  // matches the current question — otherwise start a fresh one
  // automatically (no "Start Guided Decomposition" button to click).
  useEffect(() => {
    if (!courseId) return;
    const stored = localStorage.getItem(storageKey(courseId));
    let parsed: { sessionId: string } | null = null;
    if (stored) {
      try {
        parsed = JSON.parse(stored);
      } catch {
        localStorage.removeItem(storageKey(courseId));
      }
    }
    if (!parsed?.sessionId) {
      void handleStart();
      return;
    }

    setPhase('starting');
    api
      .get<{
        sessionId: string;
        status: string;
        problem: { question: string };
        stage: Stage;
        nodes: StepNode[];
      }>(`/code-decomposition/${parsed.sessionId}`)
      .then((session) => {
        if (session.status === 'COMPLETED') {
          localStorage.removeItem(storageKey(courseId));
          void handleStart();
          return;
        }
        // A resumed session for a DIFFERENT question than the one
        // currently loaded is stale — e.g. this component just mounted
        // fresh for a newly generated question, but an older question's
        // session was still sitting in localStorage. Discard it and
        // start a fresh session for the current question instead of
        // showing the stale tree.
        if (loadedQuestion && session.problem.question !== loadedQuestion) {
          localStorage.removeItem(storageKey(courseId));
          void handleStart();
          return;
        }
        setSessionId(session.sessionId);
        setProblem(session.problem.question);
        setStage(session.stage);
        setNodes(session.nodes);
        setPhase('tree');
      })
      .catch(() => {
        localStorage.removeItem(storageKey(courseId));
        void handleStart();
      });
    // Deliberately only re-runs on courseId change (a fresh mount) — this
    // resumes (or auto-starts) once, then the effect below watches for
    // the loaded question moving on afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // Live-watch: if the student asks chat for a different exercise while
  // this session is still open, flag it rather than silently ignoring it
  // or silently switching (which would drop tree/code progress).
  useEffect(() => {
    if (phase !== 'tree' || !problem || !loadedQuestion) return;
    if (loadedQuestion !== problem) setQuestionChanged(true);
  }, [loadedQuestion, problem, phase]);

  // Debounced sync of the Playground's current code to the backend
  // during implementation, so Check Match always evaluates fresh code
  // even before the student clicks Run.
  useEffect(() => {
    if (!sessionId || stage !== 'implementation') return;
    const timer = setTimeout(() => {
      void api.patch(`/code-decomposition/${sessionId}/code`, { code }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [sessionId, stage, code]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    try {
      const result = await runPython(code);
      setRunResult(result);
      setCodeContext({
        question: problem ?? '',
        code,
        stdout: result.stdout,
        stderr: result.stderr,
        error: result.error,
      });
    } finally {
      setRunning(false);
    }
  }, [code, problem, setCodeContext]);

  const handleCheckTree = useCallback(async () => {
    if (!sessionId) return;
    setBusy('check');
    setErrorMessage(null);
    try {
      const result = await api.post<TreeResponse>(`/code-decomposition/${sessionId}/check-tree`);
      setNodes(result.nodes);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to check the step tree.');
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  const handleAdvanceStage = useCallback(async () => {
    if (!sessionId) return;
    setBusy('advance');
    setErrorMessage(null);
    try {
      const result = await api.patch<{ stage: Stage }>(
        `/code-decomposition/${sessionId}/advance-stage`,
        {},
      );
      setStage(result.stage);
      // The backend resets every node's status/hints for the new stage.
      const session = await api.get<{ nodes: StepNode[] }>(`/code-decomposition/${sessionId}`);
      setNodes(session.nodes);
      // Stage-1's revealed tree isn't a valid preview once in stage 2.
      setRevealedNodes(null);
      setRevealedCode(null);
      setShowingRevealed(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to move to implementation.');
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  const handleCopyToComments = useCallback(async () => {
    if (!sessionId) return;
    setBusy('copy');
    setErrorMessage(null);
    try {
      // Make sure the backend has the freshest editor contents before it
      // computes the comment block against `studentCode`.
      await api.patch(`/code-decomposition/${sessionId}/code`, { code });
      const result = await api.post<{ code: string; nodeLineMap: Record<string, number> }>(
        `/code-decomposition/${sessionId}/copy-to-comments`,
      );
      onApplyCode(result.code);
      const session = await api.get<{ nodes: StepNode[] }>(`/code-decomposition/${sessionId}`);
      setNodes(session.nodes);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to copy steps into comments.');
    } finally {
      setBusy(null);
    }
  }, [sessionId, code, onApplyCode]);

  const handleCheckMatch = useCallback(async () => {
    if (!sessionId) return;
    setBusy('match');
    setErrorMessage(null);
    try {
      const result = await api.post<{ nodes: StepNode[] }>(
        `/code-decomposition/${sessionId}/check-match`,
      );
      setNodes(result.nodes);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to check your code against the tree.',
      );
    } finally {
      setBusy(null);
    }
  }, [sessionId]);

  const handleComplete = useCallback(async () => {
    if (!sessionId || !courseId) return;
    setBusy('complete');
    setErrorMessage(null);
    try {
      const result = await api.post<{ totalNodes: number; correctNodes: number }>(
        `/code-decomposition/${sessionId}/complete`,
      );
      localStorage.removeItem(storageKey(courseId));
      setCompletionSummary({ totalNodes: result.totalNodes, correctNodes: result.correctNodes });
      setPhase('completed');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to finish the session.');
    } finally {
      setBusy(null);
    }
  }, [sessionId, courseId]);

  const handleStartNew = useCallback(() => {
    setPhase('idle');
    setSessionId(null);
    setProblem(null);
    setStage('formation');
    setNodes([]);
    setCompletionSummary(null);
    setRevealedNodes(null);
    setRevealedCode(null);
    setShowingRevealed(false);
    setQuestionChanged(false);
  }, []);

  const handleSwitchToNewQuestion = useCallback(() => {
    handleStartNew();
    void handleStart();
  }, [handleStartNew, handleStart]);

  // Toggle: off→on fetches (or reuses a cached) ideal answer and shows it
  // in place of the real tree/code; on→off just switches the view back.
  // Never touches `nodes`/the real editor — the student's own work is
  // never at risk.
  const handleToggleReveal = useCallback(async () => {
    if (showingRevealed) {
      setShowingRevealed(false);
      return;
    }
    if (!sessionId) return;
    if (stage === 'formation' && revealedNodes) {
      setShowingRevealed(true);
      return;
    }
    if (stage === 'implementation' && revealedCode) {
      setShowingRevealed(true);
      return;
    }
    setBusy('revealSolution');
    setErrorMessage(null);
    try {
      const result = await api.post<{ stage: Stage; nodes: StepNode[]; code?: string }>(
        `/code-decomposition/${sessionId}/reveal-solution`,
      );
      if (result.stage === 'formation') {
        setRevealedNodes(result.nodes);
      } else if (result.code) {
        setRevealedCode(result.code);
      }
      setShowingRevealed(true);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to reveal the complete solution.',
      );
    } finally {
      setBusy(null);
    }
  }, [sessionId, stage, showingRevealed, revealedNodes, revealedCode]);

  // Persists the previewed tree as the student's own (all marked
  // Correct) and immediately advances — "I'll take this one" instead of
  // manually retyping what was already shown.
  const handleAcceptRevealedTree = useCallback(async () => {
    if (!sessionId || !revealedNodes) return;
    setBusy('advance');
    setErrorMessage(null);
    try {
      await api.patch(`/code-decomposition/${sessionId}/adopt-solution`, { nodes: revealedNodes });
      const advanced = await api.patch<{ stage: Stage }>(
        `/code-decomposition/${sessionId}/advance-stage`,
        {},
      );
      setStage(advanced.stage);
      const session = await api.get<{ nodes: StepNode[] }>(`/code-decomposition/${sessionId}`);
      setNodes(session.nodes);
      setShowingRevealed(false);
      setRevealedNodes(null);
      setRevealedCode(null);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to accept the tree and move to implementation.',
      );
    } finally {
      setBusy(null);
    }
  }, [sessionId, revealedNodes]);

  // Same idea for stage 2: adopt the previewed code as the real editor
  // contents and mark every node Implemented, unlocking Finish Session.
  const handleAcceptRevealedCode = useCallback(async () => {
    if (!sessionId || !revealedCode) return;
    setBusy('match');
    setErrorMessage(null);
    try {
      const result = await api.patch<{ nodes: StepNode[] }>(
        `/code-decomposition/${sessionId}/adopt-solution`,
        { code: revealedCode },
      );
      onApplyCode(revealedCode);
      setNodes(result.nodes);
      setShowingRevealed(false);
      setRevealedCode(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to use this solution.');
    } finally {
      setBusy(null);
    }
  }, [sessionId, revealedCode, onApplyCode]);

  const handleMutate = useCallback(
    async (dto: MutateAction) => {
      if (!sessionId) return;
      setNodeBusy(true);
      setErrorMessage(null);
      try {
        const result = await api.patch<{ nodes: StepNode[] }>(
          `/code-decomposition/${sessionId}/nodes`,
          dto,
        );
        setNodes(result.nodes);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to update the step tree.');
      } finally {
        setNodeBusy(false);
      }
    },
    [sessionId],
  );

  const handleHint = useCallback(
    async (nodeId: string, tier: 'general' | 'detailed') => {
      if (!sessionId) return;
      setNodeBusy(true);
      setErrorMessage(null);
      try {
        const result = await api.post<{ hint: string }>(
          `/code-decomposition/${sessionId}/nodes/${nodeId}/hint`,
          { tier },
        );
        setNodes((prev) =>
          prev.map((n) =>
            n.id === nodeId
              ? {
                  ...n,
                  hints: {
                    ...n.hints,
                    general: tier === 'general' ? result.hint : n.hints.general,
                    detailed: tier === 'detailed' ? result.hint : n.hints.detailed,
                    generalViewed: tier === 'general' ? true : n.hints.generalViewed,
                    detailedViewed: tier === 'detailed' ? true : n.hints.detailedViewed,
                  },
                }
              : n,
          ),
        );
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to get a hint.');
      } finally {
        setNodeBusy(false);
      }
    },
    [sessionId],
  );

  const handleReveal = useCallback(
    async (nodeId: string) => {
      if (!sessionId) return;
      setNodeBusy(true);
      setErrorMessage(null);
      try {
        const result = await api.post<{ nodes: StepNode[] }>(
          `/code-decomposition/${sessionId}/nodes/${nodeId}/reveal`,
        );
        setNodes(result.nodes);
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : 'Failed to reveal help for this step.',
        );
      } finally {
        setNodeBusy(false);
      }
    },
    [sessionId],
  );

  const handleShowAnswer = useCallback(
    async (nodeId: string) => {
      if (!sessionId) return;
      setNodeBusy(true);
      setErrorMessage(null);
      try {
        const result = await api.post<{ nodes: StepNode[] }>(
          `/code-decomposition/${sessionId}/nodes/${nodeId}/show-answer`,
        );
        setNodes(result.nodes);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to show the answer.');
      } finally {
        setNodeBusy(false);
      }
    },
    [sessionId],
  );

  const handleHoverNode = useCallback(
    (nodeId: string | null) => {
      const mapping = nodeId ? nodes.find((n) => n.id === nodeId)?.codeMapping : null;
      if (mapping && mapping.startLine !== null) {
        setHighlightedRange({
          start: mapping.startLine,
          end: mapping.endLine ?? mapping.startLine,
        });
      } else {
        setHighlightedRange(null);
      }
    },
    [nodes],
  );

  if (!courseId) {
    return <p className="text-xs text-amber-600 px-1">Navigate to a course to use DBox.</p>;
  }

  const treeDisabled = busy !== null || nodeBusy;
  const actions: TreeActions = {
    onAdd: (parentId, content) => void handleMutate({ action: 'add', parentId, content }),
    onEdit: (nodeId, content) => void handleMutate({ action: 'edit', nodeId, content }),
    onDelete: (nodeId) => void handleMutate({ action: 'delete', nodeId }),
    onReorder: (nodeId, direction) => void handleMutate({ action: 'reorder', nodeId, direction }),
    onHint: (nodeId, tier) => void handleHint(nodeId, tier),
    onReveal: (nodeId) => void handleReveal(nodeId),
    onShowAnswer: (nodeId) => void handleShowAnswer(nodeId),
    onHoverNode: handleHoverNode,
    disabled: treeDisabled,
  };
  const readOnlyActions: TreeActions = {
    onAdd: () => {},
    onEdit: () => {},
    onDelete: () => {},
    onReorder: () => {},
    onHint: () => {},
    onReveal: () => {},
    onShowAnswer: () => {},
    onHoverNode: () => {},
    disabled: true,
  };
  // A "can_be_divided" step is still substantively correct — it just
  // bundles multiple operations together — so it counts the same as
  // "correct" toward unlocking Move to Implementation. Splitting into
  // finer substeps stays available but is optional. Mirrors
  // PASSING_FORMATION_STATUSES in the backend's advanceStage gate.
  const isPassing = (status: StepNode['status']) =>
    status === 'correct' || status === 'can_be_divided';
  const allCorrect = nodes.length > 0 && nodes.every((n) => isPassing(n.status));
  const allImplemented = nodes.length > 0 && nodes.every((n) => n.status === 'implemented');

  return (
    <div className="flex flex-col gap-2 h-full overflow-y-auto p-3">
      {errorMessage && (
        <p className="shrink-0 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5">
          {errorMessage}
        </p>
      )}

      {(phase === 'idle' || phase === 'starting') && (
        <p className="text-xs text-gray-500">Starting…</p>
      )}

      {phase === 'error' && (
        <button
          type="button"
          onClick={() => void handleStart()}
          className="self-start text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
        >
          Retry
        </button>
      )}

      {phase === 'completed' && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-2">
            <CheckCircle2 size={14} />
            Session complete
            {completionSummary && (
              <span className="text-green-600">
                — {completionSummary.correctNodes}/{completionSummary.totalNodes} steps done
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSwitchToNewQuestion}
            className="self-start text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700"
          >
            Restart This Problem
          </button>
        </div>
      )}

      {phase === 'tree' && (
        <>
          {problem && (
            <p className="shrink-0 text-sm font-medium bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-2">
              {problem}
            </p>
          )}

          {questionChanged && (
            <div className="shrink-0 flex flex-wrap items-center gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <span className="text-amber-800">A different question is now loaded.</span>
              <button
                type="button"
                onClick={handleSwitchToNewQuestion}
                className="font-medium text-amber-900 underline hover:no-underline"
              >
                Start a session for it
              </button>
              <button
                type="button"
                onClick={() => setQuestionChanged(false)}
                className="font-medium text-amber-700 hover:text-amber-900"
              >
                Keep working on this one
              </button>
            </div>
          )}

          {stage === 'implementation' && (
            <div className="shrink-0 flex flex-col gap-2">
              <CodeEditor
                value={code}
                onChange={onApplyCode}
                minHeight="140px"
                highlightedRange={highlightedRange}
              />
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={running}
                className="self-start flex items-center gap-1.5 text-xs font-medium bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                <Play size={12} />
                {running ? 'Running…' : 'Run'}
              </button>
              {(running || runResult) && (
                <CodeConsole loading={running} isFirstRun={firstRunEver} result={runResult} />
              )}
            </div>
          )}

          {stage === 'implementation' ? (
            <div className="shrink-0 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void handleCopyToComments()}
                disabled={busy !== null || nodeBusy}
                className="flex items-center gap-1.5 text-xs font-medium bg-gray-700 text-white px-2.5 py-1.5 rounded-lg hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                <FileCode2 size={11} />
                {busy === 'copy' ? 'Copying…' : 'Copy to Comments'}
              </button>
              <button
                type="button"
                onClick={() => void handleCheckMatch()}
                disabled={busy !== null || nodeBusy}
                className="text-xs font-medium bg-blue-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {busy === 'match' ? 'Checking…' : 'Check Match'}
              </button>
              <button
                type="button"
                onClick={() => void handleToggleReveal()}
                disabled={busy !== null || nodeBusy}
                title={
                  showingRevealed
                    ? 'Go back to your own code'
                    : 'Peek at the complete correct code — your code is unchanged'
                }
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed ${
                  showingRevealed
                    ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                    : 'bg-white text-teal-700 border-teal-300 hover:bg-teal-50'
                }`}
              >
                {showingRevealed ? <EyeOff size={11} /> : <Eye size={11} />}
                {busy === 'revealSolution'
                  ? 'Revealing…'
                  : showingRevealed
                    ? 'Show My Code'
                    : 'Show Complete Solution'}
              </button>
              {allImplemented && (
                <button
                  type="button"
                  onClick={() => void handleComplete()}
                  disabled={busy !== null || nodeBusy}
                  className="flex items-center gap-1.5 text-xs font-medium bg-green-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <Flag size={11} /> {busy === 'complete' ? 'Finishing…' : 'Finish Session'}
                </button>
              )}
            </div>
          ) : (
            <div className="shrink-0 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void handleCheckTree()}
                disabled={busy !== null || nodeBusy || nodes.length === 0}
                className="text-xs font-medium bg-blue-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                {busy === 'check' ? 'Checking…' : 'Check Step Tree'}
              </button>
              <button
                type="button"
                onClick={() => void handleToggleReveal()}
                disabled={busy !== null || nodeBusy}
                title={
                  showingRevealed
                    ? 'Go back to your own tree'
                    : 'Peek at the complete correct tree — your tree is unchanged'
                }
                className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed ${
                  showingRevealed
                    ? 'bg-teal-600 text-white border-teal-600 hover:bg-teal-700'
                    : 'bg-white text-teal-700 border-teal-300 hover:bg-teal-50'
                }`}
              >
                {showingRevealed ? <EyeOff size={11} /> : <Eye size={11} />}
                {busy === 'revealSolution'
                  ? 'Revealing…'
                  : showingRevealed
                    ? 'Show My Tree'
                    : 'Show Complete Tree'}
              </button>
              {allCorrect ? (
                <button
                  type="button"
                  onClick={() => void handleAdvanceStage()}
                  disabled={busy !== null || nodeBusy}
                  className="flex items-center gap-1.5 text-xs font-medium bg-green-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {busy === 'advance' ? 'Moving…' : 'Move to Implementation'}
                  <ArrowRight size={11} />
                </button>
              ) : (
                nodes.length > 0 && (
                  <span className="self-center text-[11px] text-gray-500">
                    {nodes.filter((n) => isPassing(n.status)).length}/{nodes.length} steps correct —
                    get every step to Correct (or Can Be Divided) to unlock Move to Implementation
                  </span>
                )
              )}
            </div>
          )}

          {/* Not flex-1/min-h-0 — the outer panel (h-full overflow-y-auto)
              already scrolls as a whole. Giving this its own flex-1 box
              instead made it compete for space with its shrink-0
              siblings (the Run console, the button row, the "different
              question" banner): whenever any of those grew — a Python
              traceback, hint/feedback text appearing after a Check —
              this box's height budget shrank right along with it and
              could collapse to zero, making the tree appear to vanish
              instead of the page just growing taller and scrolling. */}
          <div>
            {showingRevealed ? (
              <div className="rounded border border-teal-200 bg-teal-50/40 p-2">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-teal-700">
                    {stage === 'formation'
                      ? 'Complete correct tree (reference only — your own tree is untouched):'
                      : 'Complete correct solution (reference only — your own code is untouched):'}
                  </p>
                  {stage === 'formation' && revealedNodes && (
                    <button
                      type="button"
                      onClick={() => void handleAcceptRevealedTree()}
                      disabled={busy !== null || nodeBusy}
                      className="flex items-center gap-1.5 text-[11px] font-medium bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {busy === 'advance' ? 'Moving…' : 'Accept & Move to Implementation'}
                      <ArrowRight size={10} />
                    </button>
                  )}
                  {stage === 'implementation' && revealedCode && (
                    <button
                      type="button"
                      onClick={() => void handleAcceptRevealedCode()}
                      disabled={busy !== null || nodeBusy}
                      className="flex items-center gap-1.5 text-[11px] font-medium bg-green-600 text-white px-2 py-1 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      {busy === 'match' ? 'Applying…' : 'Use This Solution'}
                    </button>
                  )}
                </div>
                {stage === 'formation' && revealedNodes ? (
                  <StepTree nodes={revealedNodes} actions={readOnlyActions} stage={stage} />
                ) : revealedCode ? (
                  <CodeEditor value={revealedCode} readOnly minHeight="120px" />
                ) : null}
              </div>
            ) : (
              <StepTree nodes={nodes} actions={actions} stage={stage} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
