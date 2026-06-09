/**
 * Researcher annotation panel (prompt 06 — Build Prompt A).
 *
 * Sidebar list of annotations + code-set manager + add controls.
 * Lives next to the rest of the right-sidebar panels in ReplayTab.
 *
 * The timeline-band overlay is rendered separately by ReplayTab's
 * Signal Timeline SVG so it stays time-aligned with the existing
 * signals; this component owns only the sidebar UI + add affordances.
 */

import { useState } from 'react';
import type { ReplayAnnotation, ReplayCode } from '../hooks/useReplayAnnotations';

interface AnnotationsPanelProps {
  annotations: ReplayAnnotation[];
  codes: ReplayCode[];
  currentTimeMs: number;
  durationMs: number;
  onSeek: (offsetMs: number) => void;
  onCreate: (body: {
    startMs: number;
    endMs?: number | null;
    codeId?: string | null;
    note?: string | null;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    patch: {
      startMs?: number;
      endMs?: number | null;
      codeId?: string | null;
      note?: string | null;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onCreateCode: (label: string, color?: string) => Promise<void>;
  onUpdateCode: (id: string, patch: { label?: string; color?: string | null }) => Promise<void>;
  onDeleteCode: (id: string) => Promise<void>;
}

function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseOffset(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = s.split(':').map((p) => p.trim());
  if (parts.length === 1) {
    const n = Number(parts[0]);
    return Number.isFinite(n) ? Math.max(0, n * 1000) : null;
  }
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let secs = 0;
  if (parts.length === 3) secs = nums[0]! * 3600 + nums[1]! * 60 + nums[2]!;
  else secs = nums[0]! * 60 + nums[1]!;
  return Math.max(0, Math.round(secs * 1000));
}

export function AnnotationsPanel({
  annotations,
  codes,
  currentTimeMs,
  durationMs,
  onSeek,
  onCreate,
  onUpdate,
  onDelete,
  onCreateCode,
  onUpdateCode,
  onDeleteCode,
}: AnnotationsPanelProps) {
  const [showCodeManager, setShowCodeManager] = useState(false);
  const [newCodeLabel, setNewCodeLabel] = useState('');
  const [newCodeColor, setNewCodeColor] = useState('#6366f1');
  const [draftNote, setDraftNote] = useState('');
  const [draftCodeId, setDraftCodeId] = useState<string>('');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState('');

  const handleAddAtPlayhead = async () => {
    await onCreate({
      startMs: currentTimeMs,
      codeId: draftCodeId || null,
      note: draftNote || null,
    });
    setDraftNote('');
  };

  const handleAddRange = async () => {
    const startMs = parseOffset(draftStart) ?? currentTimeMs;
    const parsedEnd = parseOffset(draftEnd);
    const endMs = parsedEnd != null && parsedEnd > startMs ? parsedEnd : null;
    await onCreate({
      startMs,
      endMs,
      codeId: draftCodeId || null,
      note: draftNote || null,
    });
    setDraftNote('');
    setDraftStart('');
    setDraftEnd('');
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-gray-900">Annotations</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowCodeManager((v) => !v)}
            className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50"
          >
            {showCodeManager ? 'Close codes' : 'Manage codes'}
          </button>
        </div>
      </div>

      {showCodeManager && (
        <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
          <p className="mb-2 font-medium text-gray-700">Code set</p>
          <div className="mb-2 space-y-1">
            {codes.length === 0 && (
              <p className="text-gray-500 italic">No codes yet — add one below.</p>
            )}
            {codes.map((c) => (
              <div key={c.id} className="flex items-center gap-1">
                <input
                  type="color"
                  value={c.color ?? '#6b7280'}
                  onChange={(e) => onUpdateCode(c.id, { color: e.target.value })}
                  className="h-5 w-5 cursor-pointer rounded border border-gray-300 bg-white"
                />
                <input
                  type="text"
                  value={c.label}
                  onChange={(e) => onUpdateCode(c.id, { label: e.target.value })}
                  className="flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5"
                />
                <button
                  type="button"
                  onClick={() => onDeleteCode(c.id)}
                  className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50"
                  title="Annotations referencing this code keep their note text."
                >
                  delete
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="color"
              value={newCodeColor}
              onChange={(e) => setNewCodeColor(e.target.value)}
              className="h-5 w-5 cursor-pointer rounded border border-gray-300 bg-white"
            />
            <input
              type="text"
              value={newCodeLabel}
              onChange={(e) => setNewCodeLabel(e.target.value)}
              placeholder="New code label"
              className="flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5"
            />
            <button
              type="button"
              disabled={!newCodeLabel.trim()}
              onClick={async () => {
                await onCreateCode(newCodeLabel.trim(), newCodeColor);
                setNewCodeLabel('');
              }}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-700 hover:bg-white disabled:opacity-50"
            >
              add
            </button>
          </div>
        </div>
      )}

      {/* Add affordances */}
      <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-2 text-[11px]">
        <p className="mb-1 font-medium text-gray-700">New annotation</p>
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <select
              value={draftCodeId}
              onChange={(e) => setDraftCodeId(e.target.value)}
              className="rounded border border-gray-300 bg-white px-1.5 py-0.5"
            >
              <option value="">(no code)</option>
              {codes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value)}
              placeholder="Optional note"
              className="flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={handleAddAtPlayhead}
              className="rounded border border-indigo-500 bg-indigo-500 px-2 py-0.5 text-[11px] text-white hover:bg-indigo-600"
            >
              + point @ {formatOffset(currentTimeMs)}
            </button>
            <span className="text-gray-400">or range</span>
            <input
              type="text"
              value={draftStart}
              onChange={(e) => setDraftStart(e.target.value)}
              placeholder={formatOffset(0)}
              className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[10px]"
            />
            →
            <input
              type="text"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              placeholder={formatOffset(durationMs)}
              className="w-16 rounded border border-gray-300 bg-white px-1.5 py-0.5 font-mono text-[10px]"
            />
            <button
              type="button"
              onClick={handleAddRange}
              disabled={!draftEnd && !draftStart}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-700 hover:bg-white disabled:opacity-50"
            >
              + range
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftStart(formatOffset(currentTimeMs));
              }}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-white"
              title="Set range start to current playhead"
            >
              start ⤓
            </button>
            <button
              type="button"
              onClick={() => {
                setDraftEnd(formatOffset(currentTimeMs));
              }}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-white"
              title="Set range end to current playhead"
            >
              end ⤓
            </button>
          </div>
        </div>
      </div>

      {/* Existing annotations list */}
      {annotations.length === 0 ? (
        <p className="text-gray-500">No annotations yet.</p>
      ) : (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {annotations.map((a) => {
            const isEditing = editingId === a.id;
            const color = a.code?.color ?? '#9ca3af';
            return (
              <li key={a.id} className="rounded border border-gray-200 bg-white p-1.5">
                <div className="flex items-start gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => onSeek(a.startMs)}
                    className="shrink-0 font-mono text-[10px] text-indigo-700 hover:underline"
                    title="Seek to this annotation"
                  >
                    {formatOffset(a.startMs)}
                    {a.endMs != null ? `–${formatOffset(a.endMs)}` : ''}
                  </button>
                  {a.code && (
                    <span
                      className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium text-white"
                      style={{ backgroundColor: color }}
                    >
                      {a.code.label}
                    </span>
                  )}
                  {!isEditing ? (
                    <span className="flex-1 text-gray-800">
                      {a.note || <em className="text-gray-400">no note</em>}
                    </span>
                  ) : (
                    <input
                      type="text"
                      autoFocus
                      value={editingNote}
                      onChange={(e) => setEditingNote(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          await onUpdate(a.id, { note: editingNote });
                          setEditingId(null);
                        } else if (e.key === 'Escape') {
                          setEditingId(null);
                        }
                      }}
                      className="flex-1 rounded border border-gray-300 px-1.5 py-0.5"
                    />
                  )}
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(a.id);
                        setEditingNote(a.note ?? '');
                      }}
                      className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-600 hover:bg-gray-50"
                    >
                      edit
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDelete(a.id)}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-[10px] text-red-600 hover:bg-red-50"
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
