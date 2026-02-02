import { CurriculumCoverageService } from './curriculum-coverage.service';
import {
  SyllabusOutcome,
  OutcomeKcMap,
  CoverageAnalysisOutput,
} from './curriculum-coverage.types';

// ─── Test Helpers ───────────────────────────────────────

function makeService(): CurriculumCoverageService {
  // Create with null prisma — we only test pure analysis methods
  return new CurriculumCoverageService(null as any);
}

function makeOutcomes(count: number): SyllabusOutcome[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `SO-${i + 1}`,
    code: `SO-${i + 1}`,
    description: `Students will be able to ${['understand', 'apply', 'analyze', 'evaluate', 'create'][i % 5]} concept ${i + 1}`,
    bloomLevel: ['Understand', 'Apply', 'Analyze', 'Evaluate', 'Create'][i % 5]!,
    category: null,
  }));
}

function makeKCs(names: string[]): Array<{ id: string; name: string; description: string | null }> {
  return names.map((name, i) => ({
    id: `kc-${i + 1}`,
    name,
    description: `Description for ${name}`,
  }));
}

function makeContentMappings(kcPagePairs: Array<[string, string, string]>): Array<{ kcId: string; pageId: string; strength: string }> {
  return kcPagePairs.map(([kcId, pageId, strength]) => ({
    kcId: kcId!,
    pageId: pageId!,
    strength: strength!,
  }));
}

function makePages(count: number): Array<{ id: string; title: string; moduleTitle: string; globalOrder: number }> {
  return Array.from({ length: count }, (_, i) => ({
    id: `page-${i + 1}`,
    title: `Page ${i + 1}`,
    moduleTitle: `Module ${Math.floor(i / 2) + 1}`,
    globalOrder: i,
  }));
}

// ─── Tests ──────────────────────────────────────────────

describe('CurriculumCoverageService', () => {
  const service = makeService();

  describe('parseSyllabusHeuristic', () => {
    it('should extract outcomes from numbered list format', () => {
      const text = `Course Learning Outcomes:
1) Students will be able to understand fundamental data structures
2) Students will be able to apply sorting algorithms
3) Students can analyze algorithm complexity`;

      const outcomes = service.parseSyllabusHeuristic(text);
      expect(outcomes.length).toBe(3);
      expect(outcomes[0]!.code).toBe('SO-1');
      expect(outcomes[0]!.bloomLevel).toBe('Understand');
      expect(outcomes[1]!.bloomLevel).toBe('Apply');
      expect(outcomes[2]!.bloomLevel).toBe('Analyze');
    });

    it('should extract outcomes from bullet format', () => {
      const text = `- Students will be able to create web applications using React
- Students will demonstrate understanding of state management
- Students can evaluate performance of different rendering strategies`;

      const outcomes = service.parseSyllabusHeuristic(text);
      expect(outcomes.length).toBe(3);
    });

    it('should extract outcomes from CLO format', () => {
      const text = `CLO 1: Understand the principles of object-oriented programming
CLO 2: Apply design patterns in software development
CLO 3: Evaluate software architectures`;

      const outcomes = service.parseSyllabusHeuristic(text);
      expect(outcomes.length).toBe(3);
      expect(outcomes[0]!.bloomLevel).toBe('Understand');
    });

    it('should fall back to sentence extraction if no patterns match', () => {
      const text = `This course covers how to understand database design principles. Students also learn to apply normalization techniques in practice.`;

      const outcomes = service.parseSyllabusHeuristic(text);
      expect(outcomes.length).toBeGreaterThan(0);
    });

    it('should return empty for empty input', () => {
      const outcomes = service.parseSyllabusHeuristic('');
      expect(outcomes.length).toBe(0);
    });
  });

  describe('mapOutcomesToKCsHeuristic', () => {
    it('should map outcomes to KCs based on word overlap', () => {
      const outcomes = [
        { id: 'SO-1', code: 'SO-1', description: 'Understand sorting algorithms and their complexity', bloomLevel: null, category: null },
        { id: 'SO-2', code: 'SO-2', description: 'Apply graph traversal techniques', bloomLevel: null, category: null },
      ];
      const kcs = [
        { id: 'kc-1', name: 'Sorting Algorithms', description: 'Bubble sort, merge sort, quicksort and their complexity analysis' },
        { id: 'kc-2', name: 'Graph Traversal', description: 'BFS and DFS graph traversal techniques' },
        { id: 'kc-3', name: 'Hash Tables', description: 'Hash function design and collision handling' },
      ];

      const maps = service.mapOutcomesToKCsHeuristic(outcomes, kcs);
      expect(maps.length).toBeGreaterThan(0);

      // SO-1 should map to kc-1 (sorting algorithms)
      const so1Maps = maps.filter((m) => m.outcomeId === 'SO-1');
      expect(so1Maps.some((m) => m.kcId === 'kc-1')).toBe(true);

      // SO-2 should map to kc-2 (graph traversal)
      const so2Maps = maps.filter((m) => m.outcomeId === 'SO-2');
      expect(so2Maps.some((m) => m.kcId === 'kc-2')).toBe(true);
    });

    it('should not map outcomes with no overlap', () => {
      const outcomes = [
        { id: 'SO-1', code: 'SO-1', description: 'Perform advanced calculus integration', bloomLevel: null, category: null },
      ];
      const kcs = [
        { id: 'kc-1', name: 'Graph Traversal', description: 'BFS and DFS techniques' },
      ];

      const maps = service.mapOutcomesToKCsHeuristic(outcomes, kcs);
      expect(maps.length).toBe(0);
    });
  });

  describe('buildCoverageAnalysis', () => {
    it('should identify unmapped outcomes', () => {
      const outcomes = makeOutcomes(3);
      const maps: OutcomeKcMap[] = [
        { outcomeId: 'SO-1', kcId: 'kc-1', kcName: 'KC1', confidence: 0.8, rationale: 'match' },
      ];
      const kcs = makeKCs(['KC1', 'KC2']);
      const contentMappings = makeContentMappings([['kc-1', 'page-1', 'HIGH']]);
      const pages = makePages(3);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, contentMappings, pages, 'course-1', 100);

      expect(result.summary.totalOutcomes).toBe(3);
      expect(result.summary.mappedOutcomes).toBe(1);
      expect(result.unmappedOutcomes.length).toBe(2);
      expect(result.unmappedOutcomes[0]!.outcomeCode).toBe('SO-2');
    });

    it('should detect weakly mapped outcomes', () => {
      const outcomes = makeOutcomes(2);
      const maps: OutcomeKcMap[] = [
        { outcomeId: 'SO-1', kcId: 'kc-1', kcName: 'KC1', confidence: 0.9, rationale: 'strong' },
        { outcomeId: 'SO-2', kcId: 'kc-2', kcName: 'KC2', confidence: 0.35, rationale: 'weak' },
      ];
      const kcs = makeKCs(['KC1', 'KC2']);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, [], [], 'course-1', 100);

      expect(result.weaklyMappedOutcomes.length).toBe(1);
      expect(result.weaklyMappedOutcomes[0]!.outcomeCode).toBe('SO-2');
      expect(result.weaklyMappedOutcomes[0]!.bestConfidence).toBe(0.35);
    });

    it('should detect overrepresented KCs', () => {
      const outcomes = makeOutcomes(5);
      const maps: OutcomeKcMap[] = outcomes.map((o) => ({
        outcomeId: o.id,
        kcId: 'kc-1',
        kcName: 'Overloaded KC',
        confidence: 0.8,
        rationale: 'broad match',
      }));
      const kcs = makeKCs(['Overloaded KC']);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, [], [], 'course-1', 100);

      // 5 outcomes > threshold of 3
      expect(result.overrepresentedKCs.length).toBe(1);
      expect(result.overrepresentedKCs[0]!.outcomeCount).toBe(5);
    });

    it('should detect late-introduced KCs', () => {
      const outcomes = makeOutcomes(4);
      const kcs = makeKCs(['Early KC', 'Late KC']);
      const pages = makePages(6);

      // Map both KCs to early outcomes (SO-1, SO-2)
      const maps: OutcomeKcMap[] = [
        { outcomeId: 'SO-1', kcId: 'kc-1', kcName: 'Early KC', confidence: 0.9, rationale: '' },
        { outcomeId: 'SO-1', kcId: 'kc-2', kcName: 'Late KC', confidence: 0.8, rationale: '' },
      ];

      // kc-1 first appears on page-1 (globalOrder 0), kc-2 first appears on page-5 (globalOrder 4)
      const contentMappings = makeContentMappings([
        ['kc-1', 'page-1', 'HIGH'],
        ['kc-2', 'page-5', 'MEDIUM'],
      ]);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, contentMappings, pages, 'course-1', 100);

      // kc-2 maps to SO-1 (early outcome, index 0 < 2) but first appears on page-5 (globalOrder 4 > halfway 2)
      expect(result.lateIntroducedKCs.length).toBe(1);
      expect(result.lateIntroducedKCs[0]!.kcName).toBe('Late KC');
    });

    it('should build coverage matrix correctly', () => {
      const outcomes = makeOutcomes(2);
      const kcs = makeKCs(['KC1', 'KC2']);
      const maps: OutcomeKcMap[] = [
        { outcomeId: 'SO-1', kcId: 'kc-1', kcName: 'KC1', confidence: 0.9, rationale: '' },
        { outcomeId: 'SO-2', kcId: 'kc-2', kcName: 'KC2', confidence: 0.7, rationale: '' },
      ];
      const contentMappings = makeContentMappings([['kc-1', 'page-1', 'HIGH']]);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, contentMappings, [], 'course-1', 100);

      expect(result.coverageMatrix.length).toBe(2);
      const cell1 = result.coverageMatrix.find((c) => c.outcomeId === 'SO-1' && c.kcId === 'kc-1');
      expect(cell1).toBeDefined();
      expect(cell1!.confidence).toBe(0.9);
      expect(cell1!.strength).toBe('HIGH');
    });

    it('should build timeline with cumulative coverage', () => {
      const outcomes = makeOutcomes(3);
      const kcs = makeKCs(['KC1', 'KC2', 'KC3']);
      const maps: OutcomeKcMap[] = [
        { outcomeId: 'SO-1', kcId: 'kc-1', kcName: 'KC1', confidence: 0.9, rationale: '' },
        { outcomeId: 'SO-2', kcId: 'kc-2', kcName: 'KC2', confidence: 0.8, rationale: '' },
        { outcomeId: 'SO-3', kcId: 'kc-3', kcName: 'KC3', confidence: 0.7, rationale: '' },
      ];
      const pages = makePages(3);
      const contentMappings = makeContentMappings([
        ['kc-1', 'page-1', 'HIGH'],
        ['kc-2', 'page-2', 'MEDIUM'],
        ['kc-3', 'page-3', 'LOW'],
      ]);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, contentMappings, pages, 'course-1', 100);

      expect(result.timeline.length).toBe(3);
      expect(result.timeline[0]!.newOutcomesCovered).toContain('SO-1');
      expect(result.timeline[1]!.newOutcomesCovered).toContain('SO-2');
      expect(result.timeline[2]!.newOutcomesCovered).toContain('SO-3');
    });

    it('should generate recommendations for issues', () => {
      const outcomes = makeOutcomes(3);
      const maps: OutcomeKcMap[] = []; // no mappings at all
      const kcs = makeKCs(['Orphan KC']);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, [], [], 'course-1', 100);

      // Should have ADD_KC recs for unmapped outcomes and ADD_CONTENT for orphan KC
      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.some((r) => r.type === 'ADD_KC')).toBe(true);
      expect(result.recommendations.some((r) => r.type === 'ADD_CONTENT')).toBe(true);
    });

    it('should compute correct coverage percentage', () => {
      const outcomes = makeOutcomes(4);
      const maps: OutcomeKcMap[] = [
        { outcomeId: 'SO-1', kcId: 'kc-1', kcName: 'KC1', confidence: 0.9, rationale: '' },
        { outcomeId: 'SO-2', kcId: 'kc-1', kcName: 'KC1', confidence: 0.8, rationale: '' },
      ];
      const kcs = makeKCs(['KC1']);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, [], [], 'course-1', 100);

      expect(result.summary.coveragePercent).toBe(50); // 2/4 = 50%
    });

    it('should identify orphan KCs', () => {
      const outcomes = makeOutcomes(2);
      const maps: OutcomeKcMap[] = [
        { outcomeId: 'SO-1', kcId: 'kc-1', kcName: 'KC1', confidence: 0.9, rationale: '' },
      ];
      const kcs = makeKCs(['KC1', 'KC2', 'KC3']);

      const result = service.buildCoverageAnalysis(outcomes, maps, kcs, [], [], 'course-1', 100);

      expect(result.summary.orphanKCs).toBe(2); // kc-2 and kc-3 not in any mapping
      expect(result.summary.kcsWithOutcomeLink).toBe(1);
    });
  });
});
