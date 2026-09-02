import { useState } from 'react';
import { Pencil, Trash2, ChevronUp, ChevronDown, Lightbulb, Sparkles, Eye } from 'lucide-react';
import type { StepNode, NodeStatus, TreeActions } from './StepTree';
import { AddStepButton } from './StepTree';

export const REVEAL_ATTEMPT_THRESHOLD = 2;

const STATUS_STYLE: Record<NodeStatus, { label: string; className: string; dashed?: boolean }> = {
  pending: { label: 'Unchecked', className: 'bg-gray-100 text-gray-600 border-gray-300' },
  correct: { label: 'Correct', className: 'bg-green-50 text-green-700 border-green-300' },
  incorrect: { label: 'Incorrect', className: 'bg-red-50 text-red-700 border-red-300' },
  missing: {
    label: 'Missing',
    className: 'bg-amber-50 text-amber-700 border-amber-300',
    dashed: true,
  },
  can_be_divided: {
    label: 'Can be divided',
    className: 'bg-blue-50 text-blue-700 border-blue-300',
    dashed: true,
  },
  system_generated: {
    label: 'Revealed',
    className: 'bg-purple-50 text-purple-700 border-purple-300',
  },
  implemented: { label: 'Implemented', className: 'bg-green-50 text-green-700 border-green-300' },
  incorrectly_implemented: {
    label: 'Incorrectly implemented',
    className: 'bg-red-50 text-red-700 border-red-300',
  },
  to_be_coded: { label: 'To be coded', className: 'bg-gray-100 text-gray-600 border-gray-300' },
};

/** "Done" statuses per stage — hints/reveal only make sense on a node
 *  that isn't done yet, and the done status itself differs by stage
 *  (formation grades tree correctness, implementation grades code). */
const DONE_STATUS: Record<'formation' | 'implementation', NodeStatus> = {
  formation: 'correct',
  implementation: 'implemented',
};

interface StepTreeNodeProps {
  node: StepNode;
  nodes: StepNode[];
  actions: TreeActions;
  stage: 'formation' | 'implementation';
}

export function StepTreeNode({ node, nodes, actions, stage }: StepTreeNodeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(node.content);

  const children = nodes.filter((n) => n.parentId === node.id).sort((a, b) => a.order - b.order);
  const style = STATUS_STYLE[node.status];
  const canHelp = node.status !== DONE_STATUS[stage];
  const pastThreshold = node.hints.attemptsSinceLastCheck >= REVEAL_ATTEMPT_THRESHOLD;
  const canReveal = canHelp && !node.hints.revealed && pastThreshold;
  // Show Answer marks the node done directly (server-side), so unlike
  // Reveal it stays available even after a substep/code reveal was
  // already used — a student who used the softer hint first and is
  // still stuck shouldn't be blocked from the stronger one.
  const canShowAnswer = canHelp && pastThreshold;
  const canEditStructure = stage === 'formation';

  const startEdit = () => {
    setDraft(node.content);
    setEditing(true);
  };
  const saveEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== node.content) actions.onEdit(node.id, trimmed);
    setEditing(false);
  };

  return (
    <div
      className="ml-3"
      onMouseEnter={() => actions.onHoverNode(node.id)}
      onMouseLeave={() => actions.onHoverNode(null)}
    >
      <div
        className={`group flex items-start gap-2 rounded-md border px-2 py-1.5 my-0.5 text-sm ${style.className} ${
          style.dashed ? 'border-dashed' : ''
        }`}
      >
        {editing ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveEdit();
                if (e.key === 'Escape') setEditing(false);
              }}
              className="text-sm border border-gray-300 rounded px-1.5 py-0.5 flex-1 min-w-0 bg-white text-gray-900"
            />
            <button type="button" onClick={saveEdit} className="text-xs font-medium underline">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs underline">
              Cancel
            </button>
          </div>
        ) : (
          <>
            <span className="flex-1">
              {node.content || (
                <span className="italic opacity-70">
                  A step belongs here — click Edit to describe it.
                </span>
              )}
            </span>
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide opacity-80">
              {style.label}
            </span>
            {canEditStructure && (
              <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  title="Move up"
                  disabled={actions.disabled}
                  onClick={() => actions.onReorder(node.id, 'up')}
                  className="p-0.5 hover:bg-black/10 rounded disabled:opacity-40"
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  title="Move down"
                  disabled={actions.disabled}
                  onClick={() => actions.onReorder(node.id, 'down')}
                  className="p-0.5 hover:bg-black/10 rounded disabled:opacity-40"
                >
                  <ChevronDown size={12} />
                </button>
                <button
                  type="button"
                  title="Edit"
                  disabled={actions.disabled}
                  onClick={startEdit}
                  className="p-0.5 hover:bg-black/10 rounded disabled:opacity-40"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  title="Delete"
                  disabled={actions.disabled}
                  onClick={() => actions.onDelete(node.id)}
                  className="p-0.5 hover:bg-black/10 rounded disabled:opacity-40"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {node.llmFeedback && (
        <p className="ml-2 mb-1 text-xs text-gray-500 italic">{node.llmFeedback}</p>
      )}

      {canHelp && (
        <div className="ml-2 mb-1 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={actions.disabled}
            onClick={() => actions.onHint(node.id, 'general')}
            className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900 disabled:text-gray-300"
          >
            <Lightbulb size={11} /> General Hint
          </button>
          <button
            type="button"
            disabled={actions.disabled}
            onClick={() => actions.onHint(node.id, 'detailed')}
            className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900 disabled:text-gray-300"
          >
            <Lightbulb size={11} /> Detailed Hint
          </button>
          {canReveal && (
            <button
              type="button"
              disabled={actions.disabled}
              onClick={() => actions.onReveal(node.id)}
              className="flex items-center gap-1 text-[11px] text-purple-700 hover:text-purple-900 disabled:text-gray-300"
            >
              <Sparkles size={11} /> {stage === 'formation' ? 'Reveal Substep' : 'Reveal Code'}
            </button>
          )}
          {canShowAnswer && (
            <button
              type="button"
              disabled={actions.disabled}
              onClick={() => actions.onShowAnswer(node.id)}
              className="flex items-center gap-1 text-[11px] text-teal-700 hover:text-teal-900 disabled:text-gray-300"
            >
              <Eye size={11} /> Show Answer
            </button>
          )}
        </div>
      )}
      {/* General/detailed hints and the substep/code reveal are scaffolding
          for a step that's still wrong — once a later Check marks it
          Correct/Implemented, they're stale and just clutter the tree, so
          they're gated on canHelp same as the buttons that fetch them.
          `correctAnswer` (from "Show Answer") is different: that action
          marks the node done in the same call, so canHelp is already
          false by the time it's set — gating it the same way would hide
          it immediately, so it stays unconditional as the permanent
          record of the answer. */}
      {canHelp && node.hints.general && (
        <p className="ml-2 mb-1 text-xs bg-amber-50 border border-amber-100 rounded px-2 py-1 text-amber-800">
          <span className="font-semibold">Hint: </span>
          {node.hints.general}
        </p>
      )}
      {canHelp && node.hints.detailed && (
        <p className="ml-2 mb-1 text-xs bg-amber-50 border border-amber-100 rounded px-2 py-1 text-amber-800">
          <span className="font-semibold">Detailed hint: </span>
          {node.hints.detailed}
        </p>
      )}
      {canHelp && node.hints.revealCode && (
        <pre className="ml-2 mb-1 text-[11px] font-mono whitespace-pre-wrap bg-purple-50 border border-purple-100 rounded px-2 py-1.5 text-purple-900">
          {node.hints.revealCode}
        </pre>
      )}
      {node.hints.correctAnswer && (
        <p className="ml-2 mb-1 text-xs bg-teal-50 border border-teal-100 rounded px-2 py-1 text-teal-900">
          <span className="font-semibold">Answer: </span>
          {node.hints.correctAnswer}
        </p>
      )}

      {children.length > 0 && (
        <div className="border-l border-gray-200 ml-1">
          {children.map((child) => (
            <StepTreeNode
              key={child.id}
              node={child}
              nodes={nodes}
              actions={actions}
              stage={stage}
            />
          ))}
        </div>
      )}
      {canEditStructure && (
        <AddStepButton parentId={node.id} actions={actions} label="Split (add substep)" />
      )}
    </div>
  );
}
