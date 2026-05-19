import { KcGraphService } from './kc-graph.service';
import { NotFoundException } from '@nestjs/common';

// ─── Helpers ────────────────────────────────────────────

function createMockPrisma() {
  return {
    proposedKC: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    kcEdge: {
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
    kcGraphLayout: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    topic: {
      findMany: jest.fn(),
    },
    courseModule: {
      findMany: jest.fn(),
    },
    course: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  };
}

function createService(prisma: any): KcGraphService {
  return new KcGraphService(prisma);
}

// ─── Tests ──────────────────────────────────────────────

describe('KcGraphService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: KcGraphService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = createService(prisma);
  });

  // ─── getGraph ──────────────────────────────────────────

  describe('getGraph', () => {
    it('should return nodes with hierarchy data', async () => {
      prisma.proposedKC.findMany.mockResolvedValue([
        { id: 'kc1', name: 'KC 1', status: 'APPROVED', description: 'desc', topicId: 't1', subtopicId: 's1', topic: { id: 't1', title: 'Topic 1' }, subtopic: { id: 's1', title: 'Module 1' } },
        { id: 'kc2', name: 'KC 2', status: 'PROPOSED', description: null, topicId: 't1', subtopicId: 's1', topic: { id: 't1', title: 'Topic 1' }, subtopic: { id: 's1', title: 'Module 1' } },
        { id: 'kc3', name: 'KC 3', status: 'APPROVED', description: null, topicId: null, subtopicId: null, topic: null, subtopic: null },
      ]);
      prisma.kcEdge.findMany.mockResolvedValue([
        { id: 'e1', fromKcId: 'kc1', toKcId: 'kc2', relationship: 'prerequisite', weight: 1, createdBy: 'ai' },
      ]);

      const result = await service.getGraph('course1');

      expect(result.nodes).toHaveLength(3);
      expect(result.nodes[0]).toMatchObject({ id: 'kc1', topicName: 'Topic 1', subtopicName: 'Module 1' });
      expect(result.nodes[2]).toMatchObject({ id: 'kc3', topicName: null, subtopicName: null });
      expect(result.edges).toHaveLength(1);
      expect(result.hierarchy).toBeDefined();
      expect(result.hierarchy.length).toBeGreaterThan(0);
    });

    it('should build hierarchy groups correctly', async () => {
      prisma.proposedKC.findMany.mockResolvedValue([
        { id: 'kc1', name: 'KC 1', status: 'APPROVED', description: null, topicId: 't1', subtopicId: 's1', topic: { id: 't1', title: 'Topic A' }, subtopic: { id: 's1', title: 'Sub A1' } },
        { id: 'kc2', name: 'KC 2', status: 'APPROVED', description: null, topicId: 't1', subtopicId: 's2', topic: { id: 't1', title: 'Topic A' }, subtopic: { id: 's2', title: 'Sub A2' } },
        { id: 'kc3', name: 'KC 3', status: 'APPROVED', description: null, topicId: 't2', subtopicId: null, topic: { id: 't2', title: 'Topic B' }, subtopic: null },
      ]);
      prisma.kcEdge.findMany.mockResolvedValue([]);

      const result = await service.getGraph('course1');

      // Should have 2 topic groups
      expect(result.hierarchy).toHaveLength(2);
      const topicA = result.hierarchy.find((h) => h.topicName === 'Topic A');
      expect(topicA).toBeDefined();
      expect(topicA!.subtopics).toHaveLength(2);
      expect(topicA!.subtopics[0]!.kcIds).toContain('kc1');
    });

    it('should group ungrouped nodes', async () => {
      prisma.proposedKC.findMany.mockResolvedValue([
        { id: 'kc1', name: 'KC 1', status: 'APPROVED', description: null, topicId: null, subtopicId: null, topic: null, subtopic: null },
        { id: 'kc2', name: 'KC 2', status: 'APPROVED', description: null, topicId: null, subtopicId: null, topic: null, subtopic: null },
      ]);
      prisma.kcEdge.findMany.mockResolvedValue([]);

      const result = await service.getGraph('course1');

      expect(result.hierarchy).toHaveLength(1);
      expect(result.hierarchy[0]!.topicName).toBe('Ungrouped');
      expect(result.hierarchy[0]!.subtopics[0]!.subtopicName).toBe('Ungrouped');
      expect(result.hierarchy[0]!.subtopics[0]!.kcIds).toHaveLength(2);
    });
  });

  // ─── saveLayout / loadLayout ───────────────────────────

  describe('saveLayout', () => {
    it('should upsert layout data', async () => {
      prisma.kcGraphLayout.upsert.mockResolvedValue({ id: 'layout1' });
      const layout = { nodes: [{ id: 'kc1', x: 100, y: 200 }], viewBox: { x: 0, y: 0, w: 1200, h: 800 } };

      const result = await service.saveLayout('course1', layout);

      expect(result).toEqual({ saved: true });
      expect(prisma.kcGraphLayout.upsert).toHaveBeenCalledWith({
        where: { courseId: 'course1' },
        update: { layoutJson: layout },
        create: { courseId: 'course1', layoutJson: layout },
      });
    });
  });

  describe('loadLayout', () => {
    it('should return layout data when it exists', async () => {
      const layoutData = { nodes: [{ id: 'kc1', x: 100, y: 200 }] };
      prisma.kcGraphLayout.findUnique.mockResolvedValue({ courseId: 'course1', layoutJson: layoutData });

      const result = await service.loadLayout('course1');

      expect(result).toEqual(layoutData);
    });

    it('should return null when no layout exists', async () => {
      prisma.kcGraphLayout.findUnique.mockResolvedValue(null);

      const result = await service.loadLayout('course1');

      expect(result).toBeNull();
    });
  });

  // ─── updateKcHierarchy ─────────────────────────────────

  describe('updateKcHierarchy', () => {
    it('should update topicId and subtopicId', async () => {
      prisma.proposedKC.findUnique.mockResolvedValue({ id: 'kc1', topicId: null, subtopicId: null });
      prisma.proposedKC.update.mockResolvedValue({ id: 'kc1', topicId: 't1', subtopicId: 's1' });

      const result = await service.updateKcHierarchy('kc1', { topicId: 't1', subtopicId: 's1' });

      expect(prisma.proposedKC.update).toHaveBeenCalledWith({
        where: { id: 'kc1' },
        data: { topicId: 't1', subtopicId: 's1' },
      });
    });

    it('should throw NotFoundException for non-existent KC', async () => {
      prisma.proposedKC.findUnique.mockResolvedValue(null);

      await expect(service.updateKcHierarchy('bad-id', { topicId: 't1' }))
        .rejects.toThrow(NotFoundException);
    });

    it('should allow setting topicId to null', async () => {
      prisma.proposedKC.findUnique.mockResolvedValue({ id: 'kc1', topicId: 't1' });
      prisma.proposedKC.update.mockResolvedValue({ id: 'kc1', topicId: null });

      await service.updateKcHierarchy('kc1', { topicId: null });

      expect(prisma.proposedKC.update).toHaveBeenCalledWith({
        where: { id: 'kc1' },
        data: { topicId: null },
      });
    });
  });

  // ─── batchUpdateHierarchy ──────────────────────────────

  describe('batchUpdateHierarchy', () => {
    it('should update multiple KCs', async () => {
      prisma.proposedKC.update.mockResolvedValue({});

      const result = await service.batchUpdateHierarchy('course1', [
        { kcId: 'kc1', topicId: 't1' },
        { kcId: 'kc2', topicId: 't1', subtopicId: 's1' },
      ]);

      expect(result).toEqual({ updated: 2, total: 2 });
      expect(prisma.proposedKC.update).toHaveBeenCalledTimes(2);
    });

    it('should count failed updates', async () => {
      prisma.proposedKC.update
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('not found'));

      const result = await service.batchUpdateHierarchy('course1', [
        { kcId: 'kc1', topicId: 't1' },
        { kcId: 'bad-id', topicId: 't1' },
      ]);

      expect(result).toEqual({ updated: 1, total: 2 });
    });
  });

  // ─── getHierarchyOptions ───────────────────────────────

  describe('getHierarchyOptions', () => {
    it('should return topics and modules', async () => {
      prisma.topic.findMany.mockResolvedValue([
        { id: 't1', title: 'Topic 1', orderIndex: 0 },
      ]);
      prisma.courseModule.findMany.mockResolvedValue([
        { id: 'm1', title: 'Module 1', topicId: 't1', orderIndex: 0 },
        { id: 'm2', title: 'Module 2', topicId: null, orderIndex: 1 },
      ]);

      const result = await service.getHierarchyOptions('course1');

      expect(result.topics).toHaveLength(1);
      expect(result.modules).toHaveLength(2);
      expect(result.topics[0]).toMatchObject({ id: 't1', title: 'Topic 1' });
    });
  });

  // ─── addEdge ───────────────────────────────────────────

  describe('addEdge', () => {
    it('should create an edge', async () => {
      prisma.kcEdge.create.mockResolvedValue({ id: 'e1', fromKcId: 'kc1', toKcId: 'kc2' });

      const result = await service.addEdge('course1', 'kc1', 'kc2', 'prerequisite', 1);

      expect(prisma.kcEdge.create).toHaveBeenCalledWith({
        data: { courseId: 'course1', fromKcId: 'kc1', toKcId: 'kc2', relationship: 'prerequisite', weight: 1, createdBy: 'human' },
      });
    });

    it('should reject self-loops', async () => {
      await expect(service.addEdge('course1', 'kc1', 'kc1', 'prerequisite', 1))
        .rejects.toThrow('Cannot create self-loop');
    });

    it('should clamp weight to [0, 1]', async () => {
      prisma.kcEdge.create.mockResolvedValue({});

      await service.addEdge('course1', 'kc1', 'kc2', 'related', 5);

      expect(prisma.kcEdge.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ weight: 1 }),
      });
    });
  });

  // ─── removeEdge ────────────────────────────────────────

  describe('removeEdge', () => {
    it('should delete an existing edge', async () => {
      prisma.kcEdge.findUnique.mockResolvedValue({ id: 'e1' });
      prisma.kcEdge.delete.mockResolvedValue({});

      const result = await service.removeEdge('e1');

      expect(result).toEqual({ deleted: true });
    });

    it('should throw for non-existent edge', async () => {
      prisma.kcEdge.findUnique.mockResolvedValue(null);

      await expect(service.removeEdge('bad-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── updateEdge ────────────────────────────────────────

  describe('updateEdge', () => {
    it('should update edge properties', async () => {
      prisma.kcEdge.findUnique.mockResolvedValue({ id: 'e1' });
      prisma.kcEdge.update.mockResolvedValue({ id: 'e1', relationship: 'builds_on', weight: 0.8 });

      const result = await service.updateEdge('e1', { relationship: 'builds_on', weight: 0.8 });

      expect(prisma.kcEdge.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { relationship: 'builds_on', weight: 0.8 },
      });
    });

    it('should throw for non-existent edge', async () => {
      prisma.kcEdge.findUnique.mockResolvedValue(null);

      await expect(service.updateEdge('bad-id', { weight: 0.5 })).rejects.toThrow(NotFoundException);
    });
  });

  // ─── detectCycles ──────────────────────────────────────

  describe('detectCycles', () => {
    it('should return empty array for acyclic graph', async () => {
      prisma.proposedKC.findMany.mockResolvedValue([
        { id: 'kc1', name: 'A', status: 'APPROVED', description: null, topicId: null, subtopicId: null, topic: null, subtopic: null },
        { id: 'kc2', name: 'B', status: 'APPROVED', description: null, topicId: null, subtopicId: null, topic: null, subtopic: null },
      ]);
      prisma.kcEdge.findMany.mockResolvedValue([
        { id: 'e1', fromKcId: 'kc1', toKcId: 'kc2', relationship: 'prerequisite', weight: 1, createdBy: 'ai' },
      ]);

      const result = await service.detectCycles('course1');

      expect(result).toHaveLength(0);
    });
  });

  // ─── getTopologicalOrder ───────────────────────────────

  describe('getTopologicalOrder', () => {
    it('should return nodes ordered by level', async () => {
      prisma.proposedKC.findMany.mockResolvedValue([
        { id: 'kc1', name: 'A', status: 'APPROVED', description: null, topicId: null, subtopicId: null, topic: null, subtopic: null },
        { id: 'kc2', name: 'B', status: 'APPROVED', description: null, topicId: null, subtopicId: null, topic: null, subtopic: null },
        { id: 'kc3', name: 'C', status: 'APPROVED', description: null, topicId: null, subtopicId: null, topic: null, subtopic: null },
      ]);
      prisma.kcEdge.findMany.mockResolvedValue([
        { id: 'e1', fromKcId: 'kc1', toKcId: 'kc2', relationship: 'prerequisite', weight: 1, createdBy: 'ai' },
        { id: 'e2', fromKcId: 'kc2', toKcId: 'kc3', relationship: 'prerequisite', weight: 1, createdBy: 'ai' },
      ]);

      const result = await service.getTopologicalOrder('course1');

      expect(result).toHaveLength(3);
      // kc1 should be level 0, kc2 level 1, kc3 level 2
      const kc1 = result.find((n) => n.id === 'kc1');
      const kc2 = result.find((n) => n.id === 'kc2');
      const kc3 = result.find((n) => n.id === 'kc3');
      expect(kc1!.level).toBe(0);
      expect(kc2!.level).toBe(1);
      expect(kc3!.level).toBe(2);
    });
  });
});
