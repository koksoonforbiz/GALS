import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';
import { InfoTooltip } from './InfoTooltip';

// ─── Types ──────────────────────────────────────────────

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

interface HierarchyGroup {
  topicId: string | null;
  topicName: string;
  subtopics: Array<{
    subtopicId: string | null;
    subtopicName: string;
    kcIds: string[];
  }>;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  hierarchy: HierarchyGroup[];
}

interface TopoNode {
  id: string;
  name: string;
  level: number;
}

interface HierarchyOption {
  topics: Array<{ id: string; title: string; orderIndex: number }>;
  modules: Array<{ id: string; title: string; topicId: string | null; orderIndex: number }>;
}

interface NodePos {
  id: string;
  x: number;
  y: number;
  radius: number;
  name: string;
  status: string;
  topicId: string | null;
  subtopicId: string | null;
  topicName: string | null;
  subtopicName: string | null;
}

interface LayoutData {
  nodes: Array<{ id: string; x: number; y: number; radius?: number }>;
  viewBox?: { x: number; y: number; w: number; h: number };
}

interface Props {
  courseId: string;
}

// ─── Subtopic color palette ─────────────────────────────

const SUBTOPIC_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6',
  '#eab308', '#06b6d4', '#84cc16', '#f43f5e', '#6366f1',
  '#a855f7', '#22c55e', '#ef4444', '#0ea5e9', '#d946ef',
];

function getSubtopicColor(subtopicId: string | null, subtopicIds: string[]): string {
  if (!subtopicId) return '#9ca3af'; // gray for ungrouped
  const idx = subtopicIds.indexOf(subtopicId);
  return SUBTOPIC_COLORS[idx % SUBTOPIC_COLORS.length] || '#9ca3af';
}

// ─── Force-directed layout ──────────────────────────────

function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  clusterBySubtopic: boolean,
): NodePos[] {
  if (nodes.length === 0) return [];

  // Get unique subtopic IDs for clustering
  const subtopicGroups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const key = n.subtopicId || '__ungrouped__';
    if (!subtopicGroups.has(key)) subtopicGroups.set(key, []);
    subtopicGroups.get(key)!.push(n);
  }

  // Assign initial positions
  const positions: NodePos[] = [];
  if (clusterBySubtopic && subtopicGroups.size > 1) {
    // Cluster layout: place groups in a grid pattern
    const groupKeys = Array.from(subtopicGroups.keys());
    const cols = Math.ceil(Math.sqrt(groupKeys.length));
    const cellW = width / cols;
    const rows = Math.ceil(groupKeys.length / cols);
    const cellH = height / rows;

    for (let gi = 0; gi < groupKeys.length; gi++) {
      const gNodes = subtopicGroups.get(groupKeys[gi]!)!;
      const col = gi % cols;
      const row = Math.floor(gi / cols);
      const cx = cellW * (col + 0.5);
      const cy = cellH * (row + 0.5);
      const r = Math.min(cellW, cellH) * 0.3;

      for (let i = 0; i < gNodes.length; i++) {
        const angle = (2 * Math.PI * i) / gNodes.length;
        const n = gNodes[i]!;
        positions.push({
          id: n.id, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle),
          radius: 24, name: n.name, status: n.status,
          topicId: n.topicId, subtopicId: n.subtopicId,
          topicName: n.topicName, subtopicName: n.subtopicName,
        });
      }
    }
  } else {
    // Circle layout
    for (let i = 0; i < nodes.length; i++) {
      const angle = (2 * Math.PI * i) / nodes.length;
      const r = Math.min(width, height) * 0.35;
      const n = nodes[i]!;
      positions.push({
        id: n.id, x: width / 2 + r * Math.cos(angle), y: height / 2 + r * Math.sin(angle),
        radius: 24, name: n.name, status: n.status,
        topicId: n.topicId, subtopicId: n.subtopicId,
        topicName: n.topicName, subtopicName: n.subtopicName,
      });
    }
  }

  // Force-directed iterations
  const posMap = new Map(positions.map((p) => [p.id, p]));
  for (let iter = 0; iter < 80; iter++) {
    // Repulsion
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = 6000 / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.x -= fx; a.y -= fy;
        b.x += fx; b.y += fy;
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
      const force = (dist - 160) * 0.01;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.x += fx; a.y += fy;
      b.x -= fx; b.y -= fy;
    }
    // Cluster attraction (same subtopic nodes attract slightly)
    if (clusterBySubtopic) {
      for (let i = 0; i < positions.length; i++) {
        for (let j = i + 1; j < positions.length; j++) {
          const a = positions[i]!;
          const b = positions[j]!;
          if (a.subtopicId && a.subtopicId === b.subtopicId) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
            const force = (dist - 80) * 0.005;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            a.x += fx; a.y += fy;
            b.x -= fx; b.y -= fy;
          }
        }
      }
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
    p.y = Math.max(40, Math.min(height - 40, p.y));
  }

  return positions;
}

// ─── Edge creation mode types ───────────────────────────

type EdgeMode = 'none' | 'dependency' | 'prerequisite' | 'delete';

// ─── Component ──────────────────────────────────────────

export default function KcGraphStudioPanel({ courseId }: Props) {
  const { toast } = useToast();

  // Data state
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [topoOrder, setTopoOrder] = useState<TopoNode[]>([]);
  const [cycles, setCycles] = useState<string[][]>([]);
  const [hierarchyOptions, setHierarchyOptions] = useState<HierarchyOption | null>(null);

  // Layout state
  const [positions, setPositions] = useState<NodePos[]>([]);
  const [savedLayout, setSavedLayout] = useState<LayoutData | null>(null);
  const [layoutDirty, setLayoutDirty] = useState(false);

  // View state
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, w: 1200, h: 800 });
  const [clusterMode, setClusterMode] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [filterTopicId, setFilterTopicId] = useState<string | 'all'>('all');
  const [filterSubtopicId, setFilterSubtopicId] = useState<string | 'all'>('all');

  // Interaction state
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [edgeMode, setEdgeMode] = useState<EdgeMode>('none');
  const [edgeSourceId, setEdgeSourceId] = useState<string | null>(null);
  const [showDrawer, setShowDrawer] = useState(false);

  // Pan state
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const SVG_W = 1200;
  const SVG_H = 800;

  // ─── Collect unique subtopic IDs for coloring ──────────

  const subtopicIds = useMemo(() => {
    if (!graph) return [];
    const ids = new Set<string>();
    for (const n of graph.nodes) {
      if (n.subtopicId) ids.add(n.subtopicId);
    }
    return Array.from(ids);
  }, [graph]);

  // ─── Data fetching ─────────────────────────────────────

  const fetchGraph = useCallback(async () => {
    try {
      const data = await apiFetch<GraphData>(`/kc-graph?courseId=${courseId}`);
      setGraph(data);
      return data;
    } catch (err: any) {
      toast('error', err.message || 'Failed to load graph');
      return null;
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

  const fetchLayout = useCallback(async () => {
    try {
      const layout = await apiFetch<LayoutData | null>(`/kc-graph/layout?courseId=${courseId}`);
      setSavedLayout(layout);
      return layout;
    } catch {
      return null;
    }
  }, [courseId]);

  const fetchHierarchyOptions = useCallback(async () => {
    try {
      const opts = await apiFetch<HierarchyOption>(`/kc-graph/hierarchy-options?courseId=${courseId}`);
      setHierarchyOptions(opts);
    } catch {
      // non-critical
    }
  }, [courseId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchGraph(), fetchMeta(), fetchLayout(), fetchHierarchyOptions()]).then(([graphData, , layoutData]) => {
      // Apply saved layout or compute fresh
      if (graphData && layoutData && layoutData.nodes?.length > 0) {
        applyLayout(graphData.nodes, layoutData);
        if (layoutData.viewBox) setViewBox(layoutData.viewBox);
      } else if (graphData) {
        const computed = computeLayout(graphData.nodes, graphData.edges, SVG_W, SVG_H, clusterMode);
        setPositions(computed);
      }
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  function applyLayout(nodes: GraphNode[], layout: LayoutData) {
    const layoutMap = new Map(layout.nodes.map((n) => [n.id, n]));
    const result: NodePos[] = nodes.map((n, i) => {
      const saved = layoutMap.get(n.id);
      return {
        id: n.id,
        x: saved?.x ?? (SVG_W / 2 + 200 * Math.cos((2 * Math.PI * i) / nodes.length)),
        y: saved?.y ?? (SVG_H / 2 + 200 * Math.sin((2 * Math.PI * i) / nodes.length)),
        radius: saved?.radius ?? 24,
        name: n.name,
        status: n.status,
        topicId: n.topicId,
        subtopicId: n.subtopicId,
        topicName: n.topicName,
        subtopicName: n.subtopicName,
      };
    });
    setPositions(result);
  }

  // ─── Recompute layout on cluster toggle ────────────────

  const recomputeLayout = useCallback(() => {
    if (!graph) return;
    const filteredNodes = getFilteredNodes(graph.nodes);
    const filteredEdges = graph.edges.filter(
      (e) => filteredNodes.some((n) => n.id === e.fromKcId) && filteredNodes.some((n) => n.id === e.toKcId),
    );
    const computed = computeLayout(filteredNodes, filteredEdges, SVG_W, SVG_H, clusterMode);
    setPositions(computed);
    setLayoutDirty(true);
  }, [graph, clusterMode, filterTopicId, filterSubtopicId]);

  // ─── Filtering ─────────────────────────────────────────

  function getFilteredNodes(nodes: GraphNode[]): GraphNode[] {
    return nodes.filter((n) => {
      if (filterTopicId !== 'all' && n.topicId !== filterTopicId) return false;
      if (filterSubtopicId !== 'all' && n.subtopicId !== filterSubtopicId) return false;
      return true;
    });
  }

  const filteredNodeIds = useMemo(() => {
    if (!graph) return new Set<string>();
    return new Set(getFilteredNodes(graph.nodes).map((n) => n.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, filterTopicId, filterSubtopicId]);

  const visiblePositions = useMemo(
    () => positions.filter((p) => filteredNodeIds.has(p.id)),
    [positions, filteredNodeIds],
  );

  const visibleEdges = useMemo(() => {
    if (!graph) return [];
    return graph.edges.filter((e) => filteredNodeIds.has(e.fromKcId) && filteredNodeIds.has(e.toKcId));
  }, [graph, filteredNodeIds]);

  // ─── Actions ───────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await apiFetch<{ edgesCreated: number }>('/kc-graph/generate', {
        method: 'POST',
        body: JSON.stringify({ courseId }),
      });
      toast('success', `Generated ${result.edgesCreated} edges`);
      const newGraph = await fetchGraph();
      await fetchMeta();
      if (newGraph) {
        const computed = computeLayout(newGraph.nodes, newGraph.edges, SVG_W, SVG_H, clusterMode);
        setPositions(computed);
        setLayoutDirty(true);
      }
    } catch (err: any) {
      toast('error', err.message || 'Failed to generate graph');
    } finally {
      setGenerating(false);
    }
  };

  const handleRemoveEdge = async (edgeId: string) => {
    try {
      await apiFetch(`/kc-graph/edges/${edgeId}?courseId=${courseId}`, { method: 'DELETE' });
      toast('success', 'Edge removed');
      setSelectedEdge(null);
      await Promise.all([fetchGraph(), fetchMeta()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to remove edge');
    }
  };

  const handleAddEdge = async (fromId: string, toId: string, relationship: string) => {
    try {
      await apiFetch('/kc-graph/edges', {
        method: 'POST',
        body: JSON.stringify({ courseId, fromKcId: fromId, toKcId: toId, relationship, weight: 1 }),
      });
      toast('success', `${relationship} edge added`);
      await Promise.all([fetchGraph(), fetchMeta()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to add edge');
    }
  };

  const handleSaveLayout = async () => {
    const layout: LayoutData = {
      nodes: positions.map((p) => ({ id: p.id, x: p.x, y: p.y, radius: p.radius })),
      viewBox,
    };
    try {
      await apiFetch('/kc-graph/layout', {
        method: 'POST',
        body: JSON.stringify({ courseId, layout }),
      });
      toast('success', 'Layout saved');
      setLayoutDirty(false);
    } catch (err: any) {
      toast('error', err.message || 'Failed to save layout');
    }
  };

  const handleUpdateHierarchy = async (kcId: string, topicId: string | null, subtopicId: string | null) => {
    try {
      await apiFetch(`/kc-graph/hierarchy/${kcId}`, {
        method: 'PATCH',
        body: JSON.stringify({ topicId, subtopicId, courseId }),
      });
      toast('success', 'KC hierarchy updated');
      await fetchGraph();
    } catch (err: any) {
      toast('error', err.message || 'Failed to update hierarchy');
    }
  };

  // ─── SVG interaction handlers ──────────────────────────

  const svgPoint = useCallback((clientX: number, clientY: number) => {
    // Convert screen coords to SVG coords
    return {
      x: viewBox.x + (clientX / (containerRef.current?.clientWidth || 1)) * viewBox.w,
      y: viewBox.y + (clientY / (containerRef.current?.clientHeight || 1)) * viewBox.h,
    };
  }, [viewBox]);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (edgeMode !== 'none') {
      // Edge creation / deletion
      if (edgeMode === 'delete') {
        // Find edges connected to this node and show selection
        return;
      }
      if (!edgeSourceId) {
        setEdgeSourceId(nodeId);
      } else if (edgeSourceId !== nodeId) {
        const rel = edgeMode === 'prerequisite' ? 'prerequisite' : 'builds_on';
        handleAddEdge(edgeSourceId, nodeId, rel);
        setEdgeSourceId(null);
      }
      return;
    }
    // Start dragging
    setDraggingNodeId(nodeId);
    setSelectedNodeId(nodeId);
    setSelectedEdge(null);
  }, [edgeMode, edgeSourceId]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingNodeId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const svgX = viewBox.x + (relX / rect.width) * viewBox.w;
      const svgY = viewBox.y + (relY / rect.height) * viewBox.h;
      setPositions((prev) =>
        prev.map((p) => (p.id === draggingNodeId ? { ...p, x: svgX, y: svgY } : p)),
      );
      setLayoutDirty(true);
    } else if (isPanning && panStartRef.current) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = ((e.clientX - panStartRef.current.x) / rect.width) * viewBox.w;
      const dy = ((e.clientY - panStartRef.current.y) / rect.height) * viewBox.h;
      setViewBox({
        ...viewBox,
        x: panStartRef.current.vx - dx,
        y: panStartRef.current.vy - dy,
      });
    }
  }, [draggingNodeId, isPanning, viewBox]);

  const handleSvgMouseUp = useCallback(() => {
    setDraggingNodeId(null);
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start pan if clicking on background (not on a node)
    if (edgeMode === 'none') {
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, vx: viewBox.x, vy: viewBox.y };
      setSelectedNodeId(null);
      setSelectedEdge(null);
      setShowDrawer(false);
    }
  }, [edgeMode, viewBox]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    // Zoom centered on mouse position
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const newW = viewBox.w * factor;
    const newH = viewBox.h * factor;
    // Clamp zoom
    if (newW < 200 || newW > 5000) return;
    setViewBox({
      x: viewBox.x + (viewBox.w - newW) * relX,
      y: viewBox.y + (viewBox.h - newH) * relY,
      w: newW,
      h: newH,
    });
  }, [viewBox]);

  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setShowDrawer(true);
  }, []);

  const handleNodeResize = useCallback((nodeId: string, delta: number) => {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === nodeId ? { ...p, radius: Math.max(16, Math.min(60, p.radius + delta)) } : p,
      ),
    );
    setLayoutDirty(true);
  }, []);

  // ─── Zoom controls ────────────────────────────────────

  const zoomIn = () => {
    setViewBox((v) => {
      const newW = v.w * 0.8;
      const newH = v.h * 0.8;
      return { x: v.x + (v.w - newW) / 2, y: v.y + (v.h - newH) / 2, w: newW, h: newH };
    });
  };

  const zoomOut = () => {
    setViewBox((v) => {
      const newW = v.w * 1.25;
      const newH = v.h * 1.25;
      if (newW > 5000) return v;
      return { x: v.x + (v.w - newW) / 2, y: v.y + (v.h - newH) / 2, w: newW, h: newH };
    });
  };

  const zoomFit = () => {
    if (visiblePositions.length === 0) return;
    const minX = Math.min(...visiblePositions.map((p) => p.x - p.radius));
    const maxX = Math.max(...visiblePositions.map((p) => p.x + p.radius));
    const minY = Math.min(...visiblePositions.map((p) => p.y - p.radius));
    const maxY = Math.max(...visiblePositions.map((p) => p.y + p.radius));
    const pad = 80;
    setViewBox({ x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 });
  };

  // ─── Render helpers ────────────────────────────────────

  const posMap = useMemo(() => new Map(positions.map((p) => [p.id, p])), [positions]);

  const relColors: Record<string, string> = {
    prerequisite: '#2563eb',
    builds_on: '#7c3aed',
    related: '#9ca3af',
  };

  const selectedNode = useMemo(
    () => (selectedNodeId && graph ? graph.nodes.find((n) => n.id === selectedNodeId) : null),
    [selectedNodeId, graph],
  );

  // ─── Render ────────────────────────────────────────────

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading Knowledge Graph...</div>;
  }

  if (!graph) {
    return <div className="text-center py-12 text-gray-400">No graph data available.</div>;
  }

  // Cluster bounding boxes for visual grouping
  const clusterBounds = clusterMode ? (() => {
    const groups = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; name: string; color: string }>();
    for (const p of visiblePositions) {
      const key = p.subtopicId || '__ungrouped__';
      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          minX: p.x - p.radius - 20, minY: p.y - p.radius - 20,
          maxX: p.x + p.radius + 20, maxY: p.y + p.radius + 40,
          name: p.subtopicName || 'Ungrouped',
          color: getSubtopicColor(p.subtopicId, subtopicIds),
        });
      } else {
        existing.minX = Math.min(existing.minX, p.x - p.radius - 20);
        existing.minY = Math.min(existing.minY, p.y - p.radius - 20);
        existing.maxX = Math.max(existing.maxX, p.x + p.radius + 20);
        existing.maxY = Math.max(existing.maxY, p.y + p.radius + 40);
      }
    }
    return groups;
  })() : null;

  return (
    <div className="flex gap-4 h-full">
      {/* ─── Sidebar ─────────────────────────────────── */}
      {showSidebar && (
        <div className="w-64 flex-shrink-0 border rounded-lg bg-white overflow-y-auto max-h-[700px]">
          <div className="p-3 border-b">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1">
              Hierarchy
              <InfoTooltip text="Filter and group KCs by Topic and Subtopic. Assign KCs to topics/subtopics using the node drawer." />
            </h3>
          </div>

          {/* Filter controls */}
          <div className="p-3 space-y-2 border-b">
            <label className="text-xs text-gray-500 block">Filter by Topic</label>
            <select
              value={filterTopicId}
              onChange={(e) => { setFilterTopicId(e.target.value); setFilterSubtopicId('all'); }}
              className="w-full border rounded px-2 py-1 text-xs"
            >
              <option value="all">All Topics</option>
              {hierarchyOptions?.topics.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>

            <label className="text-xs text-gray-500 block">Filter by Subtopic</label>
            <select
              value={filterSubtopicId}
              onChange={(e) => setFilterSubtopicId(e.target.value)}
              className="w-full border rounded px-2 py-1 text-xs"
            >
              <option value="all">All Subtopics</option>
              {hierarchyOptions?.modules
                .filter((m) => filterTopicId === 'all' || m.topicId === filterTopicId)
                .map((m) => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
            </select>
          </div>

          {/* Hierarchy tree */}
          <div className="p-3 space-y-2">
            {graph.hierarchy.map((group) => (
              <div key={group.topicId || 'ungrouped'} className="space-y-1">
                <div className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-gray-400" />
                  {group.topicName}
                </div>
                {group.subtopics.map((sub) => (
                  <div key={sub.subtopicId || 'ungrouped-sub'} className="ml-3 space-y-0.5">
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: getSubtopicColor(sub.subtopicId, subtopicIds) }}
                      />
                      {sub.subtopicName} ({sub.kcIds.length})
                    </div>
                    {sub.kcIds.map((kcId) => {
                      const node = graph.nodes.find((n) => n.id === kcId);
                      if (!node) return null;
                      return (
                        <button
                          key={kcId}
                          onClick={() => { setSelectedNodeId(kcId); setShowDrawer(true); }}
                          className={`ml-3 text-xs block truncate w-full text-left px-1 py-0.5 rounded hover:bg-blue-50 ${
                            selectedNodeId === kcId ? 'bg-blue-100 text-blue-700' : 'text-gray-600'
                          }`}
                        >
                          {node.name}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Main area ───────────────────────────────── */}
      <div className="flex-1 space-y-3 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className="px-2 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            {showSidebar ? 'Hide' : 'Show'} Sidebar
          </button>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate (AI)'}
            <span className="ml-1 inline-flex"><InfoTooltip text="Use AI to auto-generate prerequisite and related edges between KCs." warn={false} /></span>
          </button>

          <div className="h-5 w-px bg-gray-300" />

          {/* Edge creation modes */}
          <button
            onClick={() => { setEdgeMode(edgeMode === 'dependency' ? 'none' : 'dependency'); setEdgeSourceId(null); }}
            className={`px-2 py-1.5 text-xs rounded ${edgeMode === 'dependency' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            + Builds On
            <span className="ml-1 inline-flex"><InfoTooltip text="Click two nodes to create a 'builds_on' edge. First click = source, second = target." /></span>
          </button>
          <button
            onClick={() => { setEdgeMode(edgeMode === 'prerequisite' ? 'none' : 'prerequisite'); setEdgeSourceId(null); }}
            className={`px-2 py-1.5 text-xs rounded ${edgeMode === 'prerequisite' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            + Prerequisite
            <span className="ml-1 inline-flex"><InfoTooltip text="Click two nodes to create a 'prerequisite' edge. First click = prerequisite, second = dependent." /></span>
          </button>
          <button
            onClick={() => { setEdgeMode(edgeMode === 'delete' ? 'none' : 'delete'); setEdgeSourceId(null); }}
            className={`px-2 py-1.5 text-xs rounded ${edgeMode === 'delete' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Delete Edge
            <span className="ml-1 inline-flex"><InfoTooltip text="Click an edge to delete it from the graph." warn={true} /></span>
          </button>

          {edgeMode !== 'none' && edgeSourceId && (
            <span className="text-xs text-blue-600 animate-pulse">
              Click target node...
            </span>
          )}

          <div className="h-5 w-px bg-gray-300" />

          {/* View toggles */}
          <button
            onClick={() => { setClusterMode(!clusterMode); }}
            className={`px-2 py-1.5 text-xs rounded ${clusterMode ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            Cluster
            <span className="ml-1 inline-flex"><InfoTooltip text="Group nodes visually by subtopic with bounding boxes." /></span>
          </button>
          <button onClick={recomputeLayout} className="px-2 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
            Re-layout
            <span className="ml-1 inline-flex"><InfoTooltip text="Recompute the force-directed layout from scratch. Drag individual nodes to adjust afterward." /></span>
          </button>

          <div className="h-5 w-px bg-gray-300" />

          {/* Zoom */}
          <button onClick={zoomIn} className="px-2 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">+</button>
          <button onClick={zoomOut} className="px-2 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">−</button>
          <button onClick={zoomFit} className="px-2 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">Fit</button>

          <div className="h-5 w-px bg-gray-300" />

          <button
            onClick={handleSaveLayout}
            disabled={!layoutDirty}
            className="px-2 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-40"
          >
            Save Layout
            <span className="ml-1 inline-flex"><InfoTooltip text="Persist current node positions and zoom level so they load next time." /></span>
          </button>

          <span className="text-xs text-gray-400 ml-auto">
            {visiblePositions.length}/{graph.nodes.length} nodes, {visibleEdges.length} edges
          </span>
          {cycles.length > 0 && (
            <span className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded-full font-medium">
              {cycles.length} cycle(s)
            </span>
          )}
        </div>

        {/* Cycles Warning */}
        {cycles.length > 0 && (
          <div className="border border-red-200 bg-red-50 rounded-lg p-2">
            <h4 className="text-xs font-semibold text-red-800 mb-1">Cycles Detected</h4>
            {cycles.map((cycle, i) => (
              <p key={i} className="text-xs text-red-700">{cycle.join(' → ')}</p>
            ))}
          </div>
        )}

        {/* SVG Graph */}
        <div
          ref={containerRef}
          className="border rounded-lg bg-white overflow-hidden relative"
          style={{ height: '600px', cursor: draggingNodeId ? 'grabbing' : isPanning ? 'grabbing' : edgeMode !== 'none' ? 'crosshair' : 'grab' }}
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgMouseUp}
            onWheel={handleWheel}
          >
            <defs>
              <marker id="arrow-blue" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#2563eb" />
              </marker>
              <marker id="arrow-purple" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#7c3aed" />
              </marker>
            </defs>

            {/* Cluster bounding boxes */}
            {clusterBounds && Array.from(clusterBounds.entries()).map(([key, bounds]) => (
              <g key={`cluster-${key}`}>
                <rect
                  x={bounds.minX} y={bounds.minY}
                  width={bounds.maxX - bounds.minX} height={bounds.maxY - bounds.minY}
                  rx={12} fill={bounds.color} fillOpacity={0.06}
                  stroke={bounds.color} strokeOpacity={0.25} strokeWidth={1.5}
                  strokeDasharray="6 3"
                />
                <text
                  x={bounds.minX + 8} y={bounds.minY + 14}
                  fontSize="10" fontWeight="600" fill={bounds.color} opacity={0.7}
                >
                  {bounds.name}
                </text>
              </g>
            ))}

            {/* Edges */}
            {visibleEdges.map((edge) => {
              const from = posMap.get(edge.fromKcId);
              const to = posMap.get(edge.toKcId);
              if (!from || !to) return null;
              const color = relColors[edge.relationship] || '#9ca3af';
              const isSelected = selectedEdge?.id === edge.id;

              const dx = to.x - from.x;
              const dy = to.y - from.y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist === 0) return null;
              const rFrom = from.radius + 4;
              const rTo = to.radius + 4;
              const x1 = from.x + (dx / dist) * rFrom;
              const y1 = from.y + (dy / dist) * rFrom;
              const x2 = to.x - (dx / dist) * rTo;
              const y2 = to.y - (dy / dist) * rTo;

              return (
                <g
                  key={edge.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (edgeMode === 'delete') {
                      handleRemoveEdge(edge.id);
                    } else {
                      setSelectedEdge(isSelected ? null : edge);
                    }
                  }}
                  style={{ cursor: edgeMode === 'delete' ? 'pointer' : 'default' }}
                >
                  {/* Wider invisible hit area */}
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
                  <line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={edgeMode === 'delete' ? '#ef4444' : color}
                    strokeWidth={isSelected ? 3 : 1.5}
                    strokeOpacity={edge.weight}
                    markerEnd={edge.relationship !== 'related' ? `url(#arrow-${edge.relationship === 'builds_on' ? 'purple' : 'blue'})` : undefined}
                  />
                  <text
                    x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 6}
                    textAnchor="middle" fontSize="8" fill={color} opacity={0.6}
                  >
                    {edge.relationship === 'prerequisite' ? 'prereq' : edge.relationship}
                  </text>
                </g>
              );
            })}

            {/* Pending edge line (when creating an edge) */}
            {edgeSourceId && (() => {
              const source = posMap.get(edgeSourceId);
              if (!source) return null;
              return (
                <circle cx={source.x} cy={source.y} r={source.radius + 6}
                  fill="none" stroke={edgeMode === 'prerequisite' ? '#2563eb' : '#7c3aed'}
                  strokeWidth={2} strokeDasharray="4 2" opacity={0.7}
                />
              );
            })()}

            {/* Nodes */}
            {visiblePositions.map((pos) => {
              const isSelected = selectedNodeId === pos.id;
              const nodeColor = getSubtopicColor(pos.subtopicId, subtopicIds);

              return (
                <g
                  key={pos.id}
                  onMouseDown={(e) => handleNodeMouseDown(e, pos.id)}
                  onDoubleClick={() => handleNodeDoubleClick(pos.id)}
                  style={{ cursor: edgeMode !== 'none' ? 'crosshair' : 'pointer' }}
                >
                  {/* Selection ring */}
                  {isSelected && (
                    <circle cx={pos.x} cy={pos.y} r={pos.radius + 5}
                      fill="none" stroke="#2563eb" strokeWidth={2} opacity={0.6}
                    />
                  )}
                  {/* Node circle */}
                  <circle
                    cx={pos.x} cy={pos.y} r={pos.radius}
                    fill={nodeColor} stroke="#fff" strokeWidth={2} opacity={0.9}
                  />
                  {/* Status indicator (small dot) */}
                  <circle
                    cx={pos.x + pos.radius * 0.6} cy={pos.y - pos.radius * 0.6}
                    r={4}
                    fill={pos.status === 'APPROVED' ? '#10b981' : pos.status === 'PROPOSED' ? '#f59e0b' : '#9ca3af'}
                    stroke="#fff" strokeWidth={1}
                  />
                  {/* Label inside node */}
                  <text
                    x={pos.x} y={pos.y + 1}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.max(7, pos.radius * 0.35)} fill="#fff" fontWeight="600"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {pos.name.length > Math.floor(pos.radius / 3) ? pos.name.slice(0, Math.floor(pos.radius / 3)) + '..' : pos.name}
                  </text>
                  {/* Full name below */}
                  <text
                    x={pos.x} y={pos.y + pos.radius + 12}
                    textAnchor="middle" fontSize="9" fill="#374151"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    {pos.name.length > 28 ? pos.name.slice(0, 28) + '...' : pos.name}
                  </text>
                  {/* Resize handles (only when selected) */}
                  {isSelected && (
                    <>
                      <circle
                        cx={pos.x + pos.radius} cy={pos.y}
                        r={4} fill="#2563eb" stroke="#fff" strokeWidth={1}
                        style={{ cursor: 'ew-resize' }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          const startX = e.clientX;
                          const startRadius = pos.radius;
                          const onMove = (ev: MouseEvent) => {
                            const delta = (ev.clientX - startX) * (viewBox.w / (containerRef.current?.clientWidth || 1));
                            handleNodeResize(pos.id, delta > 0 ? 1 : -1);
                          };
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                        }}
                      />
                    </>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Selected Edge Info */}
        {selectedEdge && (
          <div className="flex items-center gap-3 p-2 bg-blue-50 rounded-lg border border-blue-200 text-sm">
            <strong>{graph.nodes.find((n) => n.id === selectedEdge.fromKcId)?.name}</strong>
            <span className="text-gray-400">→</span>
            <strong>{graph.nodes.find((n) => n.id === selectedEdge.toKcId)?.name}</strong>
            <span className="text-xs px-2 py-0.5 rounded bg-white border">{selectedEdge.relationship}</span>
            <span className="text-xs text-gray-500">w: {selectedEdge.weight}</span>
            <span className="text-xs text-gray-400">by: {selectedEdge.createdBy}</span>
            <button
              onClick={() => handleRemoveEdge(selectedEdge.id)}
              className="ml-auto px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
            >
              Remove
            </button>
          </div>
        )}

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
          <span className="font-medium text-gray-600">Edges:</span>
          <span className="flex items-center gap-1">
            <span className="w-6 h-0.5 bg-blue-600" /> Prerequisite
          </span>
          <span className="flex items-center gap-1">
            <span className="w-6 h-0.5 bg-purple-600" /> Builds On
          </span>
          <span className="flex items-center gap-1">
            <span className="w-6 h-0.5 bg-gray-400" /> Related
          </span>
          {subtopicIds.length > 0 && (
            <>
              <span className="mx-1 text-gray-300">|</span>
              <span className="font-medium text-gray-600">Subtopics:</span>
              {subtopicIds.slice(0, 6).map((sid) => {
                const name = graph.nodes.find((n) => n.subtopicId === sid)?.subtopicName;
                return (
                  <span key={sid} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getSubtopicColor(sid, subtopicIds) }} />
                    <span className="truncate max-w-[80px]">{name}</span>
                  </span>
                );
              })}
              {subtopicIds.length > 6 && <span className="text-gray-400">+{subtopicIds.length - 6}</span>}
            </>
          )}
        </div>
      </div>

      {/* ─── Node Detail Drawer ──────────────────────── */}
      {showDrawer && selectedNode && (
        <div className="w-72 flex-shrink-0 border rounded-lg bg-white overflow-y-auto max-h-[700px]">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-700">KC Details</h3>
            <button onClick={() => setShowDrawer(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
          </div>
          <div className="p-3 space-y-3">
            <div>
              <label className="text-xs text-gray-500">Name</label>
              <p className="text-sm font-medium text-gray-800">{selectedNode.name}</p>
            </div>
            <div>
              <label className="text-xs text-gray-500">Status</label>
              <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                selectedNode.status === 'APPROVED' ? 'bg-green-100 text-green-700' :
                selectedNode.status === 'PROPOSED' ? 'bg-amber-100 text-amber-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {selectedNode.status}
              </span>
            </div>
            {selectedNode.description && (
              <div>
                <label className="text-xs text-gray-500">Description</label>
                <p className="text-xs text-gray-700 mt-0.5">{selectedNode.description}</p>
              </div>
            )}

            {/* Hierarchy assignment */}
            <div className="border-t pt-3">
              <label className="text-xs text-gray-500 block mb-1">Topic</label>
              <select
                value={selectedNode.topicId || ''}
                onChange={(e) => handleUpdateHierarchy(selectedNode.id, e.target.value || null, selectedNode.subtopicId)}
                className="w-full border rounded px-2 py-1 text-xs"
              >
                <option value="">None</option>
                {hierarchyOptions?.topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>

              <label className="text-xs text-gray-500 block mb-1 mt-2">Subtopic (Module)</label>
              <select
                value={selectedNode.subtopicId || ''}
                onChange={(e) => handleUpdateHierarchy(selectedNode.id, selectedNode.topicId, e.target.value || null)}
                className="w-full border rounded px-2 py-1 text-xs"
              >
                <option value="">None</option>
                {hierarchyOptions?.modules
                  .filter((m) => !selectedNode.topicId || m.topicId === selectedNode.topicId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
              </select>
            </div>

            {/* Connections */}
            <div className="border-t pt-3">
              <label className="text-xs text-gray-500 block mb-1">Connections</label>
              {graph.edges
                .filter((e) => e.fromKcId === selectedNode.id || e.toKcId === selectedNode.id)
                .map((e) => {
                  const isFrom = e.fromKcId === selectedNode.id;
                  const otherId = isFrom ? e.toKcId : e.fromKcId;
                  const other = graph.nodes.find((n) => n.id === otherId);
                  return (
                    <div key={e.id} className="flex items-center gap-1 text-xs py-0.5">
                      <span className={`w-1.5 h-1.5 rounded-full ${e.relationship === 'prerequisite' ? 'bg-blue-500' : e.relationship === 'builds_on' ? 'bg-purple-500' : 'bg-gray-400'}`} />
                      <span className="text-gray-500">{isFrom ? '→' : '←'}</span>
                      <span className="truncate text-gray-700">{other?.name || otherId}</span>
                      <span className="text-gray-400 ml-auto">{e.relationship === 'prerequisite' ? 'prereq' : e.relationship}</span>
                    </div>
                  );
                })}
              {graph.edges.filter((e) => e.fromKcId === selectedNode.id || e.toKcId === selectedNode.id).length === 0 && (
                <p className="text-xs text-gray-400 italic">No connections</p>
              )}
            </div>

            {/* Resize control */}
            <div className="border-t pt-3">
              <label className="text-xs text-gray-500 block mb-1">Node Size</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleNodeResize(selectedNode.id, -4)}
                  className="px-2 py-0.5 text-xs border rounded hover:bg-gray-50"
                >−</button>
                <span className="text-xs text-gray-600">
                  {posMap.get(selectedNode.id)?.radius || 24}px
                </span>
                <button
                  onClick={() => handleNodeResize(selectedNode.id, 4)}
                  className="px-2 py-0.5 text-xs border rounded hover:bg-gray-50"
                >+</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
