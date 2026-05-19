import { PublishGateService } from './publish-gate.service';
import type {
  GateKcInfo,
  GateEdgeInfo,
  GateMappingInfo,
  GatePageInfo,
  GateEvalSummary,
} from './publish-gate.types';

describe('PublishGateService — computeChecks (pure logic)', () => {
  let service: PublishGateService;

  beforeEach(() => {
    service = new PublishGateService(null as any);
  });

  // ─── Helper factories ─────────────────────────────────

  const kc = (id: string, name = id): GateKcInfo => ({
    id,
    name,
    status: 'APPROVED',
    confidenceLevel: 'HIGH',
  });

  const edge = (
    from: string,
    to: string,
    rel = 'prerequisite',
  ): GateEdgeInfo => ({
    id: `${from}-${to}`,
    fromKcId: from,
    toKcId: to,
    relationship: rel,
    weight: 1,
  });

  const mapping = (
    kcId: string,
    pageId: string,
    strength = 'MEDIUM',
  ): GateMappingInfo => ({
    id: `map-${kcId}-${pageId}`,
    kcId,
    pageId,
    strength,
  });

  const page = (id: string, order: number, title = id): GatePageInfo => ({
    id,
    title,
    globalOrder: order,
  });

  // ─── computeChecks ────────────────────────────────────

  it('returns 5 checks', () => {
    const checks = service.computeChecks([], [], [], [], null);
    expect(checks).toHaveLength(5);
  });

  // ─── Check 1: Graph No Cycles ─────────────────────────

  describe('checkGraphNoCycles', () => {
    it('passes when no KCs exist', () => {
      const result = service.checkGraphNoCycles([], []);
      expect(result.status).toBe('pass');
    });

    it('passes for a DAG', () => {
      const kcs = [kc('a'), kc('b'), kc('c')];
      const edges = [edge('a', 'b'), edge('b', 'c')];
      const result = service.checkGraphNoCycles(kcs, edges);
      expect(result.status).toBe('pass');
    });

    it('fails when a cycle exists', () => {
      const kcs = [kc('a'), kc('b'), kc('c')];
      const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
      const result = service.checkGraphNoCycles(kcs, edges);
      expect(result.status).toBe('fail');
      expect(result.details.some((d) => d.includes('Cycle'))).toBe(true);
      expect(result.relatedIds).toBeDefined();
    });

    it('ignores non-prerequisite edges', () => {
      const kcs = [kc('a'), kc('b')];
      const edges = [edge('a', 'b', 'related'), edge('b', 'a', 'related')];
      const result = service.checkGraphNoCycles(kcs, edges);
      expect(result.status).toBe('pass');
    });
  });

  // ─── Check 2: No Isolated Core KCs ────────────────────

  describe('checkNoIsolatedCoreKCs', () => {
    it('passes when no KCs exist', () => {
      const result = service.checkNoIsolatedCoreKCs([], [], []);
      expect(result.status).toBe('pass');
    });

    it('passes when all KCs have edges or mappings', () => {
      const kcs = [kc('a'), kc('b')];
      const edges = [edge('a', 'b')];
      const mappings: GateMappingInfo[] = [];
      const result = service.checkNoIsolatedCoreKCs(kcs, edges, mappings);
      expect(result.status).toBe('pass');
    });

    it('passes when KC has only a mapping (no edges)', () => {
      const kcs = [kc('a')];
      const result = service.checkNoIsolatedCoreKCs(kcs, [], [mapping('a', 'p1')]);
      expect(result.status).toBe('pass');
    });

    it('fails when a KC has no edges and no mappings', () => {
      const kcs = [kc('a'), kc('b')];
      const edges = [edge('a', 'x')]; // 'b' is isolated
      const result = service.checkNoIsolatedCoreKCs(kcs, edges, []);
      expect(result.status).toBe('fail');
      expect(result.details.some((d) => d.includes('"b"'))).toBe(true);
    });
  });

  // ─── Check 3: Prerequisite Completeness ───────────────

  describe('checkPrereqCompleteness', () => {
    it('passes with no edges', () => {
      const result = service.checkPrereqCompleteness([kc('a')], [], [], []);
      expect(result.status).toBe('pass');
    });

    it('passes when prerequisite appears before dependent', () => {
      const kcs = [kc('a'), kc('b')];
      const edges = [edge('a', 'b')]; // A is prereq of B
      const pages = [page('p1', 0), page('p2', 1)];
      const mappings = [mapping('a', 'p1'), mapping('b', 'p2')];
      const result = service.checkPrereqCompleteness(kcs, edges, mappings, pages);
      expect(result.status).toBe('pass');
    });

    it('warns/fails when dependent appears before prerequisite', () => {
      const kcs = [kc('a', 'Algebra'), kc('b', 'Calculus')];
      const edges = [edge('a', 'b')]; // A prereq of B
      const pages = [page('p1', 0), page('p2', 1)];
      const mappings = [mapping('b', 'p1'), mapping('a', 'p2')]; // B before A
      const result = service.checkPrereqCompleteness(kcs, edges, mappings, pages);
      expect(result.status === 'warn' || result.status === 'fail').toBe(true);
      expect(result.details.some((d) => d.includes('appears before'))).toBe(true);
    });

    it('reports missing prerequisite mapping', () => {
      const kcs = [kc('a', 'Algebra'), kc('b', 'Calculus')];
      const edges = [edge('a', 'b')];
      const pages = [page('p1', 0)];
      const mappings = [mapping('b', 'p1')]; // A has no mapping
      const result = service.checkPrereqCompleteness(kcs, edges, mappings, pages);
      expect(result.details.some((d) => d.includes('no content mapping'))).toBe(true);
    });
  });

  // ─── Check 4: KC Evidence Threshold ───────────────────

  describe('checkKcEvidenceThreshold', () => {
    it('passes when no KCs exist', () => {
      const result = service.checkKcEvidenceThreshold([], []);
      expect(result.status).toBe('pass');
    });

    it('passes when all KCs have MEDIUM+ mappings', () => {
      const kcs = [kc('a'), kc('b')];
      const mappings = [mapping('a', 'p1', 'HIGH'), mapping('b', 'p2', 'MEDIUM')];
      const result = service.checkKcEvidenceThreshold(kcs, mappings);
      expect(result.status).toBe('pass');
    });

    it('warns when a few KCs lack evidence', () => {
      const kcs = [kc('a'), kc('b'), kc('c'), kc('d')];
      const mappings = [
        mapping('a', 'p1', 'HIGH'),
        mapping('b', 'p2', 'MEDIUM'),
        mapping('c', 'p3', 'MEDIUM'),
        // d has no mapping
      ];
      const result = service.checkKcEvidenceThreshold(kcs, mappings);
      expect(result.status).toBe('warn');
      expect(result.details.some((d) => d.includes('"d"'))).toBe(true);
    });

    it('fails when many KCs lack evidence', () => {
      const kcs = [kc('a'), kc('b'), kc('c')];
      const mappings: GateMappingInfo[] = []; // none
      const result = service.checkKcEvidenceThreshold(kcs, mappings);
      expect(result.status).toBe('fail');
    });

    it('flags KCs with only LOW strength mappings', () => {
      const kcs = [kc('a')];
      const mappings = [mapping('a', 'p1', 'LOW')];
      const result = service.checkKcEvidenceThreshold(kcs, mappings);
      expect(result.status === 'warn' || result.status === 'fail').toBe(true);
      expect(result.details.some((d) => d.includes('LOW-strength'))).toBe(true);
    });
  });

  // ─── Check 5: Eval Critical Resolved ──────────────────

  describe('checkEvalCriticalResolved', () => {
    it('warns when no evaluation has been run', () => {
      const result = service.checkEvalCriticalResolved(null);
      expect(result.status).toBe('warn');
      expect(result.details.some((d) => d.includes('No KC evaluation'))).toBe(true);
    });

    it('passes when no critical issues', () => {
      const summary: GateEvalSummary = {
        runId: 'run-1',
        missingKCs: 0,
        prerequisiteViolations: 0,
        overloadedPages: 0,
        highPriorityRecs: 0,
        errorIssues: [],
      };
      const result = service.checkEvalCriticalResolved(summary);
      expect(result.status).toBe('pass');
    });

    it('fails when there are missing KCs', () => {
      const summary: GateEvalSummary = {
        runId: 'run-1',
        missingKCs: 3,
        prerequisiteViolations: 0,
        overloadedPages: 0,
        highPriorityRecs: 0,
        errorIssues: [],
      };
      const result = service.checkEvalCriticalResolved(summary);
      expect(result.status).toBe('fail');
    });

    it('fails when there are prerequisite violations', () => {
      const summary: GateEvalSummary = {
        runId: 'run-1',
        missingKCs: 0,
        prerequisiteViolations: 2,
        overloadedPages: 0,
        highPriorityRecs: 0,
        errorIssues: [],
      };
      const result = service.checkEvalCriticalResolved(summary);
      expect(result.status).toBe('fail');
    });

    it('warns on overloaded pages', () => {
      const summary: GateEvalSummary = {
        runId: 'run-1',
        missingKCs: 0,
        prerequisiteViolations: 0,
        overloadedPages: 2,
        highPriorityRecs: 0,
        errorIssues: [],
      };
      const result = service.checkEvalCriticalResolved(summary);
      expect(result.status).toBe('warn');
    });

    it('warns on high-priority recommendations', () => {
      const summary: GateEvalSummary = {
        runId: 'run-1',
        missingKCs: 0,
        prerequisiteViolations: 0,
        overloadedPages: 0,
        highPriorityRecs: 3,
        errorIssues: [],
      };
      const result = service.checkEvalCriticalResolved(summary);
      expect(result.status).toBe('warn');
    });

    it('includes error-severity issues in details', () => {
      const summary: GateEvalSummary = {
        runId: 'run-1',
        missingKCs: 0,
        prerequisiteViolations: 0,
        overloadedPages: 0,
        highPriorityRecs: 0,
        errorIssues: [{ type: 'MISSING_CONTENT', description: 'Page X has no content' }],
      };
      const result = service.checkEvalCriticalResolved(summary);
      expect(result.details.some((d) => d.includes('MISSING_CONTENT'))).toBe(true);
    });
  });

  // ─── Full Integration: computeChecks ──────────────────

  describe('computeChecks — full integration', () => {
    it('returns all-pass for a healthy course', () => {
      const kcs = [kc('a', 'Algebra'), kc('b', 'Calculus')];
      const edges = [edge('a', 'b')];
      const pages = [page('p1', 0), page('p2', 1)];
      const mappings = [mapping('a', 'p1', 'HIGH'), mapping('b', 'p2', 'MEDIUM')];
      const evalSummary: GateEvalSummary = {
        runId: 'run-1',
        missingKCs: 0,
        prerequisiteViolations: 0,
        overloadedPages: 0,
        highPriorityRecs: 0,
        errorIssues: [],
      };

      const checks = service.computeChecks(kcs, edges, mappings, pages, evalSummary);
      const failing = checks.filter((c) => c.status === 'fail');
      expect(failing).toHaveLength(0);
    });

    it('detects multiple failures in a broken course', () => {
      const kcs = [kc('a'), kc('b'), kc('c')];
      const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')]; // cycle
      const pages = [page('p1', 0)];
      const mappings: GateMappingInfo[] = []; // no mappings
      const evalSummary: GateEvalSummary = {
        runId: 'run-1',
        missingKCs: 2,
        prerequisiteViolations: 1,
        overloadedPages: 0,
        highPriorityRecs: 0,
        errorIssues: [],
      };

      const checks = service.computeChecks(kcs, edges, mappings, pages, evalSummary);
      const failing = checks.filter((c) => c.status === 'fail');
      expect(failing.length).toBeGreaterThanOrEqual(3); // cycles, isolated, evidence, eval
    });
  });
});
