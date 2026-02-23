import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';
import { InfoTooltip } from './InfoTooltip';

// ─── Types ──────────────────────────────────────────────

interface TopoNode {
  id: string;
  name: string;
  level: number;
}

interface GraphNode {
  id: string;
  name: string;
  status: string;
  description: string | null;
  topicId: string | null;
  subtopicId: string | null;
  topicName: string | null;
  subtopicName: string | null;
}

interface GraphEdge {
  id: string;
  fromKcId: string;
  toKcId: string;
  relationship: string;
  weight: number;
  createdBy: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hierarchy: any[];
}

interface Props {
  courseId: string;
}

// ─── Subtopic color palette (same as graph studio) ──────

const SUBTOPIC_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#14b8a6',
  '#eab308',
  '#06b6d4',
  '#84cc16',
  '#f43f5e',
  '#6366f1',
];

function getSubtopicColor(subtopicId: string | null, subtopicIds: string[]): string {
  if (!subtopicId) return '#9ca3af';
  const idx = subtopicIds.indexOf(subtopicId);
  return SUBTOPIC_COLORS[idx % SUBTOPIC_COLORS.length] || '#9ca3af';
}

// ─── Component ──────────────────────────────────────────

export default function LearningPathPanel({ courseId }: Props) {
  const { toast } = useToast();
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [topoOrder, setTopoOrder] = useState<TopoNode[]>([]);
  const [cycles, setCycles] = useState<string[][]>([]);
  const [loading, setLoading] = useState(true);
  const [swimlaneMode, setSwimlaneMode] = useState<'none' | 'topic' | 'subtopic'>('none');
  const svgRef = useRef<SVGSVGElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const [graphData, topo, cyc] = await Promise.all([
        apiFetch<GraphData>(`/kc-graph?courseId=${courseId}`),
        apiFetch<TopoNode[]>(`/kc-graph/topological-order?courseId=${courseId}`),
        apiFetch<string[][]>(`/kc-graph/cycles?courseId=${courseId}`),
      ]);
      setGraph(graphData);
      setTopoOrder(topo);
      setCycles(cyc);
    } catch (err: any) {
      toast('error', err.message || 'Failed to load learning path');
    }
  }, [courseId, toast]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // ─── Compute layered DAG positions ─────────────────────

  const subtopicIds = useMemo(() => {
    if (!graph) return [];
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (n.subtopicId) ids.add(n.subtopicId);
    }
    return Array.from(ids);
  }, [graph]);

  const { layeredNodes, dagEdges, svgWidth, svgHeight } = useMemo(() => {
    if (!graph || topoOrder.length === 0) {
      return { layeredNodes: [] as any[], dagEdges: [] as any[], svgWidth: 800, svgHeight: 400 };
    }

    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    const levels = new Map<number, TopoNode[]>();
    for (const t of topoOrder) {
      if (!levels.has(t.level)) levels.set(t.level, []);
      levels.get(t.level)!.push(t);
    }

    // Include nodes not in topo order (isolated)
    const topoIds = new Set(topoOrder.map((t) => t.id));
    const isolatedNodes = graph.nodes.filter((n) => !topoIds.has(n.id));
    const maxLevel = Math.max(0, ...Array.from(levels.keys()));
    if (isolatedNodes.length > 0) {
      const isolatedLevel = maxLevel + 1;
      levels.set(
        isolatedLevel,
        isolatedNodes.map((n) => ({ id: n.id, name: n.name, level: isolatedLevel })),
      );
    }

    const levelKeys = Array.from(levels.keys()).sort((a, b) => a - b);
    const nodeSpacingX = 180;
    const nodeSpacingY = 100;
    const paddingX = 80;
    const paddingY = 60;
    const maxNodesInLevel = Math.max(1, ...Array.from(levels.values()).map((v) => v.length));
    const width = Math.max(800, levelKeys.length * nodeSpacingX + paddingX * 2);
    const height = Math.max(400, maxNodesInLevel * nodeSpacingY + paddingY * 2);

    type LayeredNode = {
      id: string;
      name: string;
      x: number;
      y: number;
      level: number;
      status: string;
      topicId: string | null;
      subtopicId: string | null;
      topicName: string | null;
      subtopicName: string | null;
    };

    const result: LayeredNode[] = [];
    for (let li = 0; li < levelKeys.length; li++) {
      const level = levelKeys[li]!;
      const nodesAtLevel = levels.get(level)!;

      // Sort within level by subtopic for swimlane grouping
      const sorted = [...nodesAtLevel];
      if (swimlaneMode !== 'none') {
        sorted.sort((a, b) => {
          const na = nodeMap.get(a.id);
          const nb = nodeMap.get(b.id);
          const keyA = swimlaneMode === 'topic' ? na?.topicId || 'zzz' : na?.subtopicId || 'zzz';
          const keyB = swimlaneMode === 'topic' ? nb?.topicId || 'zzz' : nb?.subtopicId || 'zzz';
          return keyA.localeCompare(keyB);
        });
      }

      const x = paddingX + li * nodeSpacingX;
      for (let ni = 0; ni < sorted.length; ni++) {
        const t = sorted[ni]!;
        const y = paddingY + ni * nodeSpacingY + (height - sorted.length * nodeSpacingY) / 2;
        const gNode = nodeMap.get(t.id);
        result.push({
          id: t.id,
          name: t.name,
          x,
          y,
          level: t.level,
          status: gNode?.status || 'PROPOSED',
          topicId: gNode?.topicId || null,
          subtopicId: gNode?.subtopicId || null,
          topicName: gNode?.topicName || null,
          subtopicName: gNode?.subtopicName || null,
        });
      }
    }

    // Only use ordering edges for the DAG
    const posMap = new Map(result.map((n) => [n.id, n]));
    const edges = graph.edges
      .filter((e) => e.relationship === 'prerequisite' || e.relationship === 'builds_on')
      .filter((e) => posMap.has(e.fromKcId) && posMap.has(e.toKcId))
      .map((e) => ({
        ...e,
        from: posMap.get(e.fromKcId)!,
        to: posMap.get(e.toKcId)!,
      }));

    return { layeredNodes: result, dagEdges: edges, svgWidth: width, svgHeight: height };
  }, [graph, topoOrder, swimlaneMode]);

  // ─── Export as SVG ─────────────────────────────────────

  const handleExportSvg = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `learning-path-${courseId.slice(0, 8)}.svg`;
    link.click();
    URL.revokeObjectURL(url);
    toast('success', 'SVG exported');
  };

  const handleExportJson = () => {
    const data = {
      levels: Array.from(new Set(topoOrder.map((t) => t.level)))
        .sort((a, b) => a - b)
        .map((level) => ({
          level: level + 1,
          kcs: topoOrder
            .filter((t) => t.level === level)
            .map((t) => {
              const gNode = graph?.nodes.find((n) => n.id === t.id);
              return {
                id: t.id,
                name: t.name,
                topic: gNode?.topicName,
                subtopic: gNode?.subtopicName,
              };
            }),
        })),
      edges:
        graph?.edges
          .filter((e) => e.relationship === 'prerequisite' || e.relationship === 'builds_on')
          .map((e) => ({
            from: graph?.nodes.find((n) => n.id === e.fromKcId)?.name || e.fromKcId,
            to: graph?.nodes.find((n) => n.id === e.toKcId)?.name || e.toKcId,
            type: e.relationship,
          })) || [],
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `learning-path-${courseId.slice(0, 8)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('success', 'JSON exported');
  };

  // ─── Render ────────────────────────────────────────────

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading Learning Path...</div>;
  }

  if (!graph || topoOrder.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        <p>No learning path available.</p>
        <p className="text-xs mt-1">
          Generate a KC graph first, then the learning path will be computed automatically.
        </p>
      </div>
    );
  }

  const nodeRadius = 28;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-700">
          Learning Path
          <span className="ml-1 inline-flex">
            <InfoTooltip text="A layered DAG showing the recommended learning sequence. Nodes at the same level can be studied in parallel." />
          </span>
        </h3>

        <div className="h-5 w-px bg-gray-300" />

        <label className="text-xs text-gray-500">Swimlanes:</label>
        <select
          value={swimlaneMode}
          onChange={(e) => setSwimlaneMode(e.target.value as any)}
          className="border rounded px-2 py-1 text-xs"
        >
          <option value="none">None</option>
          <option value="topic">By Topic</option>
          <option value="subtopic">By Subtopic</option>
        </select>

        <div className="h-5 w-px bg-gray-300" />

        <button
          onClick={handleExportSvg}
          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Export SVG
          <span className="ml-1 inline-flex">
            <InfoTooltip text="Download the learning path as an SVG vector image." />
          </span>
        </button>
        <button
          onClick={handleExportJson}
          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
        >
          Export JSON
          <span className="ml-1 inline-flex">
            <InfoTooltip text="Download the learning path data as a structured JSON file." />
          </span>
        </button>

        <span className="text-xs text-gray-400 ml-auto">
          {topoOrder.length} KCs in path, {new Set(topoOrder.map((t) => t.level)).size} levels
        </span>

        {cycles.length > 0 && (
          <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full font-medium">
            {cycles.length} cycle(s) — path may be incomplete
          </span>
        )}
      </div>

      {/* Level summary cards */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {Array.from(new Set(topoOrder.map((t) => t.level)))
          .sort((a, b) => a - b)
          .map((level) => {
            const kcs = topoOrder.filter((t) => t.level === level);
            return (
              <div
                key={level}
                className="flex-shrink-0 border rounded-lg p-2 bg-gray-50 min-w-[140px]"
              >
                <div className="text-xs font-semibold text-gray-600 mb-1">Level {level + 1}</div>
                {kcs.map((kc) => {
                  const gNode = graph.nodes.find((n) => n.id === kc.id);
                  return (
                    <div key={kc.id} className="flex items-center gap-1 text-xs py-0.5">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: getSubtopicColor(gNode?.subtopicId || null, subtopicIds),
                        }}
                      />
                      <span className="truncate text-gray-700">{kc.name}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
      </div>

      {/* DAG Visualization */}
      <div className="border rounded-lg bg-white overflow-auto" style={{ maxHeight: '500px' }}>
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <marker id="dag-arrow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#6b7280" />
            </marker>
          </defs>

          {/* Level columns */}
          {Array.from(new Set(layeredNodes.map((n) => n.level)))
            .sort((a, b) => a - b)
            .map((level) => {
              const nodesAtLevel = layeredNodes.filter((n) => n.level === level);
              if (nodesAtLevel.length === 0) return null;
              const x = nodesAtLevel[0]!.x;
              return (
                <g key={`level-${level}`}>
                  <rect
                    x={x - 70}
                    y={20}
                    width={140}
                    height={svgHeight - 40}
                    rx={8}
                    fill="#f9fafb"
                    stroke="#e5e7eb"
                    strokeWidth={1}
                  />
                  <text
                    x={x}
                    y={38}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill="#6b7280"
                  >
                    Level {level + 1}
                  </text>
                </g>
              );
            })}

          {/* Edges */}
          {dagEdges.map((edge: any) => {
            const from = edge.from;
            const to = edge.to;
            const x1 = from.x + nodeRadius;
            const y1 = from.y;
            const x2 = to.x - nodeRadius;
            const y2 = to.y;
            // Bezier curve
            const midX = (x1 + x2) / 2;
            return (
              <path
                key={edge.id}
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={edge.relationship === 'builds_on' ? '#7c3aed' : '#6b7280'}
                strokeWidth={1.5}
                strokeOpacity={0.6}
                markerEnd="url(#dag-arrow)"
              />
            );
          })}

          {/* Nodes */}
          {layeredNodes.map((node) => {
            const color = getSubtopicColor(node.subtopicId, subtopicIds);
            return (
              <g key={node.id}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={nodeRadius}
                  fill={color}
                  stroke="#fff"
                  strokeWidth={2}
                  opacity={0.9}
                />
                {/* Status dot */}
                <circle
                  cx={node.x + nodeRadius * 0.6}
                  cy={node.y - nodeRadius * 0.6}
                  r={4}
                  fill={
                    node.status === 'APPROVED'
                      ? '#10b981'
                      : node.status === 'PROPOSED'
                        ? '#f59e0b'
                        : '#9ca3af'
                  }
                  stroke="#fff"
                  strokeWidth={1}
                />
                <text
                  x={node.x}
                  y={node.y + 1}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="8"
                  fill="#fff"
                  fontWeight="600"
                >
                  {node.name.length > 10 ? node.name.slice(0, 10) + '..' : node.name}
                </text>
                <text
                  x={node.x}
                  y={node.y + nodeRadius + 12}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#374151"
                >
                  {node.name.length > 20 ? node.name.slice(0, 20) + '...' : node.name}
                </text>
                {node.subtopicName && (
                  <text
                    x={node.x}
                    y={node.y + nodeRadius + 24}
                    textAnchor="middle"
                    fontSize="7"
                    fill="#9ca3af"
                  >
                    {node.subtopicName.length > 22
                      ? node.subtopicName.slice(0, 22) + '...'
                      : node.subtopicName}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 flex-wrap text-xs text-gray-500">
        <span className="font-medium text-gray-600">Status:</span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Approved
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> Proposed
        </span>
        <span className="mx-1 text-gray-300">|</span>
        <span className="font-medium text-gray-600">Direction:</span>
        <span>Left → Right = Learning sequence</span>
        <span className="mx-1 text-gray-300">|</span>
        <span className="font-medium text-gray-600">Edges:</span>
        <span className="flex items-center gap-1">
          <span className="w-6 h-0.5 bg-gray-500" /> Prerequisite
        </span>
        <span className="flex items-center gap-1">
          <span className="w-6 h-0.5 bg-purple-600" /> Builds On
        </span>
      </div>
    </div>
  );
}
