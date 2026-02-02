import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';
import { InfoTooltip } from './InfoTooltip';

// ─── Types ──────────────────────────────────────────────

interface GraphNode {
  id: string;
  name: string;
  status: string;
  description: string | null;
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
}

interface TopoNode {
  id: string;
  name: string;
  level: number;
}

interface Props {
  courseId: string;
}

// ─── Simple force-directed layout ───────────────────────

interface NodePos {
  id: string;
  x: number;
  y: number;
  name: string;
  status: string;
}

function computeLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): NodePos[] {
  if (nodes.length === 0) return [];

  // Initialize positions in a circle
  const positions: NodePos[] = nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = Math.min(width, height) * 0.35;
    return {
      id: n.id,
      x: width / 2 + r * Math.cos(angle),
      y: height / 2 + r * Math.sin(angle),
      name: n.name,
      status: n.status,
    };
  });

  // Simple force-directed iterations
  const posMap = new Map(positions.map((p) => [p.id, p]));
  for (let iter = 0; iter < 50; iter++) {
    // Repulsion
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = 5000 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.x -= fx;
        a.y -= fy;
        b.x += fx;
        b.y += fy;
      }
    }
    // Attraction along edges
    for (const edge of edges) {
      const a = posMap.get(edge.fromKcId);
      const b = posMap.get(edge.toKcId);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const force = (dist - 150) * 0.01;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.x += fx;
      a.y += fy;
      b.x -= fx;
      b.y -= fy;
    }
    // Center gravity
    for (const p of positions) {
      p.x += (width / 2 - p.x) * 0.01;
      p.y += (height / 2 - p.y) * 0.01;
    }
  }

  // Clamp to bounds
  for (const p of positions) {
    p.x = Math.max(60, Math.min(width - 60, p.x));
    p.y = Math.max(30, Math.min(height - 30, p.y));
  }

  return positions;
}

// ─── Component ──────────────────────────────────────────

export default function KcGraphStudioPanel({ courseId }: Props) {
  const { toast } = useToast();
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [topoOrder, setTopoOrder] = useState<TopoNode[]>([]);
  const [cycles, setCycles] = useState<string[][]>([]);
  const [showTopo, setShowTopo] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [addEdgeMode, setAddEdgeMode] = useState(false);
  const [addEdgeFrom, setAddEdgeFrom] = useState('');
  const [addEdgeTo, setAddEdgeTo] = useState('');
  const [addEdgeRel, setAddEdgeRel] = useState('prerequisite');
  const svgRef = useRef<SVGSVGElement>(null);

  const SVG_WIDTH = 800;
  const SVG_HEIGHT = 500;

  const fetchGraph = useCallback(async () => {
    try {
      const data = await apiFetch<GraphData>(`/kc-graph?courseId=${courseId}`);
      setGraph(data);
    } catch (err: any) {
      toast('error', err.message || 'Failed to load graph');
    }
  }, [courseId, toast]);

  const fetchMeta = useCallback(async () => {
    try {
      const [topo, cyc] = await Promise.all([
        apiFetch<TopoNode[]>(`/kc-graph/topological-order?courseId=${courseId}`),
        apiFetch<string[][]>(`/kc-graph/cycles?courseId=${courseId}`),
      ]);
      setTopoOrder(topo);
      setCycles(cyc);
    } catch {
      // non-critical
    }
  }, [courseId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchGraph(), fetchMeta()]).finally(() => setLoading(false));
  }, [fetchGraph, fetchMeta]);

  // ─── Actions ────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await apiFetch<{ edgesCreated: number }>('/kc-graph/generate', {
        method: 'POST',
        body: JSON.stringify({ courseId }),
      });
      toast('success', `Generated ${result.edgesCreated} edges`);
      await Promise.all([fetchGraph(), fetchMeta()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to generate graph');
    } finally {
      setGenerating(false);
    }
  };

  const handleRemoveEdge = async (edgeId: string) => {
    try {
      await apiFetch(`/kc-graph/edges/${edgeId}`, { method: 'DELETE' });
      toast('success', 'Edge removed');
      setSelectedEdge(null);
      await Promise.all([fetchGraph(), fetchMeta()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to remove edge');
    }
  };

  const handleAddEdge = async () => {
    if (!addEdgeFrom || !addEdgeTo) return;
    try {
      await apiFetch('/kc-graph/edges', {
        method: 'POST',
        body: JSON.stringify({
          courseId,
          fromKcId: addEdgeFrom,
          toKcId: addEdgeTo,
          relationship: addEdgeRel,
          weight: 1,
        }),
      });
      toast('success', 'Edge added');
      setAddEdgeMode(false);
      setAddEdgeFrom('');
      setAddEdgeTo('');
      await Promise.all([fetchGraph(), fetchMeta()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to add edge');
    }
  };

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading Knowledge Graph...</div>;
  }

  if (!graph) {
    return <div className="text-center py-12 text-gray-400">No graph data available.</div>;
  }

  const positions = computeLayout(graph.nodes, graph.edges, SVG_WIDTH, SVG_HEIGHT);
  const posMap = new Map(positions.map((p) => [p.id, p]));

  const relColors: Record<string, string> = {
    prerequisite: '#2563eb',
    builds_on: '#7c3aed',
    related: '#9ca3af',
  };

  const statusColors: Record<string, string> = {
    PROPOSED: '#f59e0b',
    APPROVED: '#10b981',
    ARCHIVED: '#9ca3af',
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {generating ? 'Generating...' : 'Generate Graph (AI)'}
          <span className="ml-1 inline-flex"><InfoTooltip text="Use AI to auto-generate prerequisite and related edges between KCs. Triggers an LLM call." warn={false} /></span>
        </button>
        <button
          onClick={() => setAddEdgeMode(!addEdgeMode)}
          className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          {addEdgeMode ? 'Cancel Add Edge' : 'Add Edge'}
          <span className="ml-1 inline-flex"><InfoTooltip text="Manually create a relationship edge between two Knowledge Components." /></span>
        </button>
        <button
          onClick={() => setShowTopo(!showTopo)}
          className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          {showTopo ? 'Hide' : 'Show'} Learning Path
          <span className="ml-1 inline-flex"><InfoTooltip text="Display the suggested learning sequence based on graph topology (topological sort)." /></span>
        </button>
        <span className="text-xs text-gray-500">
          {graph.nodes.length} nodes, {graph.edges.length} edges
        </span>
        {cycles.length > 0 && (
          <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full font-medium">
            {cycles.length} cycle(s) detected
          </span>
        )}
      </div>

      {/* Add Edge Form */}
      {addEdgeMode && (
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border">
          <select value={addEdgeFrom} onChange={(e) => setAddEdgeFrom(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="">From KC...</option>
            {graph.nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <span className="text-gray-400">→</span>
          <select value={addEdgeTo} onChange={(e) => setAddEdgeTo(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="">To KC...</option>
            {graph.nodes.filter((n) => n.id !== addEdgeFrom).map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <select value={addEdgeRel} onChange={(e) => setAddEdgeRel(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="prerequisite">Prerequisite</option>
            <option value="builds_on">Builds On</option>
            <option value="related">Related</option>
          </select>
          <button
            onClick={handleAddEdge}
            disabled={!addEdgeFrom || !addEdgeTo}
            className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {/* Cycles Warning */}
      {cycles.length > 0 && (
        <div className="border border-red-200 bg-red-50 rounded-lg p-3">
          <h4 className="text-sm font-semibold text-red-800 mb-1">Cycles Detected</h4>
          {cycles.map((cycle, i) => (
            <p key={i} className="text-xs text-red-700">{cycle.join(' → ')}</p>
          ))}
        </div>
      )}

      {/* SVG Graph */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <svg ref={svgRef} width={SVG_WIDTH} height={SVG_HEIGHT} className="w-full" viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}>
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#2563eb" />
            </marker>
            <marker id="arrowhead-purple" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="#7c3aed" />
            </marker>
          </defs>

          {/* Edges */}
          {graph.edges.map((edge) => {
            const from = posMap.get(edge.fromKcId);
            const to = posMap.get(edge.toKcId);
            if (!from || !to) return null;
            const color = relColors[edge.relationship] || '#9ca3af';
            const isSelected = selectedEdge?.id === edge.id;

            // Shorten line to not overlap node circles
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const r = 28;
            const x1 = from.x + (dx / dist) * r;
            const y1 = from.y + (dy / dist) * r;
            const x2 = to.x - (dx / dist) * r;
            const y2 = to.y - (dy / dist) * r;

            return (
              <g key={edge.id} onClick={() => setSelectedEdge(isSelected ? null : edge)} style={{ cursor: 'pointer' }}>
                <line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={color}
                  strokeWidth={isSelected ? 3 : 1.5}
                  strokeOpacity={edge.weight}
                  markerEnd={edge.relationship !== 'related' ? `url(#arrowhead${edge.relationship === 'builds_on' ? '-purple' : ''})` : undefined}
                />
                {/* Edge label */}
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 6}
                  textAnchor="middle"
                  fontSize="8"
                  fill={color}
                  opacity={0.7}
                >
                  {edge.relationship === 'prerequisite' ? 'prereq' : edge.relationship}
                </text>
              </g>
            );
          })}

          {/* Nodes */}
          {positions.map((pos) => (
            <g key={pos.id}>
              <circle
                cx={pos.x}
                cy={pos.y}
                r={24}
                fill={statusColors[pos.status] || '#e5e7eb'}
                stroke="#fff"
                strokeWidth={2}
                opacity={0.9}
              />
              <text
                x={pos.x}
                y={pos.y + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="8"
                fill="#fff"
                fontWeight="600"
              >
                {pos.name.length > 12 ? pos.name.slice(0, 12) + '..' : pos.name}
              </text>
              {/* Full name below */}
              <text
                x={pos.x}
                y={pos.y + 36}
                textAnchor="middle"
                fontSize="9"
                fill="#374151"
              >
                {pos.name.length > 25 ? pos.name.slice(0, 25) + '...' : pos.name}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Selected Edge Info */}
      {selectedEdge && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
          <span className="text-sm text-gray-700">
            <strong>{graph.nodes.find((n) => n.id === selectedEdge.fromKcId)?.name}</strong>
            {' → '}
            <strong>{graph.nodes.find((n) => n.id === selectedEdge.toKcId)?.name}</strong>
          </span>
          <span className="text-xs px-2 py-0.5 rounded bg-white border">{selectedEdge.relationship}</span>
          <span className="text-xs text-gray-500">weight: {selectedEdge.weight}</span>
          <span className="text-xs text-gray-400">by: {selectedEdge.createdBy}</span>
          <button
            onClick={() => handleRemoveEdge(selectedEdge.id)}
            className="ml-auto px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
          >
            Remove Edge
            <span className="ml-1 inline-flex"><InfoTooltip text="Delete this edge from the KC graph. This cannot be undone." warn={true} /></span>
          </button>
        </div>
      )}

      {/* Learning Path (Topological Order) */}
      {showTopo && topoOrder.length > 0 && (
        <div className="border rounded-lg p-4">
          <h4 className="text-sm font-semibold text-gray-700 mb-3">Suggested Learning Path</h4>
          <div className="space-y-2">
            {Array.from(new Set(topoOrder.map((n) => n.level)))
              .sort((a, b) => a - b)
              .map((level) => (
                <div key={level} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-16">Level {level + 1}</span>
                  <div className="flex flex-wrap gap-1">
                    {topoOrder
                      .filter((n) => n.level === level)
                      .map((n) => (
                        <span key={n.id} className="px-2 py-1 text-xs bg-indigo-50 text-indigo-700 rounded">
                          {n.name}
                        </span>
                      ))}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10b981' }}></span> Approved
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full" style={{ backgroundColor: '#f59e0b' }}></span> Proposed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-8 h-0.5" style={{ backgroundColor: '#2563eb' }}></span> Prerequisite
        </span>
        <span className="flex items-center gap-1">
          <span className="w-8 h-0.5" style={{ backgroundColor: '#7c3aed' }}></span> Builds On
        </span>
        <span className="flex items-center gap-1">
          <span className="w-8 h-0.5" style={{ backgroundColor: '#9ca3af' }}></span> Related
        </span>
      </div>
    </div>
  );
}
