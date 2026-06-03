import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../rag/llm.service';
import {
  buildGraphGenerationSystemPrompt,
  buildGraphGenerationUserPrompt,
} from './kc-graph-prompts';

interface EdgeRaw {
  fromKcId: string;
  toKcId: string;
  relationship: string;
  weight: number;
  reasoning?: string;
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

interface GraphEdgeData {
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
  edges: GraphEdgeData[];
  hierarchy: HierarchyGroup[];
}

interface LayoutNodePos {
  id: string;
  x: number;
  y: number;
  radius?: number;
}

interface GraphLayoutData {
  nodes: LayoutNodePos[];
  viewBox?: { x: number; y: number; w: number; h: number };
}

@Injectable()
export class KcGraphService {
  private readonly logger = new Logger(KcGraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  /**
   * Generate knowledge graph edges using LLM for approved KCs in a course.
   */
  async generateGraph(courseId: string, userId: string): Promise<{ edgesCreated: number }> {
    // 1. Get approved KCs
    const kcs = await this.prisma.proposedKC.findMany({
      where: { courseId, status: 'APPROVED' },
      select: { id: true, name: true, description: true },
    });

    if (kcs.length < 2) {
      throw new BadRequestException('Need at least 2 approved KCs to generate a graph');
    }

    // 2. Get course title
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { title: true },
    });
    if (!course) throw new NotFoundException('Course not found');

    // 3. Verify the teacher has a key configured
    const hasKey = await this.llmService.hasApiKey(userId);
    if (!hasKey) {
      throw new BadRequestException('No LLM API key configured');
    }

    // 4. Build prompts
    const systemPrompt = buildGraphGenerationSystemPrompt();
    const userPrompt = buildGraphGenerationUserPrompt(course.title, kcs);

    // 5. Call LLM through the registry-driven funnel
    const llmResponse = await this.llmService.callLlmForUser(
      userId,
      systemPrompt,
      userPrompt,
      { feature: 'kc_graph_generation', courseId },
      { jsonMode: true, maxTokens: 4096, temperature: 0.3 },
    );

    // 6. Parse response
    const edges = this.parseEdgesResponse(llmResponse.content);

    // 7. Validate edges — only allow edges between existing approved KCs
    const kcIds = new Set(kcs.map((k) => k.id));
    const validEdges = edges.filter(
      (e) =>
        kcIds.has(e.fromKcId) &&
        kcIds.has(e.toKcId) &&
        e.fromKcId !== e.toKcId &&
        ['prerequisite', 'builds_on', 'related'].includes(e.relationship),
    );

    // 8. Check for cycles and remove edges that would create them
    const cleanEdges = this.removeCyclicEdges(validEdges);

    // 9. Upsert edges
    let created = 0;
    for (const edge of cleanEdges) {
      try {
        await this.prisma.kcEdge.upsert({
          where: {
            fromKcId_toKcId: {
              fromKcId: edge.fromKcId,
              toKcId: edge.toKcId,
            },
          },
          update: {
            relationship: edge.relationship,
            weight: Math.max(0, Math.min(1, edge.weight || 1)),
          },
          create: {
            courseId,
            fromKcId: edge.fromKcId,
            toKcId: edge.toKcId,
            relationship: edge.relationship,
            weight: Math.max(0, Math.min(1, edge.weight || 1)),
            createdBy: 'ai',
          },
        });
        created++;
      } catch (err: any) {
        this.logger.warn(`Failed to upsert edge ${edge.fromKcId} -> ${edge.toKcId}: ${err.message}`);
      }
    }

    this.logger.log(`Generated ${created} graph edges for course ${courseId}`);
    return { edgesCreated: created };
  }

  /**
   * Get the full graph (nodes + edges + hierarchy) for a course.
   */
  async getGraph(courseId: string): Promise<GraphData> {
    const [kcs, edges] = await Promise.all([
      this.prisma.proposedKC.findMany({
        where: { courseId, status: { not: 'ARCHIVED' } },
        select: {
          id: true, name: true, status: true, description: true,
          topicId: true, subtopicId: true,
          topic: { select: { id: true, title: true } },
          subtopic: { select: { id: true, title: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.kcEdge.findMany({
        where: { courseId },
        select: {
          id: true, fromKcId: true, toKcId: true,
          relationship: true, weight: true, createdBy: true,
        },
      }),
    ]);

    const nodes: GraphNode[] = kcs.map((kc) => ({
      id: kc.id,
      name: kc.name,
      status: kc.status,
      description: kc.description,
      topicId: kc.topicId,
      subtopicId: kc.subtopicId,
      topicName: kc.topic?.title ?? null,
      subtopicName: kc.subtopic?.title ?? null,
    }));

    // Build hierarchy groups
    const hierarchy = this.buildHierarchy(nodes);

    return { nodes, edges, hierarchy };
  }

  private buildHierarchy(nodes: GraphNode[]): HierarchyGroup[] {
    const topicMap = new Map<string | null, { topicName: string; subs: Map<string | null, { subName: string; kcIds: string[] }> }>();

    for (const n of nodes) {
      const tKey = n.topicId;
      const tName = n.topicName || 'Ungrouped';
      if (!topicMap.has(tKey)) {
        topicMap.set(tKey, { topicName: tName, subs: new Map() });
      }
      const topic = topicMap.get(tKey)!;
      const sKey = n.subtopicId;
      const sName = n.subtopicName || 'Ungrouped';
      if (!topic.subs.has(sKey)) {
        topic.subs.set(sKey, { subName: sName, kcIds: [] });
      }
      topic.subs.get(sKey)!.kcIds.push(n.id);
    }

    const result: HierarchyGroup[] = [];
    for (const [topicId, { topicName, subs }] of topicMap) {
      const subtopics: HierarchyGroup['subtopics'] = [];
      for (const [subtopicId, { subName, kcIds }] of subs) {
        subtopics.push({ subtopicId, subtopicName: subName, kcIds });
      }
      result.push({ topicId, topicName, subtopics });
    }
    return result;
  }

  /**
   * Add a manual edge.
   */
  async addEdge(courseId: string, fromKcId: string, toKcId: string, relationship: string, weight: number) {
    if (fromKcId === toKcId) throw new BadRequestException('Cannot create self-loop');

    return this.prisma.kcEdge.create({
      data: {
        courseId,
        fromKcId,
        toKcId,
        relationship: relationship || 'prerequisite',
        weight: Math.max(0, Math.min(1, weight || 1)),
        createdBy: 'human',
      },
    });
  }

  /**
   * Remove an edge.
   */
  async removeEdge(edgeId: string) {
    const edge = await this.prisma.kcEdge.findUnique({ where: { id: edgeId } });
    if (!edge) throw new NotFoundException(`Edge ${edgeId} not found`);
    await this.prisma.kcEdge.delete({ where: { id: edgeId } });
    return { deleted: true };
  }

  /**
   * Update an edge's weight or relationship.
   */
  async updateEdge(edgeId: string, dto: { relationship?: string; weight?: number }) {
    const edge = await this.prisma.kcEdge.findUnique({ where: { id: edgeId } });
    if (!edge) throw new NotFoundException(`Edge ${edgeId} not found`);

    const data: any = {};
    if (dto.relationship) data.relationship = dto.relationship;
    if (dto.weight !== undefined) data.weight = Math.max(0, Math.min(1, dto.weight));

    return this.prisma.kcEdge.update({ where: { id: edgeId }, data });
  }

  /**
   * Get topological ordering of KCs (for learning path).
   */
  async getTopologicalOrder(courseId: string): Promise<Array<{ id: string; name: string; level: number }>> {
    const graph = await this.getGraph(courseId);

    // Build adjacency and in-degree maps
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const node of graph.nodes) {
      inDegree.set(node.id, 0);
      adj.set(node.id, []);
    }

    // Only use prerequisite/builds_on edges for ordering
    const orderingEdges = graph.edges.filter(
      (e) => e.relationship === 'prerequisite' || e.relationship === 'builds_on',
    );

    for (const edge of orderingEdges) {
      if (inDegree.has(edge.fromKcId) && inDegree.has(edge.toKcId)) {
        adj.get(edge.fromKcId)!.push(edge.toKcId);
        inDegree.set(edge.toKcId, (inDegree.get(edge.toKcId) || 0) + 1);
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const result: Array<{ id: string; name: string; level: number }> = [];
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
    let level = 0;

    while (queue.length > 0) {
      const nextQueue: string[] = [];
      for (const id of queue) {
        const node = nodeMap.get(id);
        if (node) result.push({ id: node.id, name: node.name, level });
        for (const neighbor of adj.get(id) || []) {
          const newDeg = (inDegree.get(neighbor) || 1) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) nextQueue.push(neighbor);
        }
      }
      queue.length = 0;
      queue.push(...nextQueue);
      level++;
    }

    return result;
  }

  /**
   * Detect cycles in the graph.
   */
  async detectCycles(courseId: string): Promise<string[][]> {
    const graph = await this.getGraph(courseId);
    const orderingEdges = graph.edges.filter(
      (e) => e.relationship === 'prerequisite' || e.relationship === 'builds_on',
    );

    // Build adjacency
    const adj = new Map<string, string[]>();
    for (const node of graph.nodes) adj.set(node.id, []);
    for (const edge of orderingEdges) {
      if (adj.has(edge.fromKcId)) {
        adj.get(edge.fromKcId)!.push(edge.toKcId);
      }
    }

    // DFS-based cycle detection
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    const parent = new Map<string, string | null>();
    const cycles: string[][] = [];
    const nodeMap = new Map(graph.nodes.map((n) => [n.id, n.name]));

    for (const node of graph.nodes) color.set(node.id, WHITE);

    const dfs = (u: string) => {
      color.set(u, GRAY);
      for (const v of adj.get(u) || []) {
        if (color.get(v) === GRAY) {
          // Found cycle — trace back
          const cycle: string[] = [nodeMap.get(v) || v];
          let curr = u;
          while (curr !== v) {
            cycle.unshift(nodeMap.get(curr) || curr);
            curr = parent.get(curr) || v;
          }
          cycle.push(nodeMap.get(v) || v);
          cycles.push(cycle);
        } else if (color.get(v) === WHITE) {
          parent.set(v, u);
          dfs(v);
        }
      }
      color.set(u, BLACK);
    };

    for (const node of graph.nodes) {
      if (color.get(node.id) === WHITE) dfs(node.id);
    }

    return cycles;
  }

  /**
   * Save graph layout (node positions, sizes, view state) for a course.
   */
  async saveLayout(courseId: string, layout: GraphLayoutData): Promise<{ saved: boolean }> {
    await this.prisma.kcGraphLayout.upsert({
      where: { courseId },
      update: { layoutJson: layout as unknown as import('@prisma/client').Prisma.InputJsonValue },
      create: {
        courseId,
        layoutJson: layout as unknown as import('@prisma/client').Prisma.InputJsonValue,
      },
    });
    return { saved: true };
  }

  /**
   * Load graph layout for a course.
   */
  async loadLayout(courseId: string): Promise<GraphLayoutData | null> {
    const row = await this.prisma.kcGraphLayout.findUnique({ where: { courseId } });
    if (!row) return null;
    return row.layoutJson as unknown as GraphLayoutData;
  }

  /**
   * Update KC hierarchy assignments (topicId / subtopicId).
   */
  async updateKcHierarchy(
    kcId: string,
    dto: { topicId?: string | null; subtopicId?: string | null },
  ) {
    const kc = await this.prisma.proposedKC.findUnique({ where: { id: kcId } });
    if (!kc) throw new NotFoundException(`ProposedKC ${kcId} not found`);

    const data: { topicId?: string | null; subtopicId?: string | null } = {};
    if (dto.topicId !== undefined) data.topicId = dto.topicId;
    if (dto.subtopicId !== undefined) data.subtopicId = dto.subtopicId;

    return this.prisma.proposedKC.update({ where: { id: kcId }, data });
  }

  /**
   * Batch-assign hierarchy to multiple KCs at once.
   */
  async batchUpdateHierarchy(
    courseId: string,
    assignments: Array<{ kcId: string; topicId?: string | null; subtopicId?: string | null }>,
  ) {
    let updated = 0;
    for (const a of assignments) {
      try {
        await this.prisma.proposedKC.update({
          where: { id: a.kcId },
          data: {
            ...(a.topicId !== undefined ? { topicId: a.topicId } : {}),
            ...(a.subtopicId !== undefined ? { subtopicId: a.subtopicId } : {}),
          },
        });
        updated++;
      } catch {
        this.logger.warn(`Failed to update hierarchy for KC ${a.kcId}`);
      }
    }
    return { updated, total: assignments.length };
  }

  /**
   * Get topics and modules (subtopics) for a course, for hierarchy sidebar.
   */
  async getHierarchyOptions(courseId: string) {
    const [topics, modules] = await Promise.all([
      this.prisma.topic.findMany({
        where: { courseId },
        select: { id: true, title: true, orderIndex: true },
        orderBy: { orderIndex: 'asc' },
      }),
      this.prisma.courseModule.findMany({
        where: { courseId },
        select: { id: true, title: true, topicId: true, orderIndex: true },
        orderBy: { orderIndex: 'asc' },
      }),
    ]);
    return { topics, modules };
  }

  // ─── Private ─────────────────────────────────────────────

  private parseEdgesResponse(raw: string): EdgeRaw[] {
    try {
      let jsonStr = raw.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1]!.trim();

      const parsed = JSON.parse(jsonStr);
      const edges = parsed.edges || [];
      if (!Array.isArray(edges)) return [];

      return edges.filter(
        (e: any) =>
          e &&
          typeof e.fromKcId === 'string' &&
          typeof e.toKcId === 'string' &&
          typeof e.relationship === 'string',
      );
    } catch (err: any) {
      this.logger.error(`Failed to parse graph generation response: ${err.message}`);
      return [];
    }
  }

  private removeCyclicEdges(edges: EdgeRaw[]): EdgeRaw[] {
    // Greedy cycle removal: add edges one at a time, skip if it creates a cycle
    const adj = new Map<string, Set<string>>();
    const result: EdgeRaw[] = [];

    // Only check ordering edges
    const orderingEdges = edges.filter(
      (e) => e.relationship === 'prerequisite' || e.relationship === 'builds_on',
    );
    const relatedEdges = edges.filter((e) => e.relationship === 'related');

    for (const edge of orderingEdges) {
      // Check if adding this edge creates a path from toKcId back to fromKcId
      if (!this.hasPath(adj, edge.toKcId, edge.fromKcId)) {
        if (!adj.has(edge.fromKcId)) adj.set(edge.fromKcId, new Set());
        adj.get(edge.fromKcId)!.add(edge.toKcId);
        result.push(edge);
      } else {
        this.logger.warn(`Skipping cyclic edge: ${edge.fromKcId} -> ${edge.toKcId}`);
      }
    }

    // Related edges don't have direction constraints
    result.push(...relatedEdges);

    return result;
  }

  private hasPath(adj: Map<string, Set<string>>, from: string, to: string): boolean {
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === to) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const neighbor of adj.get(current) || []) {
        queue.push(neighbor);
      }
    }
    return false;
  }

}
