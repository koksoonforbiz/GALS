import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  GateCheckDetail,
  GateCheckStatus,
  PublishGateOutput,
  GateKcInfo,
  GateEdgeInfo,
  GateMappingInfo,
  GatePageInfo,
  GateEvalSummary,
} from './publish-gate.types';

@Injectable()
export class PublishGateService {
  private readonly logger = new Logger(PublishGateService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Run All Gate Checks ──────────────────────────────────

  async runChecks(courseId: string, userId: string): Promise<PublishGateOutput> {
    await this.verifyCourseAccess(courseId, userId);

    const [kcs, edges, mappings, pages, evalSummary] = await Promise.all([
      this.getApprovedKCs(courseId),
      this.getEdges(courseId),
      this.getMappings(courseId),
      this.getPages(courseId),
      this.getLatestEvalSummary(courseId),
    ]);

    const checks = this.computeChecks(kcs, edges, mappings, pages, evalSummary);
    const overallPass = checks.every((c) => c.status !== 'fail');

    // Store the audit record
    await this.prisma.publishGateRun.create({
      data: {
        courseId,
        userId,
        checks: checks as unknown as Prisma.InputJsonValue,
        overallPass,
      },
    });

    return {
      overallPass,
      checks,
      meta: {
        courseId,
        checkedAt: new Date().toISOString(),
        approvedKcCount: kcs.length,
        edgeCount: edges.length,
        mappingCount: mappings.length,
        pageCount: pages.length,
        latestEvalRunId: evalSummary?.runId || null,
      },
    };
  }

  // ─── Publish With Override ────────────────────────────────

  async publishWithOverride(
    courseId: string,
    userId: string,
    overrideReason: string,
  ) {
    if (!overrideReason || overrideReason.trim().length < 10) {
      throw new BadRequestException('Override reason must be at least 10 characters');
    }

    await this.verifyCourseAccess(courseId, userId);

    // Run checks first
    const gateResult = await this.runChecks(courseId, userId);

    // Store override audit
    await this.prisma.publishGateRun.create({
      data: {
        courseId,
        userId,
        checks: gateResult.checks as unknown as Prisma.InputJsonValue,
        overallPass: gateResult.overallPass,
        overridden: true,
        overrideReason: overrideReason.trim(),
        published: true,
      },
    });

    // Publish the course
    await this.prisma.course.update({
      where: { id: courseId },
      data: { status: 'PUBLISHED', visibility: 'PUBLIC' },
    });

    this.logger.warn(
      `Course ${courseId} published with override by ${userId}: ${overrideReason.trim()}`,
    );

    return { published: true, overridden: true, checks: gateResult.checks };
  }

  // ─── Gated Publish (all checks must pass) ────────────────

  async gatedPublish(courseId: string, userId: string) {
    await this.verifyCourseAccess(courseId, userId);

    const gateResult = await this.runChecks(courseId, userId);

    if (!gateResult.overallPass) {
      const failedChecks = gateResult.checks
        .filter((c) => c.status === 'fail')
        .map((c) => c.label);
      return {
        published: false,
        reason: `Publish blocked: ${failedChecks.join(', ')}`,
        checks: gateResult.checks,
      };
    }

    // Record successful publish audit
    await this.prisma.publishGateRun.create({
      data: {
        courseId,
        userId,
        checks: gateResult.checks as unknown as Prisma.InputJsonValue,
        overallPass: true,
        published: true,
      },
    });

    // Publish
    await this.prisma.course.update({
      where: { id: courseId },
      data: { status: 'PUBLISHED', visibility: 'PUBLIC' },
    });

    return { published: true, overridden: false, checks: gateResult.checks };
  }

  // ─── Audit History ────────────────────────────────────────

  async listAuditHistory(courseId: string, userId: string) {
    await this.verifyCourseAccess(courseId, userId);
    return this.prisma.publishGateRun.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // ─── Core Check Logic (pure, exported for testing) ────────

  computeChecks(
    kcs: GateKcInfo[],
    edges: GateEdgeInfo[],
    mappings: GateMappingInfo[],
    pages: GatePageInfo[],
    evalSummary: GateEvalSummary | null,
  ): GateCheckDetail[] {
    return [
      this.checkGraphNoCycles(kcs, edges),
      this.checkNoIsolatedCoreKCs(kcs, edges, mappings),
      this.checkPrereqCompleteness(kcs, edges, mappings, pages),
      this.checkKcEvidenceThreshold(kcs, mappings),
      this.checkEvalCriticalResolved(evalSummary),
    ];
  }

  // ─── Check 1: No Cycles ──────────────────────────────────

  checkGraphNoCycles(
    kcs: GateKcInfo[],
    edges: GateEdgeInfo[],
  ): GateCheckDetail {
    const check: GateCheckDetail = {
      id: 'GRAPH_NO_CYCLES',
      label: 'KC Graph: No Cycles',
      description: 'The knowledge component graph must be a DAG (no circular dependencies).',
      status: 'pass',
      details: [],
    };

    if (kcs.length === 0) {
      check.details.push('No approved KCs found — check passes vacuously.');
      return check;
    }

    // DFS cycle detection
    const prereqEdges = edges.filter(
      (e) => e.relationship === 'prerequisite' || e.relationship === 'builds_on',
    );
    const adj = new Map<string, string[]>();
    for (const e of prereqEdges) {
      const list = adj.get(e.fromKcId) || [];
      list.push(e.toKcId);
      adj.set(e.fromKcId, list);
    }

    const kcIds = new Set(kcs.map((kc) => kc.id));
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    for (const id of kcIds) color.set(id, WHITE);

    const cycles: string[][] = [];
    const path: string[] = [];

    const dfs = (u: string) => {
      color.set(u, GRAY);
      path.push(u);
      for (const v of adj.get(u) || []) {
        if (!kcIds.has(v)) continue;
        if (color.get(v) === GRAY) {
          const cycleStart = path.indexOf(v);
          const cycle = path.slice(cycleStart);
          cycles.push(cycle);
        } else if (color.get(v) === WHITE) {
          dfs(v);
        }
      }
      path.pop();
      color.set(u, BLACK);
    };

    for (const id of kcIds) {
      if (color.get(id) === WHITE) dfs(id);
    }

    if (cycles.length > 0) {
      check.status = 'fail';
      const kcNameMap = new Map(kcs.map((kc) => [kc.id, kc.name]));
      for (const cycle of cycles) {
        const names = cycle.map((id) => kcNameMap.get(id) || id.slice(0, 8));
        check.details.push(`Cycle: ${names.join(' → ')} → ${names[0]}`);
      }
      check.relatedIds = [...new Set(cycles.flat())];
    } else {
      check.details.push(`No cycles detected among ${kcs.length} KCs and ${prereqEdges.length} prerequisite edges.`);
    }

    return check;
  }

  // ─── Check 2: No Isolated Core KCs ───────────────────────

  checkNoIsolatedCoreKCs(
    kcs: GateKcInfo[],
    edges: GateEdgeInfo[],
    mappings: GateMappingInfo[],
  ): GateCheckDetail {
    const check: GateCheckDetail = {
      id: 'GRAPH_NO_ISOLATED_CORE_KCS',
      label: 'KC Graph: No Isolated Core KCs',
      description: 'Every approved KC must have at least one graph edge (incoming or outgoing) or content mapping.',
      status: 'pass',
      details: [],
    };

    if (kcs.length === 0) {
      check.details.push('No approved KCs found — check passes vacuously.');
      return check;
    }

    const connectedKcIds = new Set<string>();
    for (const e of edges) {
      connectedKcIds.add(e.fromKcId);
      connectedKcIds.add(e.toKcId);
    }
    for (const m of mappings) {
      connectedKcIds.add(m.kcId);
    }

    const isolated = kcs.filter((kc) => !connectedKcIds.has(kc.id));
    if (isolated.length > 0) {
      check.status = 'fail';
      for (const kc of isolated) {
        check.details.push(`"${kc.name}" has no graph edges and no content mapping.`);
      }
      check.relatedIds = isolated.map((kc) => kc.id);
    } else {
      check.details.push(`All ${kcs.length} approved KCs are connected.`);
    }

    return check;
  }

  // ─── Check 3: Prerequisite Completeness ───────────────────

  checkPrereqCompleteness(
    kcs: GateKcInfo[],
    edges: GateEdgeInfo[],
    mappings: GateMappingInfo[],
    pages: GatePageInfo[],
  ): GateCheckDetail {
    const check: GateCheckDetail = {
      id: 'PREREQ_COMPLETENESS',
      label: 'Prerequisite Completeness',
      description: 'For every prerequisite edge A→B, KC A must appear on a page before KC B.',
      status: 'pass',
      details: [],
    };

    if (kcs.length === 0 || edges.length === 0) {
      check.details.push('No prerequisite edges to check.');
      return check;
    }

    const prereqEdges = edges.filter(
      (e) => e.relationship === 'prerequisite' || e.relationship === 'builds_on',
    );
    if (prereqEdges.length === 0) {
      check.details.push('No prerequisite/builds_on edges found.');
      return check;
    }

    // Build KC → first page global order
    const sortedPages = [...pages].sort((a, b) => a.globalOrder - b.globalOrder);
    const kcFirstOrder = new Map<string, number>();
    for (const page of sortedPages) {
      const pageMappings = mappings.filter((m) => m.pageId === page.id);
      for (const m of pageMappings) {
        if (!kcFirstOrder.has(m.kcId)) {
          kcFirstOrder.set(m.kcId, page.globalOrder);
        }
      }
    }

    const kcNameMap = new Map(kcs.map((kc) => [kc.id, kc.name]));
    const violations: string[] = [];
    const violationIds: string[] = [];

    for (const edge of prereqEdges) {
      const fromName = kcNameMap.get(edge.fromKcId) || edge.fromKcId.slice(0, 8);
      const toName = kcNameMap.get(edge.toKcId) || edge.toKcId.slice(0, 8);

      const fromOrder = kcFirstOrder.get(edge.fromKcId);
      const toOrder = kcFirstOrder.get(edge.toKcId);

      if (fromOrder === undefined) {
        violations.push(`Prerequisite "${fromName}" has no content mapping — cannot verify ordering.`);
        violationIds.push(edge.fromKcId);
      } else if (toOrder === undefined) {
        // Target not mapped is less critical; it's a missing mapping
        violations.push(`"${toName}" (depends on "${fromName}") has no content mapping.`);
        violationIds.push(edge.toKcId);
      } else if (fromOrder > toOrder) {
        violations.push(
          `"${toName}" appears before its prerequisite "${fromName}" (page ${toOrder + 1} vs ${fromOrder + 1}).`,
        );
        violationIds.push(edge.fromKcId, edge.toKcId);
      }
    }

    if (violations.length > 0) {
      check.status = violations.length <= 2 ? 'warn' : 'fail';
      check.details = violations;
      check.relatedIds = [...new Set(violationIds)];
    } else {
      check.details.push(`All ${prereqEdges.length} prerequisite chains are correctly ordered.`);
    }

    return check;
  }

  // ─── Check 4: KC Evidence Threshold ───────────────────────

  checkKcEvidenceThreshold(
    kcs: GateKcInfo[],
    mappings: GateMappingInfo[],
  ): GateCheckDetail {
    const check: GateCheckDetail = {
      id: 'KC_EVIDENCE_THRESHOLD',
      label: 'KC Evidence Threshold',
      description: 'Every approved KC must have at least one content mapping of MEDIUM or HIGH strength.',
      status: 'pass',
      details: [],
    };

    if (kcs.length === 0) {
      check.details.push('No approved KCs found — check passes vacuously.');
      return check;
    }

    const kcMappingStrengths = new Map<string, string[]>();
    for (const m of mappings) {
      const list = kcMappingStrengths.get(m.kcId) || [];
      list.push(m.strength);
      kcMappingStrengths.set(m.kcId, list);
    }

    const weak: string[] = [];
    const weakIds: string[] = [];

    for (const kc of kcs) {
      const strengths = kcMappingStrengths.get(kc.id) || [];
      const hasMediumOrHigh = strengths.some((s) => s === 'MEDIUM' || s === 'HIGH');

      if (strengths.length === 0) {
        weak.push(`"${kc.name}" has no content mapping at all.`);
        weakIds.push(kc.id);
      } else if (!hasMediumOrHigh) {
        weak.push(`"${kc.name}" has only LOW-strength mappings (${strengths.length} mapping(s)).`);
        weakIds.push(kc.id);
      }
    }

    if (weak.length > 0) {
      check.status = weak.length > kcs.length / 3 ? 'fail' : 'warn';
      check.details = weak;
      check.relatedIds = weakIds;
    } else {
      check.details.push(`All ${kcs.length} approved KCs have adequate content evidence.`);
    }

    return check;
  }

  // ─── Check 5: Evaluation Critical Issues ──────────────────

  checkEvalCriticalResolved(
    evalSummary: GateEvalSummary | null,
  ): GateCheckDetail {
    const check: GateCheckDetail = {
      id: 'EVAL_CRITICAL_RESOLVED',
      label: 'Evaluation: Critical Issues Resolved',
      description: 'No unresolved critical issues from the latest KC evaluation run.',
      status: 'pass',
      details: [],
    };

    if (!evalSummary) {
      check.status = 'warn';
      check.details.push('No KC evaluation has been run. Consider running one before publishing.');
      return check;
    }

    const criticalCount =
      evalSummary.missingKCs + evalSummary.prerequisiteViolations;

    if (criticalCount > 0) {
      check.status = 'fail';
      if (evalSummary.missingKCs > 0) {
        check.details.push(`${evalSummary.missingKCs} KC(s) have no content support at all.`);
      }
      if (evalSummary.prerequisiteViolations > 0) {
        check.details.push(`${evalSummary.prerequisiteViolations} prerequisite ordering violation(s).`);
      }
      check.relatedIds = [evalSummary.runId];
    } else if (evalSummary.overloadedPages > 0 || evalSummary.highPriorityRecs > 0) {
      check.status = 'warn';
      if (evalSummary.overloadedPages > 0) {
        check.details.push(`${evalSummary.overloadedPages} page(s) flagged for cognitive overload.`);
      }
      if (evalSummary.highPriorityRecs > 0) {
        check.details.push(`${evalSummary.highPriorityRecs} high-priority recommendation(s) pending.`);
      }
      check.relatedIds = [evalSummary.runId];
    } else {
      check.details.push('Latest evaluation shows no critical issues.');
      check.relatedIds = [evalSummary.runId];
    }

    // Add error-severity issues
    for (const issue of evalSummary.errorIssues) {
      check.details.push(`[${issue.type}] ${issue.description}`);
    }

    return check;
  }

  // ─── Data Gathering ───────────────────────────────────────

  private async getApprovedKCs(courseId: string): Promise<GateKcInfo[]> {
    return this.prisma.proposedKC.findMany({
      where: { courseId, status: 'APPROVED' },
      select: { id: true, name: true, status: true, confidenceLevel: true },
    });
  }

  private async getEdges(courseId: string): Promise<GateEdgeInfo[]> {
    return this.prisma.kcEdge.findMany({
      where: { courseId },
      select: { id: true, fromKcId: true, toKcId: true, relationship: true, weight: true },
    });
  }

  private async getMappings(courseId: string): Promise<GateMappingInfo[]> {
    return this.prisma.kcContentMapping.findMany({
      where: { courseId },
      select: { id: true, kcId: true, pageId: true, strength: true },
    });
  }

  private async getPages(courseId: string): Promise<GatePageInfo[]> {
    const modules = await this.prisma.courseModule.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      include: {
        items: {
          where: { type: 'PAGE' },
          orderBy: { orderIndex: 'asc' },
          select: { id: true, title: true, orderIndex: true },
        },
      },
    });

    let globalOrder = 0;
    const allPages: GatePageInfo[] = [];
    for (const mod of modules) {
      for (const item of mod.items) {
        allPages.push({ id: item.id, title: item.title, globalOrder: globalOrder++ });
      }
    }
    return allPages;
  }

  private async getLatestEvalSummary(courseId: string): Promise<GateEvalSummary | null> {
    const latestRun = await this.prisma.kcEvaluationRun.findFirst({
      where: { courseId, status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      select: { id: true, results: true },
    });

    if (!latestRun?.results) return null;

    const results = latestRun.results as any;
    const summary = results?.summary || {};
    const kcFindings = results?.kcFindings || [];
    const pageFindings = results?.pageFindings || [];
    const recommendations = results?.recommendations || [];

    // Collect error-severity issues
    const errorIssues: Array<{ type: string; description: string }> = [];
    for (const kf of kcFindings) {
      for (const issue of kf.issues || []) {
        if (issue.severity === 'error') {
          errorIssues.push({ type: issue.type, description: issue.description });
        }
      }
    }
    for (const pf of pageFindings) {
      for (const issue of pf.issues || []) {
        if (issue.severity === 'error') {
          errorIssues.push({ type: issue.type, description: issue.description });
        }
      }
    }

    return {
      runId: latestRun.id,
      missingKCs: summary.missingKCs || 0,
      prerequisiteViolations: summary.prerequisiteViolations || 0,
      overloadedPages: summary.overloadedPages || 0,
      highPriorityRecs: (recommendations as any[]).filter((r: any) => r.priority === 'high').length,
      errorIssues: errorIssues.slice(0, 10), // Limit to first 10
    };
  }

  private async verifyCourseAccess(courseId: string, userId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== userId) {
      throw new ForbiddenException('Only the course teacher can manage publishing');
    }
  }
}
