import { useState } from 'react';
import { StepTreeNode } from './StepTreeNode';

// Mirrors apps/api/src/code-decomposition/code-decomposition.service.ts's
// NodeStatus/StepNode/HintState — no shared-types package in this
// monorepo, so each app declares its own copy of the shape, same
// convention as PageContext's ActiveCodeQuestion mirroring
// ChatbotMessage.codeQuestion.
export type NodeStatus =
  | 'pending'
  | 'correct'
  | 'incorrect'
  | 'missing'
  | 'can_be_divided'
  | 'system_generated'
  | 'implemented'
  | 'incorrectly_implemented'
  | 'to_be_coded';

export interface HintState {
  general: string | null;
  detailed: string | null;
  revealSubstepId: string | null;
  revealCode: string | null;
  /** Full correct answer, set by "Show Answer" — distinct from
   *  revealSubstepId/revealCode, which only reveal a partial hint.
   *  Using Show Answer marks the node done directly (server-side). */
  correctAnswer: string | null;
  attemptsSinceLastCheck: number;
  generalViewed: boolean;
  detailedViewed: boolean;
  revealed: boolean;
}

export interface StepNode {
  id: string;
  parentId: string | null;
  order: number;
  content: string;
  originalStudentContent: string | null;
  status: NodeStatus;
  llmFeedback: string | null;
  hints: HintState;
  codeMapping: {
    startLine: number | null;
    endLine: number | null;
    commentInsertedAtLine: number | null;
  } | null;
}

/** Node-editing/hint callbacks, threaded down from DecompositionPanel
 *  (which owns the session and makes the actual API calls) to every
 *  StepTreeNode. `disabled` covers the whole tree during any in-flight
 *  request so a student can't fire overlapping edits. */
export interface TreeActions {
  onAdd: (parentId: string | null, content: string) => void;
  onEdit: (nodeId: string, content: string) => void;
  onDelete: (nodeId: string) => void;
  onReorder: (nodeId: string, direction: 'up' | 'down') => void;
  onHint: (nodeId: string, tier: 'general' | 'detailed') => void;
  onReveal: (nodeId: string) => void;
  onShowAnswer: (nodeId: string) => void;
  /** Hovering a node highlights its mapped code lines in the Playground's
   *  editor (stage 2 only — codeMapping is null in stage 1, so this is a
   *  harmless no-op there). `null` clears the highlight. */
  onHoverNode: (nodeId: string | null) => void;
  disabled: boolean;
}

interface StepTreeProps {
  nodes: StepNode[];
  actions: TreeActions;
  stage: 'formation' | 'implementation';
}

/** Renders an interactive DBox step tree — status colors, inline edit,
 *  add/split/delete/reorder, and per-node progressive hints. Built fresh
 *  rather than extending MindMapTree.tsx (used elsewhere for a simpler,
 *  unrelated read-only case) but reuses its flat-list + parentId
 *  convention. */
export function StepTree({ nodes, actions, stage }: StepTreeProps) {
  const rootNodes = nodes.filter((n) => n.parentId === null).sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-0.5">
      {nodes.length === 0 && (
        <p className="text-xs text-gray-500 italic px-1 mb-1">
          No steps yet — build a tree from your code, or add one below.
        </p>
      )}
      {rootNodes.map((node) => (
        <StepTreeNode key={node.id} node={node} nodes={nodes} actions={actions} stage={stage} />
      ))}
      {stage === 'formation' && (
        <AddStepButton parentId={null} actions={actions} label="Add Step" />
      )}
    </div>
  );
}

/** Inline "+ Add" control shared by the tree root and each node's "Split"
 *  affordance — a button that expands into a text input + Save/Cancel. */
export function AddStepButton({
  parentId,
  actions,
  label,
}: {
  parentId: string | null;
  actions: TreeActions;
  label: string;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');

  if (!adding) {
    return (
      <button
        type="button"
        disabled={actions.disabled}
        onClick={() => setAdding(true)}
        className="self-start text-xs text-blue-600 hover:text-blue-800 disabled:text-gray-300 disabled:cursor-not-allowed mt-1 ml-3"
      >
        + {label}
      </button>
    );
  }

  const submit = () => {
    const content = value.trim();
    if (content) actions.onAdd(parentId, content);
    setValue('');
    setAdding(false);
  };

  return (
    <div className="flex items-center gap-1.5 mt-1 ml-3">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') {
            setValue('');
            setAdding(false);
          }
        }}
        placeholder="Describe this step…"
        className="text-xs border border-gray-300 rounded px-2 py-1 flex-1 min-w-0"
      />
      <button
        type="button"
        onClick={submit}
        className="text-xs font-medium text-blue-600 hover:text-blue-800"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          setValue('');
          setAdding(false);
        }}
        className="text-xs text-gray-500 hover:text-gray-700"
      >
        Cancel
      </button>
    </div>
  );
}
