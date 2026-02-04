import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  StartKcEvaluationInput,
  KcEvaluationOutput,
  KcEvaluationSummary,
  KcFinding,
  KcIssue,
  KcStatus,
  PageFinding,
  PageIssueDetail,
  Recommendation,
  PageInfo,
  KcInfo,
  MappingInfo,
  EdgeInfo,
} from './kc-evaluation.types';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class KcEvaluationService {
  private readonly logger = new Logger(KcEvaluationService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Public API ─────────────────────────────────────────

  async startEvaluation(input: StartKcEvaluationInput) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, title: true, teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== input.userId) {
      throw new ForbiddenException('Only the course teacher can run KC evaluation');
    }

    // Create run record
    const run = await this.prisma.kcEvaluationRun.create({
      data: {
        courseId: input.courseId,
        userId: input.userId,
        status: 'RUNNING',
        scope: input.scope as unknown as any,
        depth: input.depth,
        startedAt: new Date(),
      },
    });

    // Fire and forget
    this.runEvaluation(run.id, input).catch((err) => {
      this.logger.error(`KC evaluation run ${run.id} failed: ${errMsg(err)}`);
    });

    return { runId: run.id, status: 'RUNNING' };
  }

  async getRun(runId: string, userId: string) {
    const run = await this.prisma.kcEvaluationRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException('KC evaluation run not found');
    if (run.userId !== userId) throw new ForbiddenException();
    return run;
  }

  async listRuns(courseId: string, userId: string) {
    return this.prisma.kcEvaluationRun.findMany({
      where: { courseId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        scope: true,
        depth: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        // Omit full results for list view — just include summary
        results: false,
      },
    });
  }

  // ─── Core Engine ────────────────────────────────────────

  private async runEvaluation(runId: string, input: StartKcEvaluationInput) {
    try {
      // 1. Gather all data
      const pages = await this.getPages(input.courseId, input.scope);
      const kcs = await this.getApprovedKCs(input.courseId);
      const mappings = await this.getMappings(input.courseId);
      const edges = await this.getEdges(input.courseId);

      if (kcs.length === 0) {
        const output: KcEvaluationOutput = {
          summary: emptySummary(),
          kcFindings: [],
          pageFindings: [],
          recommendations: [
            {
              type: 'MAP_OUTCOMES',
              target: 'Course',
              rationale:
                'No approved Knowledge Components found. Approve KCs in KC Studio before running KC-aware evaluation.',
              priority: 'high',
            },
          ],
          metadata: {
            courseId: input.courseId,
            depth: input.depth,
            evaluatedAt: new Date().toISOString(),
            pagesEvaluated: pages.length,
            totalApprovedKCs: 0,
          },
        };
        await this.saveResult(runId, output);
        return;
      }

      // 2. Run all 4 dimensions
      const kcFindings = this.analyzeKcSupport(kcs, mappings, edges, pages);
      const prereqFindings = this.analyzePrerequisiteIntegrity(kcs, mappings, edges, pages);
      const cogLoadFindings = this.analyzeCognitiveLoad(kcs, mappings, pages, input.depth);
      const outcomeFindings = this.analyzeOutcomeAlignment(kcs, mappings, pages);

      // 3. Merge page findings
      const allPageFindings = this.mergePageFindings(
        prereqFindings,
        cogLoadFindings,
        outcomeFindings,
      );

      // 4. Generate recommendations
      const recommendations = this.generateRecommendations(kcFindings, allPageFindings, kcs, pages);

      // 5. Compute summary
      const summary = this.computeSummary(kcFindings, allPageFindings, recommendations);

      // 6. Build output
      const output: KcEvaluationOutput = {
        summary,
        kcFindings,
        pageFindings: allPageFindings,
        recommendations,
        metadata: {
          courseId: input.courseId,
          depth: input.depth,
          evaluatedAt: new Date().toISOString(),
          pagesEvaluated: pages.length,
          totalApprovedKCs: kcs.length,
        },
      };

      await this.saveResult(runId, output);
    } catch (err) {
      await this.prisma.kcEvaluationRun.update({
        where: { id: runId },
        data: { status: 'FAILED', errorMessage: errMsg(err) },
      });
      throw err;
    }
  }

  // ─── Dimension 1: KC Support Analysis ───────────────────

  private analyzeKcSupport(
    kcs: KcInfo[],
    mappings: MappingInfo[],
    edges: EdgeInfo[],
    pages: PageInfo[],
  ): KcFinding[] {
    const pageIdSet = new Set(pages.map((p) => p.id));

    return kcs.map((kc) => {
      const kcMappings = mappings.filter((m) => m.kcId === kc.id && pageIdSet.has(m.pageId));
      const highCount = kcMappings.filter((m) => m.strength === 'HIGH').length;
      const medCount = kcMappings.filter((m) => m.strength === 'MEDIUM').length;
      const lowCount = kcMappings.filter((m) => m.strength === 'LOW').length;
      const evidenceCount = kcMappings.length;

      const issues: KcIssue[] = [];
      let status: KcStatus;

      if (evidenceCount === 0) {
        status = 'missing';
        issues.push({
          type: 'NO_CONTENT',
          description: `KC "${kc.name}" has no content mapped to it in the evaluated pages.`,
          severity: 'error',
        });
      } else if (highCount === 0 && medCount <= 1) {
        status = 'weak';
        issues.push({
          type: 'WEAK_SUPPORT',
          description: `KC "${kc.name}" has only ${evidenceCount} mapping(s) with no HIGH-strength content.`,
          severity: 'warning',
          relatedPageIds: kcMappings.map((m) => m.pageId),
        });
      } else {
        status = 'well_supported';
      }

      // Check: introduced but never reinforced (appears on only 1 page)
      if (evidenceCount === 1 && status !== 'missing') {
        issues.push({
          type: 'NEVER_REINFORCED',
          description: `KC "${kc.name}" appears on only 1 page and is never reinforced elsewhere.`,
          severity: 'info',
          relatedPageIds: kcMappings.map((m) => m.pageId),
        });
      }

      // Check: used as prerequisite but never taught
      const dependents = edges.filter(
        (e) =>
          e.fromKcId === kc.id &&
          (e.relationship === 'prerequisite' || e.relationship === 'builds_on'),
      );
      if (dependents.length > 0 && evidenceCount === 0) {
        issues.push({
          type: 'PREREQ_NOT_TAUGHT',
          description: `KC "${kc.name}" is a prerequisite for other KCs but has no content teaching it.`,
          severity: 'error',
        });
      }

      return {
        kcId: kc.id,
        kcName: kc.name,
        status,
        evidenceCount,
        highStrengthCount: highCount,
        mediumStrengthCount: medCount,
        lowStrengthCount: lowCount,
        issues,
      };
    });
  }

  // ─── Dimension 2: Prerequisite Integrity ────────────────

  private analyzePrerequisiteIntegrity(
    kcs: KcInfo[],
    mappings: MappingInfo[],
    edges: EdgeInfo[],
    pages: PageInfo[],
  ): PageFinding[] {
    const findings: PageFinding[] = [];
    const kcMap = new Map(kcs.map((k) => [k.id, k]));

    // Build: for each KC, find its first appearance (by page globalOrder)
    const kcFirstAppearance = new Map<string, { pageId: string; globalOrder: number }>();
    for (const page of pages.sort((a, b) => a.globalOrder - b.globalOrder)) {
      const pageMappings = mappings.filter((m) => m.pageId === page.id);
      for (const m of pageMappings) {
        if (!kcFirstAppearance.has(m.kcId)) {
          kcFirstAppearance.set(m.kcId, { pageId: page.id, globalOrder: page.globalOrder });
        }
      }
    }

    // For each prerequisite edge, check ordering
    const prereqEdges = edges.filter(
      (e) => e.relationship === 'prerequisite' || e.relationship === 'builds_on',
    );

    for (const page of pages) {
      const pageIssues: PageIssueDetail[] = [];
      const pageMappings = mappings.filter((m) => m.pageId === page.id);
      const pageKcIds = new Set(pageMappings.map((m) => m.kcId));

      for (const kcId of pageKcIds) {
        // Find all prerequisites for this KC
        const prereqs = prereqEdges.filter((e) => e.toKcId === kcId);

        for (const prereq of prereqs) {
          const prereqFirst = kcFirstAppearance.get(prereq.fromKcId);
          const prereqKc = kcMap.get(prereq.fromKcId);
          const currentKc = kcMap.get(kcId);

          if (!prereqFirst) {
            // Prerequisite KC not taught at all
            pageIssues.push({
              type: 'PREREQ_VIOLATION',
              description: `Page introduces "${currentKc?.name || kcId}" but its prerequisite "${prereqKc?.name || prereq.fromKcId}" is never taught in any evaluated page.`,
              relatedKCs: [
                ...(currentKc ? [{ id: currentKc.id, name: currentKc.name }] : []),
                ...(prereqKc ? [{ id: prereqKc.id, name: prereqKc.name }] : []),
              ],
              severity: 'error',
            });
          } else if (prereqFirst.globalOrder >= page.globalOrder) {
            // Prerequisite introduced AFTER or AT the same page as the dependent
            pageIssues.push({
              type: 'PREREQ_VIOLATION',
              description: `"${currentKc?.name || kcId}" is taught on this page, but its prerequisite "${prereqKc?.name || prereq.fromKcId}" appears later or on the same page (position ${prereqFirst.globalOrder + 1} vs ${page.globalOrder + 1}).`,
              relatedKCs: [
                ...(currentKc ? [{ id: currentKc.id, name: currentKc.name }] : []),
                ...(prereqKc ? [{ id: prereqKc.id, name: prereqKc.name }] : []),
              ],
              severity: 'error',
            });
          }
        }
      }

      if (pageIssues.length > 0) {
        findings.push({
          pageId: page.id,
          pageTitle: page.title,
          moduleName: page.moduleTitle,
          issues: pageIssues,
        });
      }
    }

    return findings;
  }

  // ─── Dimension 3: Cognitive Load Signals ────────────────

  private analyzeCognitiveLoad(
    kcs: KcInfo[],
    mappings: MappingInfo[],
    pages: PageInfo[],
    depth: string,
  ): PageFinding[] {
    const findings: PageFinding[] = [];
    const kcMap = new Map(kcs.map((k) => [k.id, k]));

    // Track which KCs have been introduced on prior pages
    const introducedKCs = new Set<string>();
    const sortedPages = [...pages].sort((a, b) => a.globalOrder - b.globalOrder);

    // Thresholds
    const NEW_KC_THRESHOLD = depth === 'deep' ? 3 : 5;
    const BLOCK_DENSITY_THRESHOLD = depth === 'deep' ? 15 : 25;

    for (const page of sortedPages) {
      const pageIssues: PageIssueDetail[] = [];
      const pageMappings = mappings.filter((m) => m.pageId === page.id);
      const pageKcIds = pageMappings.map((m) => m.kcId);

      // Count new KCs (not yet seen on any prior page)
      const newKCs = pageKcIds.filter((id) => !introducedKCs.has(id));
      const newKcNames = newKCs.map((id) => kcMap.get(id)).filter(Boolean) as KcInfo[];

      if (newKCs.length > NEW_KC_THRESHOLD) {
        pageIssues.push({
          type: 'COGNITIVE_OVERLOAD',
          description: `Page introduces ${newKCs.length} new KCs at once (threshold: ${NEW_KC_THRESHOLD}). This may overwhelm learners.`,
          relatedKCs: newKcNames.map((k) => ({ id: k.id, name: k.name })),
          severity: newKCs.length > NEW_KC_THRESHOLD + 2 ? 'error' : 'warning',
        });
      }

      // Block density check
      if (page.blockCount > BLOCK_DENSITY_THRESHOLD && pageKcIds.length > 3) {
        pageIssues.push({
          type: 'COGNITIVE_OVERLOAD',
          description: `Page has ${page.blockCount} blocks and covers ${pageKcIds.length} KCs. Consider splitting into smaller lessons.`,
          relatedKCs: pageKcIds
            .slice(0, 5)
            .map((id) => kcMap.get(id))
            .filter(Boolean)
            .map((k) => ({ id: k!.id, name: k!.name })),
          severity: 'warning',
        });
      }

      // High-difficulty clustering (deep analysis only)
      if (depth === 'deep') {
        const highDifficultyNewKCs = newKCs.filter((id) => {
          const kc = kcMap.get(id);
          return kc?.confidenceLevel === 'LOW'; // LOW confidence = harder to teach
        });
        if (highDifficultyNewKCs.length >= 2) {
          pageIssues.push({
            type: 'COGNITIVE_OVERLOAD',
            description: `Page combines ${highDifficultyNewKCs.length} low-confidence (potentially high-difficulty) new KCs without scaffolding.`,
            relatedKCs: highDifficultyNewKCs
              .map((id) => kcMap.get(id))
              .filter(Boolean)
              .map((k) => ({ id: k!.id, name: k!.name })),
            severity: 'warning',
          });
        }
      }

      // Mark these KCs as introduced
      for (const id of pageKcIds) introducedKCs.add(id);

      if (pageIssues.length > 0) {
        findings.push({
          pageId: page.id,
          pageTitle: page.title,
          moduleName: page.moduleTitle,
          issues: pageIssues,
        });
      }
    }

    return findings;
  }

  // ─── Dimension 4: Outcome Alignment ─────────────────────

  private analyzeOutcomeAlignment(
    kcs: KcInfo[],
    mappings: MappingInfo[],
    pages: PageInfo[],
  ): PageFinding[] {
    const findings: PageFinding[] = [];
    const kcMap = new Map(kcs.map((k) => [k.id, k]));

    for (const page of pages) {
      if (!page.learningOutcomes || page.learningOutcomes.length === 0) continue;

      const pageIssues: PageIssueDetail[] = [];
      const pageMappings = mappings.filter((m) => m.pageId === page.id);
      const pageKcIds = new Set(pageMappings.map((m) => m.kcId));

      // Check: outcomes with no KC support
      // Simple heuristic: outcome text should have some word overlap with mapped KC names
      for (const outcome of page.learningOutcomes) {
        const outcomeWords = this.normalizeWords(outcome);
        let hasMatch = false;

        for (const kcId of pageKcIds) {
          const kc = kcMap.get(kcId);
          if (!kc) continue;
          const kcWords = this.normalizeWords(kc.name + ' ' + (kc.description || ''));
          const overlap = outcomeWords.filter((w) => kcWords.includes(w)).length;
          if (overlap >= 2 || (outcomeWords.length <= 4 && overlap >= 1)) {
            hasMatch = true;
            break;
          }
        }

        if (!hasMatch && pageMappings.length > 0) {
          pageIssues.push({
            type: 'OUTCOME_GAP',
            description: `Learning outcome "${outcome.slice(0, 100)}..." has no clear KC support on this page.`,
            relatedKCs: [],
            severity: 'warning',
          });
        }

        if (!hasMatch && pageMappings.length === 0) {
          pageIssues.push({
            type: 'OUTCOME_NO_KC',
            description: `Page has learning outcomes but no KCs are mapped to it.`,
            relatedKCs: [],
            severity: 'error',
          });
          break; // Only report once per page
        }
      }

      // Check: KCs mapped to this page with no related outcome
      if (page.learningOutcomes.length > 0) {
        for (const kcId of pageKcIds) {
          const kc = kcMap.get(kcId);
          if (!kc) continue;
          const kcWords = this.normalizeWords(kc.name + ' ' + (kc.description || ''));
          let hasOutcomeMatch = false;

          for (const outcome of page.learningOutcomes) {
            const outcomeWords = this.normalizeWords(outcome);
            const overlap = kcWords.filter((w) => outcomeWords.includes(w)).length;
            if (overlap >= 2 || (kcWords.length <= 4 && overlap >= 1)) {
              hasOutcomeMatch = true;
              break;
            }
          }

          if (!hasOutcomeMatch) {
            pageIssues.push({
              type: 'KC_NO_OUTCOME',
              description: `KC "${kc.name}" is mapped to this page but doesn't align with any stated learning outcome.`,
              relatedKCs: [{ id: kc.id, name: kc.name }],
              severity: 'info',
            });
          }
        }
      }

      if (pageIssues.length > 0) {
        findings.push({
          pageId: page.id,
          pageTitle: page.title,
          moduleName: page.moduleTitle,
          issues: pageIssues,
        });
      }
    }

    return findings;
  }

  // ─── Merge & Recommendations ────────────────────────────

  private mergePageFindings(...findingLists: PageFinding[][]): PageFinding[] {
    const byPage = new Map<string, PageFinding>();

    for (const list of findingLists) {
      for (const finding of list) {
        const existing = byPage.get(finding.pageId);
        if (existing) {
          existing.issues.push(...finding.issues);
        } else {
          byPage.set(finding.pageId, { ...finding, issues: [...finding.issues] });
        }
      }
    }

    return Array.from(byPage.values());
  }

  private generateRecommendations(
    kcFindings: KcFinding[],
    pageFindings: PageFinding[],
    _kcs: KcInfo[],
    _pages: PageInfo[],
  ): Recommendation[] {
    const recs: Recommendation[] = [];

    // Missing KCs → add content
    for (const kf of kcFindings) {
      if (kf.status === 'missing') {
        recs.push({
          type: 'ADD_REINFORCEMENT',
          target: kf.kcName,
          targetId: kf.kcId,
          rationale: `KC "${kf.kcName}" has no content covering it. Add lesson material to teach this concept.`,
          priority: 'high',
        });
      }
      if (kf.issues.some((i) => i.type === 'PREREQ_NOT_TAUGHT')) {
        recs.push({
          type: 'TEACH_PREREQUISITE',
          target: kf.kcName,
          targetId: kf.kcId,
          rationale: `KC "${kf.kcName}" is a prerequisite for other KCs but is never taught. Add content before dependent KCs.`,
          priority: 'high',
        });
      }
      if (kf.status === 'weak') {
        recs.push({
          type: 'ADD_REINFORCEMENT',
          target: kf.kcName,
          targetId: kf.kcId,
          rationale: `KC "${kf.kcName}" is weakly supported (${kf.evidenceCount} mappings, ${kf.highStrengthCount} high). Add more content or strengthen existing coverage.`,
          priority: 'medium',
        });
      }
      if (kf.issues.some((i) => i.type === 'NEVER_REINFORCED') && kf.status === 'well_supported') {
        recs.push({
          type: 'ADD_REINFORCEMENT',
          target: kf.kcName,
          targetId: kf.kcId,
          rationale: `KC "${kf.kcName}" appears on only one page. Reinforce it in subsequent lessons.`,
          priority: 'low',
        });
      }
    }

    // Prerequisite violations → reorder
    for (const pf of pageFindings) {
      const prereqIssues = pf.issues.filter((i) => i.type === 'PREREQ_VIOLATION');
      if (prereqIssues.length > 0) {
        recs.push({
          type: 'REORDER_CONTENT',
          target: pf.pageTitle,
          targetId: pf.pageId,
          rationale: `${prereqIssues.length} prerequisite violation(s) detected. Content order may need adjustment.`,
          priority: 'high',
        });
      }

      // Cognitive overload → split
      const overloadIssues = pf.issues.filter((i) => i.type === 'COGNITIVE_OVERLOAD');
      if (overloadIssues.length > 0) {
        recs.push({
          type: 'SPLIT_PAGE',
          target: pf.pageTitle,
          targetId: pf.pageId,
          rationale: `Page has cognitive overload issues. Consider breaking it into smaller, focused lessons.`,
          priority: 'medium',
        });
      }

      // Outcome alignment → map outcomes
      const outcomeIssues = pf.issues.filter(
        (i) => i.type === 'OUTCOME_GAP' || i.type === 'OUTCOME_NO_KC',
      );
      if (outcomeIssues.length > 0) {
        recs.push({
          type: 'MAP_OUTCOMES',
          target: pf.pageTitle,
          targetId: pf.pageId,
          rationale: `${outcomeIssues.length} learning outcome alignment issue(s). Review outcome–KC mapping.`,
          priority: 'medium',
        });
      }
    }

    // Deduplicate and sort by priority
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }

  private computeSummary(
    kcFindings: KcFinding[],
    pageFindings: PageFinding[],
    recommendations: Recommendation[],
  ): KcEvaluationSummary {
    const wellSupported = kcFindings.filter((k) => k.status === 'well_supported').length;
    const weak = kcFindings.filter((k) => k.status === 'weak').length;
    const missing = kcFindings.filter((k) => k.status === 'missing').length;

    let prereqViolations = 0;
    let overloadedPages = 0;
    let outcomeMismatches = 0;

    for (const pf of pageFindings) {
      if (pf.issues.some((i) => i.type === 'PREREQ_VIOLATION')) prereqViolations++;
      if (pf.issues.some((i) => i.type === 'COGNITIVE_OVERLOAD')) overloadedPages++;
      if (
        pf.issues.some(
          (i) =>
            i.type === 'OUTCOME_GAP' || i.type === 'OUTCOME_NO_KC' || i.type === 'KC_NO_OUTCOME',
        )
      ) {
        outcomeMismatches++;
      }
    }

    return {
      totalKCs: kcFindings.length,
      wellSupportedKCs: wellSupported,
      weakKCs: weak,
      missingKCs: missing,
      prerequisiteViolations: prereqViolations,
      overloadedPages,
      outcomeMismatches,
      totalRecommendations: recommendations.length,
    };
  }

  // ─── Data Gathering ─────────────────────────────────────

  private async getPages(
    courseId: string,
    scope: { type: string; pageIds?: string[] },
  ): Promise<PageInfo[]> {
    const modules = await this.prisma.courseModule.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      include: {
        items: {
          where: { type: 'PAGE' },
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true,
            title: true,
            moduleId: true,
            orderIndex: true,
            contentMdx: true,
            learningOutcomes: true,
          },
        },
      },
    });

    let globalOrder = 0;
    const allPages: PageInfo[] = [];

    for (const mod of modules) {
      for (const item of mod.items) {
        let blockCount = 0;
        if (item.contentMdx) {
          try {
            const doc = JSON.parse(item.contentMdx);
            blockCount = Array.isArray(doc.blocks) ? doc.blocks.length : 0;
          } catch {
            blockCount = 0;
          }
        }

        allPages.push({
          id: item.id,
          title: item.title,
          moduleId: mod.id,
          moduleTitle: mod.title,
          orderIndex: item.orderIndex,
          moduleOrderIndex: mod.orderIndex,
          contentMdx: item.contentMdx,
          learningOutcomes: item.learningOutcomes as string[] | null,
          blockCount,
          globalOrder: globalOrder++,
        });
      }
    }

    // Filter by scope
    if (scope.type === 'pages' && scope.pageIds && scope.pageIds.length > 0) {
      const ids = new Set(scope.pageIds);
      return allPages.filter((p) => ids.has(p.id));
    }

    return allPages;
  }

  private async getApprovedKCs(courseId: string): Promise<KcInfo[]> {
    const kcs = await this.prisma.proposedKC.findMany({
      where: { courseId, status: 'APPROVED' },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        confidenceLevel: true,
      },
    });
    return kcs;
  }

  private async getMappings(courseId: string): Promise<MappingInfo[]> {
    const mappings = await this.prisma.kcContentMapping.findMany({
      where: { courseId },
      include: { kc: { select: { name: true } } },
    });
    return mappings.map((m: any) => ({
      id: m.id,
      kcId: m.kcId,
      kcName: m.kc.name,
      pageId: m.pageId,
      strength: m.strength,
      blockIds: m.blockIds,
    }));
  }

  private async getEdges(courseId: string): Promise<EdgeInfo[]> {
    const edges = await this.prisma.kcEdge.findMany({
      where: { courseId },
      select: {
        fromKcId: true,
        toKcId: true,
        relationship: true,
        weight: true,
      },
    });
    return edges;
  }

  private async saveResult(runId: string, output: KcEvaluationOutput) {
    await this.prisma.kcEvaluationRun.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        results: output as unknown as any,
        completedAt: new Date(),
      },
    });
  }

  // ─── Utilities ──────────────────────────────────────────

  private normalizeWords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }
}

function emptySummary(): KcEvaluationSummary {
  return {
    totalKCs: 0,
    wellSupportedKCs: 0,
    weakKCs: 0,
    missingKCs: 0,
    prerequisiteViolations: 0,
    overloadedPages: 0,
    outcomeMismatches: 0,
    totalRecommendations: 0,
  };
}
