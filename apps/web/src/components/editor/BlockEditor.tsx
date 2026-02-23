import { useState, useCallback, useRef, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { Block, BlockType, BlockDataMap } from './block-types';
import { createBlock, parseBlockDocument, serializeBlockDocument } from './block-types';

import TextBlock from './blocks/TextBlock';
import ImageBlock from './blocks/ImageBlock';
import VideoBlock from './blocks/VideoBlock';
import DiagramBlock from './blocks/DiagramBlock';
import CalloutBlock from './blocks/CalloutBlock';
import DividerBlock from './blocks/DividerBlock';
import BlockRenderer from './BlockRenderer';

// ─── Props ───────────────────────────────────────────

interface Props {
  content: string;
  onSave: (json: string) => void;
  readOnly?: boolean;
  autoSaveMs?: number;
  onOpenHistory?: () => void;
}

// ─── Block type metadata ─────────────────────────────

const BLOCK_MENU: { type: BlockType; label: string; icon: string }[] = [
  { type: 'text', label: 'Text', icon: 'T' },
  { type: 'image', label: 'Image', icon: '🖼' },
  { type: 'video', label: 'Video', icon: '▶' },
  { type: 'diagram', label: 'Diagram', icon: '◇' },
  { type: 'callout', label: 'Callout', icon: '!' },
  { type: 'divider', label: 'Divider', icon: '—' },
];

const BLOCK_LABELS: Record<BlockType, string> = {
  text: 'Text',
  image: 'Image',
  video: 'Video',
  diagram: 'Diagram',
  callout: 'Callout',
  divider: 'Divider',
};

// ─── Sortable Block Wrapper ──────────────────────────

function SortableBlock({
  block,
  onUpdate,
  onDelete,
  onDuplicate,
  readOnly,
}: {
  block: Block;
  onUpdate: (id: string, data: BlockDataMap[BlockType]) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleChange = useCallback(
    (data: BlockDataMap[BlockType]) => onUpdate(block.id, data),
    [block.id, onUpdate],
  );

  return (
    <div ref={setNodeRef} style={style} className="group relative">
      {/* Block chrome (drag handle + actions) */}
      {!readOnly && (
        <div className="absolute -left-8 top-1 flex flex-col items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 p-1"
            title="Drag to reorder"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="3" cy="2" r="1" />
              <circle cx="9" cy="2" r="1" />
              <circle cx="3" cy="6" r="1" />
              <circle cx="9" cy="6" r="1" />
              <circle cx="3" cy="10" r="1" />
              <circle cx="9" cy="10" r="1" />
            </svg>
          </button>
        </div>
      )}

      {!readOnly && (
        <div className="absolute -right-1 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <span className="text-[10px] text-gray-400 mr-1">{BLOCK_LABELS[block.type]}</span>
          {block.metadata?.generatedBy === 'ai' && (
            <span className="text-[9px] px-1 py-0.5 bg-violet-100 text-violet-600 rounded mr-1">
              AI
            </span>
          )}
          <button
            onClick={() => onDuplicate(block.id)}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="Duplicate block"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(block.id)}
            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
            title="Delete block"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Block content */}
      <div className="ml-0">
        {block.type === 'text' && (
          <TextBlock
            data={block.data as BlockDataMap['text']}
            onChange={handleChange}
            readOnly={readOnly}
          />
        )}
        {block.type === 'image' && (
          <ImageBlock
            data={block.data as BlockDataMap['image']}
            onChange={handleChange}
            readOnly={readOnly}
          />
        )}
        {block.type === 'video' && (
          <VideoBlock
            data={block.data as BlockDataMap['video']}
            onChange={handleChange}
            readOnly={readOnly}
          />
        )}
        {block.type === 'diagram' && (
          <DiagramBlock
            data={block.data as BlockDataMap['diagram']}
            onChange={handleChange}
            readOnly={readOnly}
          />
        )}
        {block.type === 'callout' && (
          <CalloutBlock
            data={block.data as BlockDataMap['callout']}
            onChange={handleChange}
            readOnly={readOnly}
          />
        )}
        {block.type === 'divider' && <DividerBlock />}
      </div>
    </div>
  );
}

// ─── Add Block Menu ──────────────────────────────────

function AddBlockMenu({
  onAdd,
  insertIndex,
}: {
  onAdd: (type: BlockType, index: number) => void;
  insertIndex: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="py-1 group/add">
      {!open ? (
        <div className="flex items-center justify-center">
          <div className="flex-1 border-t border-dashed border-transparent group-hover/add:border-gray-200 transition-colors" />
          <button
            onClick={() => setOpen(true)}
            className="mx-2 flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full border border-transparent hover:border-gray-200 transition-all opacity-0 group-hover/add:opacity-100"
          >
            <span className="text-base leading-none">+</span>
            <span>Add block</span>
          </button>
          <div className="flex-1 border-t border-dashed border-transparent group-hover/add:border-gray-200 transition-colors" />
        </div>
      ) : (
        <div className="flex items-center justify-center gap-1 py-1 bg-gray-50 rounded-lg border border-gray-200">
          {BLOCK_MENU.map((item) => (
            <button
              key={item.type}
              onClick={() => {
                onAdd(item.type, insertIndex);
                setOpen(false);
              }}
              className="px-2.5 py-1 text-xs text-gray-600 hover:bg-white hover:shadow-sm rounded transition-all flex items-center gap-1"
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
          <button
            onClick={() => setOpen(false)}
            className="ml-1 px-1.5 py-1 text-xs text-gray-400 hover:text-gray-600 rounded"
          >
            &times;
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main BlockEditor ────────────────────────────────

export default function BlockEditor({
  content,
  onSave,
  readOnly = false,
  autoSaveMs = 2000,
  onOpenHistory,
}: Props) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseBlockDocument(content).blocks);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [preview, setPreview] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const lastSavedRef = useRef(content);
  const lastExternalContentRef = useRef(content);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Autosave
  const triggerSave = useCallback(() => {
    if (readOnly) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const json = serializeBlockDocument({ version: 2, blocks: blocksRef.current });
      if (json !== lastSavedRef.current) {
        setSaveStatus('saving');
        onSave(json);
        lastSavedRef.current = json;
        setTimeout(() => setSaveStatus('saved'), 300);
        setTimeout(() => setSaveStatus('idle'), 2500);
      }
    }, autoSaveMs);
  }, [onSave, autoSaveMs, readOnly]);

  // Sync external content changes (e.g., AI-generated content injected by parent)
  // Only reset blocks when the parent genuinely provides new content,
  // not when our own autosave has diverged lastSavedRef from the prop.
  useEffect(() => {
    if (content !== lastExternalContentRef.current) {
      const doc = parseBlockDocument(content);
      setBlocks(doc.blocks);
      lastExternalContentRef.current = content;
      lastSavedRef.current = content;
    }
  }, [content]);

  // ─── Block Operations ────────────────────────────

  const updateBlock = useCallback(
    (id: string, data: BlockDataMap[BlockType]) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          // Human edit clears AI metadata
          const metadata =
            b.metadata?.generatedBy === 'ai'
              ? { ...b.metadata, generatedBy: 'human' as const, editedAt: new Date().toISOString() }
              : b.metadata;
          return { ...b, data, metadata };
        }),
      );
      triggerSave();
    },
    [triggerSave],
  );

  const deleteBlock = useCallback(
    (id: string) => {
      setBlocks((prev) => prev.filter((b) => b.id !== id));
      triggerSave();
    },
    [triggerSave],
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      setBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        if (idx === -1) return prev;
        const original = prev[idx]!;
        const copy = createBlock(original.type, { ...original.data } as never);
        const next = [...prev];
        next.splice(idx + 1, 0, copy);
        return next;
      });
      triggerSave();
    },
    [triggerSave],
  );

  const addBlock = useCallback(
    (type: BlockType, index: number) => {
      const block = createBlock(type);
      setBlocks((prev) => {
        const next = [...prev];
        next.splice(index, 0, block);
        return next;
      });
      triggerSave();
    },
    [triggerSave],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      setBlocks((prev) => {
        const oldIdx = prev.findIndex((b) => b.id === active.id);
        const newIdx = prev.findIndex((b) => b.id === over.id);
        if (oldIdx === -1 || newIdx === -1) return prev;
        const next = [...prev];
        const [moved] = next.splice(oldIdx, 1) as [Block];
        next.splice(newIdx, 0, moved);
        return next;
      });
      triggerSave();
    },
    [triggerSave],
  );

  return (
    <div className="border border-gray-300 rounded-lg bg-white">
      {/* Header bar */}
      {!readOnly && (
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
          <span className="text-xs font-medium text-gray-500">
            {blocks.length} block{blocks.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-2">
            <div className="text-xs text-gray-400">
              {saveStatus === 'saving' && 'Saving...'}
              {saveStatus === 'saved' && <span className="text-green-600">Saved</span>}
            </div>
            <button
              onClick={() => setPreview((p) => !p)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                preview
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {preview ? 'Edit' : 'Preview'}
            </button>
            {onOpenHistory && (
              <button
                onClick={onOpenHistory}
                className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
              >
                History
              </button>
            )}
          </div>
        </div>
      )}

      {/* Preview mode */}
      {preview && !readOnly && (
        <div className="px-10 py-6 min-h-[200px]">
          <BlockRenderer content={serializeBlockDocument({ version: 2, blocks })} />
        </div>
      )}

      {/* Block list (edit mode) */}
      {!preview && (
        <div className="px-10 py-4 min-h-[200px]">
          {/* Top add-block */}
          {!readOnly && <AddBlockMenu onAdd={addBlock} insertIndex={0} />}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
              {blocks.map((block, idx) => (
                <div key={block.id}>
                  <SortableBlock
                    block={block}
                    onUpdate={updateBlock}
                    onDelete={deleteBlock}
                    onDuplicate={duplicateBlock}
                    readOnly={readOnly}
                  />
                  {!readOnly && <AddBlockMenu onAdd={addBlock} insertIndex={idx + 1} />}
                </div>
              ))}
            </SortableContext>
          </DndContext>

          {blocks.length === 0 && !readOnly && (
            <div className="text-center py-8">
              <p className="text-sm text-gray-400 mb-3">This page has no content yet.</p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {BLOCK_MENU.map((item) => (
                  <button
                    key={item.type}
                    onClick={() => addBlock(item.type, 0)}
                    className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 flex items-center gap-1"
                  >
                    <span className="text-xs">{item.icon}</span>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
