import { KnowledgeVersionService } from './knowledge-version.service';
import {
  KcSnapshot,
  EdgeSnapshot,
  MappingSnapshot,
} from './knowledge-version.types';

// ─── Test Helper ────────────────────────────────────────

function makeService(): KnowledgeVersionService {
  return new KnowledgeVersionService(null as any);
}

function makeKc(id: string, name: string, status = 'APPROVED'): KcSnapshot {
  return {
    id,
    name,
    description: `Description for ${name}`,
    status,
    confidenceLevel: 'HIGH',
    createdBy: 'human',
    relatedToKCId: null,
    evidence: [],
    pageIds: [],
  };
}

function makeEdge(id: string, fromKcId: string, toKcId: string, relationship = 'prerequisite', weight = 1.0): EdgeSnapshot {
  return { id, fromKcId, toKcId, relationship, weight, createdBy: 'human' };
}

function makeMapping(id: string, kcId: string, pageId: string, strength = 'MEDIUM'): MappingSnapshot {
  return { id, kcId, pageId, strength, blockIds: [], createdBy: 'human' };
}

// ─── Tests ──────────────────────────────────────────────

describe('KnowledgeVersionService', () => {
  const service = makeService();

  describe('computeDiff', () => {
    it('should detect added KCs', () => {
      const from: KcSnapshot[] = [makeKc('kc-1', 'KC One')];
      const to: KcSnapshot[] = [makeKc('kc-1', 'KC One'), makeKc('kc-2', 'KC Two')];

      const diff = service.computeDiff(from, [], [], to, [], []);

      expect(diff.kcs.added.length).toBe(1);
      expect(diff.kcs.added[0]!.name).toBe('KC Two');
      expect(diff.kcs.removed.length).toBe(0);
      expect(diff.kcs.modified.length).toBe(0);
    });

    it('should detect removed KCs', () => {
      const from: KcSnapshot[] = [makeKc('kc-1', 'KC One'), makeKc('kc-2', 'KC Two')];
      const to: KcSnapshot[] = [makeKc('kc-1', 'KC One')];

      const diff = service.computeDiff(from, [], [], to, [], []);

      expect(diff.kcs.added.length).toBe(0);
      expect(diff.kcs.removed.length).toBe(1);
      expect(diff.kcs.removed[0]!.name).toBe('KC Two');
    });

    it('should detect modified KCs', () => {
      const from: KcSnapshot[] = [makeKc('kc-1', 'KC One', 'PROPOSED')];
      const to: KcSnapshot[] = [makeKc('kc-1', 'KC One', 'APPROVED')];

      const diff = service.computeDiff(from, [], [], to, [], []);

      expect(diff.kcs.modified.length).toBe(1);
      expect(diff.kcs.modified[0]!.id).toBe('kc-1');
      expect(diff.kcs.modified[0]!.changes.length).toBe(1);
      expect(diff.kcs.modified[0]!.changes[0]!.field).toBe('status');
      expect(diff.kcs.modified[0]!.changes[0]!.from).toBe('PROPOSED');
      expect(diff.kcs.modified[0]!.changes[0]!.to).toBe('APPROVED');
    });

    it('should detect KC name changes', () => {
      const from: KcSnapshot[] = [makeKc('kc-1', 'Old Name')];
      const to: KcSnapshot[] = [makeKc('kc-1', 'New Name')];

      const diff = service.computeDiff(from, [], [], to, [], []);

      expect(diff.kcs.modified.length).toBe(1);
      const nameChange = diff.kcs.modified[0]!.changes.find((c) => c.field === 'name');
      expect(nameChange).toBeDefined();
      expect(nameChange!.from).toBe('Old Name');
      expect(nameChange!.to).toBe('New Name');
    });

    it('should detect added edges', () => {
      const fromEdges: EdgeSnapshot[] = [];
      const toEdges: EdgeSnapshot[] = [makeEdge('e-1', 'kc-1', 'kc-2')];

      const diff = service.computeDiff([], fromEdges, [], [], toEdges, []);

      expect(diff.edges.added.length).toBe(1);
      expect(diff.edges.removed.length).toBe(0);
    });

    it('should detect removed edges', () => {
      const fromEdges: EdgeSnapshot[] = [makeEdge('e-1', 'kc-1', 'kc-2')];
      const toEdges: EdgeSnapshot[] = [];

      const diff = service.computeDiff([], fromEdges, [], [], toEdges, []);

      expect(diff.edges.removed.length).toBe(1);
      expect(diff.edges.added.length).toBe(0);
    });

    it('should detect modified edge weight', () => {
      const fromEdges: EdgeSnapshot[] = [makeEdge('e-1', 'kc-1', 'kc-2', 'prerequisite', 0.5)];
      const toEdges: EdgeSnapshot[] = [makeEdge('e-1', 'kc-1', 'kc-2', 'prerequisite', 0.9)];

      const diff = service.computeDiff([], fromEdges, [], [], toEdges, []);

      expect(diff.edges.modified.length).toBe(1);
      const weightChange = diff.edges.modified[0]!.changes.find((c) => c.field === 'weight');
      expect(weightChange).toBeDefined();
      expect(weightChange!.from).toBe(0.5);
      expect(weightChange!.to).toBe(0.9);
    });

    it('should detect added mappings', () => {
      const fromMaps: MappingSnapshot[] = [];
      const toMaps: MappingSnapshot[] = [makeMapping('m-1', 'kc-1', 'page-1')];

      const diff = service.computeDiff([], [], fromMaps, [], [], toMaps);

      expect(diff.mappings.added.length).toBe(1);
      expect(diff.mappings.removed.length).toBe(0);
    });

    it('should detect modified mapping strength', () => {
      const fromMaps: MappingSnapshot[] = [makeMapping('m-1', 'kc-1', 'page-1', 'LOW')];
      const toMaps: MappingSnapshot[] = [makeMapping('m-1', 'kc-1', 'page-1', 'HIGH')];

      const diff = service.computeDiff([], [], fromMaps, [], [], toMaps);

      expect(diff.mappings.modified.length).toBe(1);
      const strengthChange = diff.mappings.modified[0]!.changes.find((c) => c.field === 'strength');
      expect(strengthChange).toBeDefined();
      expect(strengthChange!.from).toBe('LOW');
      expect(strengthChange!.to).toBe('HIGH');
    });

    it('should handle complex multi-entity diffs', () => {
      const fromKcs = [makeKc('kc-1', 'KC One'), makeKc('kc-2', 'KC Two')];
      const toKcs = [makeKc('kc-1', 'KC One Updated', 'APPROVED'), makeKc('kc-3', 'KC Three')];

      const fromEdges = [makeEdge('e-1', 'kc-1', 'kc-2')];
      const toEdges = [makeEdge('e-2', 'kc-1', 'kc-3')];

      const fromMaps = [makeMapping('m-1', 'kc-1', 'page-1')];
      const toMaps = [makeMapping('m-1', 'kc-1', 'page-1', 'HIGH'), makeMapping('m-2', 'kc-3', 'page-2')];

      const diff = service.computeDiff(fromKcs, fromEdges, fromMaps, toKcs, toEdges, toMaps);

      // KCs: kc-2 removed, kc-3 added, kc-1 modified (name changed)
      expect(diff.kcs.removed.length).toBe(1);
      expect(diff.kcs.removed[0]!.name).toBe('KC Two');
      expect(diff.kcs.added.length).toBe(1);
      expect(diff.kcs.added[0]!.name).toBe('KC Three');
      expect(diff.kcs.modified.length).toBe(1);

      // Edges: e-1 removed, e-2 added
      expect(diff.edges.removed.length).toBe(1);
      expect(diff.edges.added.length).toBe(1);

      // Mappings: m-1 modified (strength), m-2 added
      expect(diff.mappings.modified.length).toBe(1);
      expect(diff.mappings.added.length).toBe(1);
    });

    it('should return empty diff when states are identical', () => {
      const kcs = [makeKc('kc-1', 'KC One')];
      const edges = [makeEdge('e-1', 'kc-1', 'kc-2')];
      const maps = [makeMapping('m-1', 'kc-1', 'page-1')];

      const diff = service.computeDiff(kcs, edges, maps, kcs, edges, maps);

      expect(diff.kcs.added.length).toBe(0);
      expect(diff.kcs.removed.length).toBe(0);
      expect(diff.kcs.modified.length).toBe(0);
      expect(diff.edges.added.length).toBe(0);
      expect(diff.edges.removed.length).toBe(0);
      expect(diff.edges.modified.length).toBe(0);
      expect(diff.mappings.added.length).toBe(0);
      expect(diff.mappings.removed.length).toBe(0);
      expect(diff.mappings.modified.length).toBe(0);
    });

    it('should handle empty from and to', () => {
      const diff = service.computeDiff([], [], [], [], [], []);

      expect(diff.kcs.added.length).toBe(0);
      expect(diff.kcs.removed.length).toBe(0);
      expect(diff.kcs.modified.length).toBe(0);
    });
  });
});
