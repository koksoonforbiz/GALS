import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  StartCoverageInput,
  SyllabusOutcome,
  OutcomeKcMap,
  CoverageAnalysisOutput,
  CoverageSummary,
  UnmappedOutcome,
  WeaklyMappedOutcome,
  OverrepresentedKC,
  LateIntroducedKC,
  CoverageCell,
  TimelineEntry,
  CoverageRecommendation,
} from './curriculum-coverage.types';
import {
  buildSyllabusParserSystemPrompt,
  buildSyllabusParserUserPrompt,
  buildOutcomeMappingSystemPrompt,
  buildOutcomeMappingUserPrompt,
} from './curriculum-coverage-prompts';

interface KcInfo {
  id: string;
  name: string;
  description: string | null;
}

interface MappingInfo {
  kcId: string;
  pageId: string;
  strength: string;
}

interface PageInfo {
  id: string;
  title: string;
  moduleTitle: string;
  globalOrder: number;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class CurriculumCoverageService {
  private readonly logger = new Logger(CurriculumCoverageService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Public API ─────────────────────────────────────────

  async startCoverage(input: StartCoverageInput) {
    const course = await this.prisma.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== input.userId) {
      throw new ForbiddenException('Only the course teacher can run coverage analysis');
    }

    const run = await this.prisma.curriculumCoverageRun.create({
      data: {
        courseId: input.courseId,
        userId: input.userId,
        status: 'RUNNING',
        syllabusText: input.syllabusText,
        startedAt: new Date(),
      },
    });

    // Fire and forget
    this.runCoverage(run.id, input).catch((err) => {
      this.logger.error(`Coverage run ${run.id} failed: ${errMsg(err)}`);
    });

    return { runId: run.id, status: 'RUNNING' };
  }

  async getRun(runId: string, userId: string) {
    const run = await this.prisma.curriculumCoverageRun.findUnique({
      where: { id: runId },
    });
    if (!run) throw new NotFoundException('Coverage run not found');
    if (run.userId !== userId) throw new ForbiddenException();
    return run;
  }

  async listRuns(courseId: string, userId: string) {
    return this.prisma.curriculumCoverageRun.findMany({
      where: { courseId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        errorMessage: true,
        startedAt: true,
        completedAt: true,
        createdAt: true,
        // Omit large JSON fields for list view
        coverageResults: false,
        parsedOutcomes: false,
        outcomeKcMaps: false,
        syllabusText: false,
      },
    });
  }

  async updateOutcomeKcMap(
    runId: string,
    userId: string,
    outcomeId: string,
    kcId: string,
    confidence: number,
    rationale: string,
  ) {
    const run = await this.getRun(runId, userId);
    const maps = (run.outcomeKcMaps as unknown as OutcomeKcMap[]) || [];

    // Find existing or add new
    const existing = maps.find((m) => m.outcomeId === outcomeId && m.kcId === kcId);
    if (existing) {
      existing.confidence = confidence;
      existing.rationale = rationale;
    } else {
      // Look up KC name
      const kc = await this.prisma.proposedKC.findUnique({
        where: { id: kcId },
        select: { name: true },
      });
      maps.push({
        outcomeId,
        kcId,
        kcName: kc?.name || 'Unknown',
        confidence,
        rationale,
      });
    }

    await this.prisma.curriculumCoverageRun.update({
      where: { id: runId },
      data: { outcomeKcMaps: maps as unknown as any },
    });

    return { ok: true };
  }

  async removeOutcomeKcMap(runId: string, userId: string, outcomeId: string, kcId: string) {
    const run = await this.getRun(runId, userId);
    const maps = (run.outcomeKcMaps as unknown as OutcomeKcMap[]) || [];
    const filtered = maps.filter((m) => !(m.outcomeId === outcomeId && m.kcId === kcId));

    await this.prisma.curriculumCoverageRun.update({
      where: { id: runId },
      data: { outcomeKcMaps: filtered as unknown as any },
    });

    return { ok: true };
  }

  async reanalyze(runId: string, userId: string) {
    const run = await this.getRun(runId, userId);
    const outcomes = (run.parsedOutcomes as unknown as SyllabusOutcome[]) || [];
    const maps = (run.outcomeKcMaps as unknown as OutcomeKcMap[]) || [];

    if (outcomes.length === 0) {
      throw new NotFoundException('No parsed outcomes to analyze');
    }

    const kcs = await this.getApprovedKCs(run.courseId);
    const contentMappings = await this.getContentMappings(run.courseId);
    const pages = await this.getPages(run.courseId);

    const results = this.buildCoverageAnalysis(
      outcomes,
      maps,
      kcs,
      contentMappings,
      pages,
      run.courseId,
      run.syllabusText.length,
    );

    await this.prisma.curriculumCoverageRun.update({
      where: { id: runId },
      data: {
        coverageResults: results as unknown as any,
        completedAt: new Date(),
      },
    });

    return this.getRun(runId, userId);
  }

  // ─── Core Pipeline ────────────────────────────────────────

  private async runCoverage(runId: string, input: StartCoverageInput) {
    try {
      // 1. Get LLM credentials
      const credentials = await this.getLlmCredentials(input.userId);

      // 2. Parse syllabus into outcomes
      let outcomes: SyllabusOutcome[];
      if (credentials) {
        outcomes = await this.parseSyllabusWithLLM(
          input.syllabusText,
          credentials.apiKey,
          credentials.model,
        );
      } else {
        outcomes = this.parseSyllabusHeuristic(input.syllabusText);
      }

      if (outcomes.length === 0) {
        outcomes = this.parseSyllabusHeuristic(input.syllabusText);
      }

      await this.prisma.curriculumCoverageRun.update({
        where: { id: runId },
        data: { parsedOutcomes: outcomes as unknown as any },
      });

      // 3. Get approved KCs
      const kcs = await this.getApprovedKCs(input.courseId);

      // 4. Map outcomes to KCs
      let maps: OutcomeKcMap[];
      if (credentials && kcs.length > 0) {
        maps = await this.mapOutcomesToKCsWithLLM(
          outcomes,
          kcs,
          credentials.apiKey,
          credentials.model,
        );
      } else {
        maps = this.mapOutcomesToKCsHeuristic(outcomes, kcs);
      }

      await this.prisma.curriculumCoverageRun.update({
        where: { id: runId },
        data: { outcomeKcMaps: maps as unknown as any },
      });

      // 5. Run coverage analysis
      const contentMappings = await this.getContentMappings(input.courseId);
      const pages = await this.getPages(input.courseId);

      const results = this.buildCoverageAnalysis(
        outcomes,
        maps,
        kcs,
        contentMappings,
        pages,
        input.courseId,
        input.syllabusText.length,
      );

      await this.prisma.curriculumCoverageRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          coverageResults: results as unknown as any,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      await this.prisma.curriculumCoverageRun.update({
        where: { id: runId },
        data: { status: 'FAILED', errorMessage: errMsg(err) },
      });
      throw err;
    }
  }

  // ─── Syllabus Parsing ─────────────────────────────────────

  private async parseSyllabusWithLLM(
    syllabusText: string,
    apiKey: string,
    model: string,
  ): Promise<SyllabusOutcome[]> {
    const systemPrompt = buildSyllabusParserSystemPrompt();
    const userPrompt = buildSyllabusParserUserPrompt(syllabusText);
    const raw = await this.callOpenAiApi(systemPrompt, userPrompt, apiKey, model);

    try {
      let jsonStr = raw.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1]!.trim();

      const parsed = JSON.parse(jsonStr);
      const outcomes: SyllabusOutcome[] = (parsed.outcomes || [])
        .filter((o: any) => o && typeof o.description === 'string' && o.description.trim())
        .map((o: any, i: number) => ({
          id: `SO-${i + 1}`,
          code: o.code || `SO-${i + 1}`,
          description: o.description.trim(),
          bloomLevel: o.bloomLevel || null,
          category: o.category || null,
        }));
      return outcomes;
    } catch (err) {
      this.logger.error(`Failed to parse syllabus LLM response: ${errMsg(err)}`);
      return [];
    }
  }

  parseSyllabusHeuristic(syllabusText: string): SyllabusOutcome[] {
    const outcomes: SyllabusOutcome[] = [];
    const lines = syllabusText.split('\n');
    let counter = 0;

    // Pattern matching for common outcome formats
    const outcomePatterns = [
      /^(?:CLO|LO|SLO|SO|CO|PLO)\s*[.\-:]?\s*(\d[\d.]*)\s*[.:\-–]\s*(.+)/i,
      /^\d+[.)]\s*(.+(?:able to|will|can|understand|demonstrate|apply|analyze|evaluate|create).+)/i,
      /^[-•*]\s*(.+(?:able to|will|can|understand|demonstrate|apply|analyze|evaluate|create).+)/i,
      /^(?:students?\s+(?:will|should|shall|can)|by the end).+/i,
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 10) continue;

      for (const pattern of outcomePatterns) {
        const match = trimmed.match(pattern);
        if (match) {
          counter++;
          const desc = match[2] || match[1] || trimmed;
          outcomes.push({
            id: `SO-${counter}`,
            code: `SO-${counter}`,
            description: desc!.trim(),
            bloomLevel: this.detectBloomLevel(desc || trimmed),
            category: null,
          });
          break;
        }
      }
    }

    // Fallback: if no patterns matched, split by sentences that look like outcomes
    if (outcomes.length === 0) {
      const sentences = syllabusText.split(/[.;]\s+|\n/).filter((s) => s.trim().length > 15);
      for (const s of sentences) {
        if (
          /\b(understand|apply|analyze|evaluate|create|demonstrate|explain|describe|identify|compare|design|implement|develop)\b/i.test(
            s,
          )
        ) {
          counter++;
          outcomes.push({
            id: `SO-${counter}`,
            code: `SO-${counter}`,
            description: s.trim(),
            bloomLevel: this.detectBloomLevel(s),
            category: null,
          });
        }
      }
    }

    return outcomes;
  }

  private detectBloomLevel(text: string): string | null {
    const lower = text.toLowerCase();
    if (/\b(create|design|develop|construct|produce|invent)\b/.test(lower)) return 'Create';
    if (/\b(evaluate|judge|assess|critique|justify|defend)\b/.test(lower)) return 'Evaluate';
    if (/\b(analyze|compare|contrast|differentiate|examine|categorize)\b/.test(lower))
      return 'Analyze';
    if (/\b(apply|implement|use|execute|solve|demonstrate)\b/.test(lower)) return 'Apply';
    if (/\b(understand|explain|describe|summarize|interpret|classify)\b/.test(lower))
      return 'Understand';
    if (/\b(remember|recall|list|define|identify|recognize|name)\b/.test(lower)) return 'Remember';
    return null;
  }

  // ─── Outcome → KC Mapping ─────────────────────────────────

  private async mapOutcomesToKCsWithLLM(
    outcomes: SyllabusOutcome[],
    kcs: KcInfo[],
    apiKey: string,
    model: string,
  ): Promise<OutcomeKcMap[]> {
    const systemPrompt = buildOutcomeMappingSystemPrompt();
    const userPrompt = buildOutcomeMappingUserPrompt(
      outcomes.map((o) => ({ code: o.code, description: o.description })),
      kcs,
    );
    const raw = await this.callOpenAiApi(systemPrompt, userPrompt, apiKey, model);

    try {
      let jsonStr = raw.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1]!.trim();

      const parsed = JSON.parse(jsonStr);
      const kcMap = new Map(kcs.map((k) => [k.id, k]));
      const outcomeMap = new Map(outcomes.map((o) => [o.code, o]));

      const mappings: OutcomeKcMap[] = (parsed.mappings || [])
        .filter(
          (m: any) =>
            m &&
            typeof m.outcomeCode === 'string' &&
            typeof m.kcId === 'string' &&
            typeof m.confidence === 'number' &&
            m.confidence >= 0.3,
        )
        .map((m: any) => {
          const outcome = outcomeMap.get(m.outcomeCode);
          const kc = kcMap.get(m.kcId);
          return {
            outcomeId: outcome?.id || m.outcomeCode,
            kcId: m.kcId,
            kcName: kc?.name || 'Unknown',
            confidence: Math.min(1, Math.max(0, m.confidence)),
            rationale: m.rationale || '',
          };
        })
        .filter((m: OutcomeKcMap) => kcMap.has(m.kcId));

      return mappings;
    } catch (err) {
      this.logger.error(`Failed to parse outcome mapping response: ${errMsg(err)}`);
      return this.mapOutcomesToKCsHeuristic(outcomes, kcs);
    }
  }

  mapOutcomesToKCsHeuristic(outcomes: SyllabusOutcome[], kcs: KcInfo[]): OutcomeKcMap[] {
    const maps: OutcomeKcMap[] = [];

    for (const outcome of outcomes) {
      const outcomeWords = this.normalizeWords(outcome.description);

      for (const kc of kcs) {
        const kcWords = this.normalizeWords(kc.name + ' ' + (kc.description || ''));
        const overlap = outcomeWords.filter((w) => kcWords.includes(w)).length;
        const maxLen = Math.max(outcomeWords.length, kcWords.length, 1);
        const similarity = overlap / maxLen;

        if (similarity >= 0.15 && overlap >= 2) {
          maps.push({
            outcomeId: outcome.id,
            kcId: kc.id,
            kcName: kc.name,
            confidence: Math.min(1, similarity * 2),
            rationale: `Word overlap: ${overlap} terms in common`,
          });
        }
      }
    }

    return maps;
  }

  // ─── Coverage Analysis ────────────────────────────────────

  buildCoverageAnalysis(
    outcomes: SyllabusOutcome[],
    maps: OutcomeKcMap[],
    kcs: KcInfo[],
    contentMappings: MappingInfo[],
    pages: PageInfo[],
    courseId: string,
    syllabusLength: number,
  ): CoverageAnalysisOutput {
    const WEAK_THRESHOLD = 0.5;
    const OVERREP_THRESHOLD = 3; // KC linked to more than 3 outcomes

    // ─── Unmapped Outcomes ───────────────────────
    const outcomeToMaps = new Map<string, OutcomeKcMap[]>();
    for (const m of maps) {
      const existing = outcomeToMaps.get(m.outcomeId) || [];
      existing.push(m);
      outcomeToMaps.set(m.outcomeId, existing);
    }

    const unmappedOutcomes: UnmappedOutcome[] = [];
    const weaklyMappedOutcomes: WeaklyMappedOutcome[] = [];

    for (const outcome of outcomes) {
      const outcomeMaps = outcomeToMaps.get(outcome.id) || [];
      if (outcomeMaps.length === 0) {
        unmappedOutcomes.push({
          outcomeId: outcome.id,
          outcomeCode: outcome.code,
          description: outcome.description,
          reason: 'No Knowledge Component matches this outcome.',
        });
      } else {
        const bestConfidence = Math.max(...outcomeMaps.map((m) => m.confidence));
        if (bestConfidence < WEAK_THRESHOLD) {
          weaklyMappedOutcomes.push({
            outcomeId: outcome.id,
            outcomeCode: outcome.code,
            description: outcome.description,
            bestConfidence,
            linkedKCs: outcomeMaps.map((m) => ({
              kcId: m.kcId,
              kcName: m.kcName,
              confidence: m.confidence,
            })),
          });
        }
      }
    }

    // ─── Overrepresented KCs ─────────────────────
    const kcToOutcomes = new Map<string, string[]>();
    for (const m of maps) {
      const existing = kcToOutcomes.get(m.kcId) || [];
      existing.push(m.outcomeId);
      kcToOutcomes.set(m.kcId, existing);
    }

    const kcToPages = new Map<string, string[]>();
    for (const cm of contentMappings) {
      const existing = kcToPages.get(cm.kcId) || [];
      if (!existing.includes(cm.pageId)) existing.push(cm.pageId);
      kcToPages.set(cm.kcId, existing);
    }

    const overrepresentedKCs: OverrepresentedKC[] = [];
    for (const kc of kcs) {
      const linkedOutcomes = kcToOutcomes.get(kc.id) || [];
      if (linkedOutcomes.length > OVERREP_THRESHOLD) {
        overrepresentedKCs.push({
          kcId: kc.id,
          kcName: kc.name,
          outcomeCount: linkedOutcomes.length,
          pageCount: (kcToPages.get(kc.id) || []).length,
          linkedOutcomeIds: linkedOutcomes,
        });
      }
    }

    // ─── Late-Introduced KCs ─────────────────────
    // A KC is "late" if it maps to an early outcome but first appears in a late page
    const sortedPages = [...pages].sort((a, b) => a.globalOrder - b.globalOrder);
    const kcFirstPage = new Map<string, PageInfo>();
    for (const page of sortedPages) {
      const pageCMs = contentMappings.filter((cm) => cm.pageId === page.id);
      for (const cm of pageCMs) {
        if (!kcFirstPage.has(cm.kcId)) {
          kcFirstPage.set(cm.kcId, page);
        }
      }
    }

    const lateIntroducedKCs: LateIntroducedKC[] = [];
    const halfwayPoint =
      sortedPages.length > 0 ? sortedPages[Math.floor(sortedPages.length / 2)]!.globalOrder : 0;

    for (const kc of kcs) {
      const firstPage = kcFirstPage.get(kc.id);
      if (!firstPage) continue;

      const linkedOutcomes = kcToOutcomes.get(kc.id) || [];
      if (linkedOutcomes.length === 0) continue;

      // Check if any linked outcome is in the first half of outcomes list
      const earlyOutcomes = linkedOutcomes.filter((oId) => {
        const idx = outcomes.findIndex((o) => o.id === oId);
        return idx >= 0 && idx < outcomes.length / 2;
      });

      if (earlyOutcomes.length > 0 && firstPage.globalOrder > halfwayPoint) {
        lateIntroducedKCs.push({
          kcId: kc.id,
          kcName: kc.name,
          firstPageGlobalOrder: firstPage.globalOrder,
          firstPageTitle: firstPage.title,
          linkedOutcomeIds: linkedOutcomes,
          expectedEarlierBecause: `Maps to early syllabus outcomes (${earlyOutcomes.join(', ')}) but first appears in page "${firstPage.title}" (position ${firstPage.globalOrder + 1}/${sortedPages.length}).`,
        });
      }
    }

    // ─── Coverage Matrix ─────────────────────────
    const coverageMatrix: CoverageCell[] = [];
    for (const outcome of outcomes) {
      const outcomeMaps = outcomeToMaps.get(outcome.id) || [];
      for (const m of outcomeMaps) {
        const contentMap = contentMappings.find((cm) => cm.kcId === m.kcId);
        coverageMatrix.push({
          outcomeId: outcome.id,
          outcomeCode: outcome.code,
          kcId: m.kcId,
          kcName: m.kcName,
          confidence: m.confidence,
          strength: contentMap?.strength || null,
        });
      }
    }

    // ─── Timeline ────────────────────────────────
    const timeline: TimelineEntry[] = [];
    const coveredOutcomes = new Set<string>();

    for (const page of sortedPages) {
      const pageCMs = contentMappings.filter((cm) => cm.pageId === page.id);
      const pageKcIds = pageCMs.map((cm) => cm.kcId);

      // Which outcomes are addressed on this page?
      const pageOutcomeIds = new Set<string>();
      for (const kcId of pageKcIds) {
        const linkedOutcomes = kcToOutcomes.get(kcId) || [];
        for (const oId of linkedOutcomes) pageOutcomeIds.add(oId);
      }

      const newOutcomes: string[] = [];
      for (const oId of pageOutcomeIds) {
        if (!coveredOutcomes.has(oId)) {
          newOutcomes.push(oId);
          coveredOutcomes.add(oId);
        }
      }

      timeline.push({
        pageId: page.id,
        pageTitle: page.title,
        globalOrder: page.globalOrder,
        moduleTitle: page.moduleTitle,
        kcIds: pageKcIds,
        outcomeIds: Array.from(pageOutcomeIds),
        newOutcomesCovered: newOutcomes,
      });
    }

    // ─── Recommendations ─────────────────────────
    const recommendations = this.buildRecommendations(
      unmappedOutcomes,
      weaklyMappedOutcomes,
      overrepresentedKCs,
      lateIntroducedKCs,
      kcs,
      kcToOutcomes,
    );

    // ─── Summary ─────────────────────────────────
    const mappedOutcomeIds = new Set(maps.map((m) => m.outcomeId));
    const kcsWithOutcome = new Set(maps.map((m) => m.kcId));
    const orphanKCs = kcs.filter((kc) => !kcsWithOutcome.has(kc.id)).length;

    const summary: CoverageSummary = {
      totalOutcomes: outcomes.length,
      mappedOutcomes: mappedOutcomeIds.size,
      unmappedOutcomeCount: unmappedOutcomes.length,
      weaklyMappedOutcomeCount: weaklyMappedOutcomes.length,
      totalApprovedKCs: kcs.length,
      kcsWithOutcomeLink: kcsWithOutcome.size,
      orphanKCs,
      overrepresentedKCCount: overrepresentedKCs.length,
      lateIntroducedKCCount: lateIntroducedKCs.length,
      coveragePercent:
        outcomes.length > 0 ? Math.round((mappedOutcomeIds.size / outcomes.length) * 100) : 0,
    };

    return {
      summary,
      unmappedOutcomes,
      weaklyMappedOutcomes,
      overrepresentedKCs,
      lateIntroducedKCs,
      coverageMatrix,
      timeline,
      recommendations,
      metadata: {
        courseId,
        analyzedAt: new Date().toISOString(),
        totalPages: pages.length,
        syllabusLength,
      },
    };
  }

  private buildRecommendations(
    unmapped: UnmappedOutcome[],
    weaklyMapped: WeaklyMappedOutcome[],
    overrep: OverrepresentedKC[],
    late: LateIntroducedKC[],
    kcs: KcInfo[],
    kcToOutcomes: Map<string, string[]>,
  ): CoverageRecommendation[] {
    const recs: CoverageRecommendation[] = [];

    for (const u of unmapped) {
      recs.push({
        type: 'ADD_KC',
        target: u.outcomeCode,
        rationale: `Outcome "${u.description.slice(0, 80)}..." has no matching KC. Create or map a Knowledge Component for this outcome.`,
        priority: 'high',
      });
    }

    for (const w of weaklyMapped) {
      recs.push({
        type: 'STRENGTHEN_MAPPING',
        target: w.outcomeCode,
        rationale: `Outcome "${w.description.slice(0, 80)}..." has only weak KC alignment (best: ${Math.round(w.bestConfidence * 100)}%). Review and strengthen the mapping.`,
        priority: 'medium',
      });
    }

    for (const o of overrep) {
      recs.push({
        type: 'REVIEW_OVERLAP',
        target: o.kcName,
        targetId: o.kcId,
        rationale: `KC "${o.kcName}" is linked to ${o.outcomeCount} outcomes. Consider splitting into more specific KCs.`,
        priority: 'medium',
      });
    }

    for (const l of late) {
      recs.push({
        type: 'REORDER_CONTENT',
        target: l.kcName,
        targetId: l.kcId,
        rationale: `${l.expectedEarlierBecause} Consider introducing this content earlier.`,
        priority: 'high',
      });
    }

    // Orphan KCs (KCs with no outcome link)
    for (const kc of kcs) {
      const linked = kcToOutcomes.get(kc.id) || [];
      if (linked.length === 0) {
        recs.push({
          type: 'ADD_CONTENT',
          target: kc.name,
          targetId: kc.id,
          rationale: `KC "${kc.name}" is not linked to any syllabus outcome. Verify if it's needed or map it to an outcome.`,
          priority: 'low',
        });
      }
    }

    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return recs.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
  }

  // ─── Data Gathering ───────────────────────────────────────

  private async getApprovedKCs(courseId: string): Promise<KcInfo[]> {
    return this.prisma.proposedKC.findMany({
      where: { courseId, status: 'APPROVED' },
      select: { id: true, name: true, description: true },
    });
  }

  private async getContentMappings(courseId: string): Promise<MappingInfo[]> {
    const mappings = await this.prisma.kcContentMapping.findMany({
      where: { courseId },
      select: { kcId: true, pageId: true, strength: true },
    });
    return mappings;
  }

  private async getPages(courseId: string): Promise<PageInfo[]> {
    const modules = await this.prisma.courseModule.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      include: {
        items: {
          where: { type: 'PAGE' },
          orderBy: { orderIndex: 'asc' },
          select: { id: true, title: true, moduleId: true, orderIndex: true },
        },
      },
    });

    let globalOrder = 0;
    const allPages: PageInfo[] = [];
    for (const mod of modules) {
      for (const item of mod.items) {
        allPages.push({
          id: item.id,
          title: item.title,
          moduleTitle: mod.title,
          globalOrder: globalOrder++,
        });
      }
    }
    return allPages;
  }

  // ─── LLM Utilities ────────────────────────────────────────

  private async getLlmCredentials(
    userId: string,
  ): Promise<{ apiKey: string; model: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { llmProvider: true, llmModel: true, encryptedApiKey: true },
    });
    if (!user?.encryptedApiKey) return null;
    try {
      const apiKey = this.decryptApiKey(user.encryptedApiKey);
      return { apiKey, model: user.llmModel || 'gpt-4o-mini' };
    } catch {
      return null;
    }
  }

  private decryptApiKey(encrypted: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
    const key = crypto.scryptSync(secret, 'llm-key-salt', 32);
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0]!, 'hex');
    const authTag = Buffer.from(parts[1]!, 'hex');
    const encryptedBuf = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encryptedBuf) + decipher.final('utf8');
  }

  private async callOpenAiApi(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    model: string,
  ): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content || '';
  }

  private normalizeWords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }
}
