import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RagService, ChunkWithScore } from '../rag/rag.service';
import { LlmService, type FunnelContentPart } from '../rag/llm.service';
import { BlobService } from '../blob/blob.service';
import { KcSuggestionService } from '../kc/kc-suggestion.service';
import {
  buildPageContentSystemPrompt,
  buildPageContentUserPrompt,
  buildSuggestedPrompt,
  buildRetrievalQueryForPage,
  PageContext,
} from './page-content-prompts';

// ─── Interfaces ─────────────────────────────────────────

export interface GeneratePageContentInput {
  courseId: string;
  userId: string;
  pageId: string;
  moduleId: string;
  selectedSourceIds: string[];
  strictSources: boolean;
  scopePreference: 'module_only' | 'module_then_course' | 'course_only';
  adminPrompt: string;
}

export interface PageContentResult {
  pageId: string;
  status: 'OK' | 'NOT_ENOUGH_INFO' | 'ERROR';
  jobId?: string;
  content?: any;
  citations?: any[];
  missingInfo?: string[];
  message?: string;
}

/**
 * A PDF source attached to a generation request. Two flavours:
 *  - `file_id`: the PDF was previously uploaded to OpenAI's Files API at
 *    ingest time. We just reference the id (tiny payload).
 *  - `inline`: no cached id available, so we ship the base64 bytes with
 *    this request. Heavier but works for any source.
 */
type PdfAttachment =
  | { kind: 'file_id'; filename: string; fileId: string }
  | { kind: 'inline'; filename: string; base64: string; byteLength: number };

export interface BatchGenerateInput {
  courseId: string;
  userId: string;
  moduleId: string;
  pageIds: string[];
  selectedSourceIds: string[];
  strictSources: boolean;
  scopePreference: 'module_only' | 'module_then_course' | 'course_only';
  adminPrompt: string;
}

@Injectable()
export class PageContentService {
  private readonly logger = new Logger(PageContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
    private readonly llmService: LlmService,
    private readonly blobService: BlobService,
    private readonly kcSuggestionService: KcSuggestionService,
  ) {}

  // Max bytes per attached PDF; OpenAI inline file_data should stay modest.
  private readonly MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
  // Max total bytes across all attached PDFs in a single call.
  private readonly MAX_TOTAL_PDF_BYTES = 25 * 1024 * 1024; // 25 MB
  // Max number of PDFs to attach per call (avoid blowing context window).
  private readonly MAX_PDF_ATTACHMENTS = 3;

  // ─── Suggest Prompt ────────────────────────────────────

  async suggestPrompt(input: {
    courseId: string;
    moduleId: string;
    pageIds: string[];
    selectedSourceIds: string[];
    strictSources: boolean;
    scopePreference: string;
  }): Promise<{ suggestedPrompt: string }> {
    const course = await this.prisma.course.findUnique({
      where: { id: input.courseId },
      select: { title: true, description: true },
    });
    if (!course) throw new NotFoundException('Course not found');

    const mod = await this.prisma.courseModule.findUnique({
      where: { id: input.moduleId },
      select: { title: true, items: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true, learningOutcomes: true } } },
    });
    if (!mod) throw new NotFoundException('Module not found');

    const selectedSourceNames = await this.resolveSourceNames(input.courseId, input.selectedSourceIds);

    // Build suggested prompt for the first page (or aggregate for bulk)
    if (input.pageIds.length === 1) {
      const pageItem = mod.items.find((i) => i.id === input.pageIds[0]);
      if (!pageItem) throw new NotFoundException('Page not found');
      const pageContext: PageContext = {
        courseTitle: course.title,
        courseDescription: course.description,
        moduleTitle: mod.title,
        pageTitle: pageItem.title,
        learningOutcomes: (pageItem.learningOutcomes as string[]) || [],
        siblingPageTitles: mod.items.map((i) => i.title),
        pageIndex: mod.items.findIndex((i) => i.id === pageItem.id),
      };
      return {
        suggestedPrompt: buildSuggestedPrompt(pageContext, selectedSourceNames, input.scopePreference),
      };
    }

    // Bulk: suggest prompt covering all selected pages
    const selectedPages = mod.items.filter((i) => input.pageIds.includes(i.id));
    const pageTitles = selectedPages.map((p) => p.title);
    return {
      suggestedPrompt: `Generate detailed lesson content for each of the following ${pageTitles.length} pages in the module "${mod.title}" of course "${course.title}":\n\n${pageTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\nUse ${selectedSourceNames.length > 0 ? `the ${selectedSourceNames.length} selected source(s)` : 'all available course materials'} (scope: ${input.scopePreference}).\n\nFor each page, include clear explanations, worked examples, common misconceptions, and quick comprehension checks.`,
    };
  }

  // ─── Single Page Generation ────────────────────────────

  async generatePageContent(input: GeneratePageContentInput): Promise<PageContentResult> {
    const startTime = Date.now();

    // 1. Verify course + ownership
    const course = await this.prisma.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, title: true, description: true, teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== input.userId) {
      throw new ForbiddenException('Only the course teacher can generate content');
    }

    // 2. Get module + page context
    const mod = await this.prisma.courseModule.findUnique({
      where: { id: input.moduleId },
      select: {
        title: true,
        items: { orderBy: { orderIndex: 'asc' }, select: { id: true, title: true, learningOutcomes: true, estimatedMinutes: true } },
      },
    });
    if (!mod) throw new NotFoundException('Module not found');

    const pageItem = mod.items.find((i) => i.id === input.pageId);
    if (!pageItem) throw new NotFoundException('Page not found');

    const pageContext: PageContext = {
      courseTitle: course.title,
      courseDescription: course.description,
      moduleTitle: mod.title,
      pageTitle: pageItem.title,
      learningOutcomes: (pageItem.learningOutcomes as string[]) || [],
      estimatedMinutes: pageItem.estimatedMinutes ?? undefined,
      siblingPageTitles: mod.items.map((i) => i.title),
      pageIndex: mod.items.findIndex((i) => i.id === pageItem.id),
    };

    // 3. Create job
    const job = await this.prisma.llmGenerationJob.create({
      data: {
        courseId: input.courseId,
        userId: input.userId,
        jobType: 'page_content',
        status: 'RUNNING',
        startedAt: new Date(),
        inputPayload: {
          pageId: input.pageId,
          moduleId: input.moduleId,
          pageTitle: pageItem.title,
          selectedSourceIds: input.selectedSourceIds,
          scopePreference: input.scopePreference,
          strictSources: input.strictSources,
          adminPrompt: input.adminPrompt,
        },
      },
    });

    try {
      // 4. Retrieve RAG chunks
      const retrievalQuery = buildRetrievalQueryForPage(pageContext);
      const chunks = await this.retrieveChunks(
        input.courseId,
        retrievalQuery,
        input.selectedSourceIds,
        input.scopePreference,
      );

      this.logger.log(`Retrieved ${chunks.length} chunks for page "${pageItem.title}"`);

      // 5. Strict mode check
      if (input.strictSources && chunks.length === 0) {
        const result: PageContentResult = {
          pageId: input.pageId,
          status: 'NOT_ENOUGH_INFO',
          jobId: job.id,
          missingInfo: ['No indexed source content available for this page topic.'],
        };
        await this.updateJob(job.id, 'COMPLETED', result, chunks, Date.now() - startTime);
        return result;
      }

      // 6. Resolve the teacher's provider/model spec so we can choose
      // between native multimodal (OpenAI Files API) and chunked-text
      // fallback (everything else, including Gemini).
      const resolved = await this.llmService.getResolvedChatModelForUser(input.userId);
      if (!resolved) {
        throw new BadRequestException(
          'No LLM API key configured. Add your API key in AI Settings first.',
        );
      }
      const supportsFilesApi = resolved.spec.supportsOpenAiFilesApi === true;

      // 7. Build prompts
      const selectedSourceNames = await this.resolveSourceNames(input.courseId, input.selectedSourceIds);
      const systemPrompt = buildPageContentSystemPrompt(input.strictSources);
      const userPrompt = buildPageContentUserPrompt(pageContext, chunks, input.adminPrompt, selectedSourceNames);

      // 7b. Multimodal PDFs are an OpenAI-only path today (the Files API).
      // Under Gemini we deliberately fall back to the chunked-text RAG
      // context that's already in `userPrompt` — no new column required.
      // See LLM_20260602/stage3 §5: chose option (b).
      const pdfAttachments = supportsFilesApi
        ? await this.fetchPdfAttachments(input.courseId, input.selectedSourceIds)
        : [];
      if (pdfAttachments.length > 0) {
        const cached = pdfAttachments.filter((a) => a.kind === 'file_id').length;
        const inlineBytes = pdfAttachments
          .filter((a): a is Extract<PdfAttachment, { kind: 'inline' }> => a.kind === 'inline')
          .reduce((s, p) => s + p.byteLength, 0);
        this.logger.log(
          `Attaching ${pdfAttachments.length} PDF(s) to LLM call for page "${pageItem.title}" — ${cached} via cached file_id, ${pdfAttachments.length - cached} inline (${inlineBytes} bytes)`,
        );
      } else if (!supportsFilesApi) {
        this.logger.log(
          `Provider ${resolved.provider} does not support OpenAI Files API — falling back to chunked-text RAG for page "${pageItem.title}"`,
        );
      }

      // 8. Call LLM through the registry-driven funnel. When the model
      // supports OpenAI Files API and we have PDF attachments, send them
      // as multimodal content parts. Otherwise the funnel hands a plain
      // string to the provider.
      const userContent: string | FunnelContentPart[] =
        pdfAttachments.length > 0
          ? [
              { type: 'text', text: userPrompt },
              ...pdfAttachments.map<FunnelContentPart>((p) =>
                p.kind === 'file_id'
                  ? { type: 'file', file: { file_id: p.fileId } }
                  : {
                      type: 'file',
                      file: {
                        filename: p.filename,
                        file_data: `data:application/pdf;base64,${p.base64}`,
                      },
                    },
              ),
            ]
          : userPrompt;

      const llmResult = await this.llmService.callLlmStructured(
        input.userId,
        {
          systemPrompt,
          messages: [{ role: 'user', content: userContent }],
          jsonMode: true,
          maxTokens: 8192,
          temperature: 0.3,
        },
        { feature: 'page_content_generation', courseId: input.courseId },
      );

      // 9. Parse output
      const parsed = this.parsePageContentOutput(llmResult.content, pageItem.title);

      // 10. Save content to page as block-based JSON
      const contentJson = this.renderContentToBlocks(parsed, job.id);
      await this.prisma.moduleItem.update({
        where: { id: input.pageId },
        data: {
          contentMdx: contentJson,
          generationJobId: job.id,
        },
      });

      // 10b. Create version snapshot with AI source
      await this.createVersionSnapshot(input.pageId, contentJson, 'ai', input.userId, job.id);

      // 11. Update job
      const durationMs = Date.now() - startTime;
      const resolvedModel = llmResult.model ?? resolved.spec.id;
      await this.prisma.llmGenerationJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          outputPayload: parsed as any,
          retrievedChunkIds: chunks.map((c) => c.id),
          model: resolvedModel,
          promptTokens: llmResult.promptTokens,
          completionTokens: llmResult.completionTokens,
          durationMs,
          completedAt: new Date(),
        },
      });

      // 12. Audit log
      await this.createAuditLog({
        courseId: input.courseId,
        userId: input.userId,
        action: 'generate_page_content',
        model: resolvedModel,
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
        durationMs,
        inputPayload: {
          pageId: input.pageId,
          pageTitle: pageItem.title,
          selectedSourceIds: input.selectedSourceIds,
          scopePreference: input.scopePreference,
          chunkCount: chunks.length,
        },
        outputPayload: { jobId: job.id, status: parsed.status },
      });

      // 13. Fire-and-forget KC suggestion (non-blocking)
      this.kcSuggestionService
        .suggestKcsForPage({
          courseId: input.courseId,
          pageId: input.pageId,
          moduleTitle: mod.title,
          courseTitle: course.title,
          pageTitle: pageItem.title,
          contentJson,
          generationJobId: job.id,
          userId: input.userId,
        })
        .catch((err) =>
          this.logger.error(`KC suggestion background task failed: ${err.message}`),
        );

      return {
        pageId: input.pageId,
        status: parsed.status || 'OK',
        jobId: job.id,
        content: parsed.content,
        citations: parsed.citations,
        missingInfo: parsed.missingInfo,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      await this.prisma.llmGenerationJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: err.message || 'Unknown error',
          durationMs,
          completedAt: new Date(),
        },
      });
      this.logger.error(`Page content generation failed: ${err.message}`, err.stack);
      return {
        pageId: input.pageId,
        status: 'ERROR',
        jobId: job.id,
        message: err.message || 'Generation failed',
      };
    }
  }

  // ─── Batch Generation ──────────────────────────────────

  async generateBatch(input: BatchGenerateInput): Promise<{
    batchJobId: string;
    results: PageContentResult[];
  }> {
    // Create a parent batch job
    const batchJob = await this.prisma.llmGenerationJob.create({
      data: {
        courseId: input.courseId,
        userId: input.userId,
        jobType: 'page_content_batch',
        status: 'RUNNING',
        startedAt: new Date(),
        inputPayload: {
          moduleId: input.moduleId,
          pageIds: input.pageIds,
          selectedSourceIds: input.selectedSourceIds,
          scopePreference: input.scopePreference,
          strictSources: input.strictSources,
          adminPrompt: input.adminPrompt,
        },
      },
    });

    const results: PageContentResult[] = [];

    // Process pages with concurrency limit of 2
    const concurrency = 2;
    for (let i = 0; i < input.pageIds.length; i += concurrency) {
      const batch = input.pageIds.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map((pageId) =>
          this.generatePageContent({
            courseId: input.courseId,
            userId: input.userId,
            pageId,
            moduleId: input.moduleId,
            selectedSourceIds: input.selectedSourceIds,
            strictSources: input.strictSources,
            scopePreference: input.scopePreference,
            adminPrompt: input.adminPrompt,
          }),
        ),
      );
      results.push(...batchResults);
    }

    // Update batch job
    const successCount = results.filter((r) => r.status === 'OK').length;
    const failCount = results.filter((r) => r.status === 'ERROR').length;

    await this.prisma.llmGenerationJob.update({
      where: { id: batchJob.id },
      data: {
        status: failCount === results.length ? 'FAILED' : 'COMPLETED',
        outputPayload: {
          totalPages: results.length,
          successCount,
          failCount,
          notEnoughInfoCount: results.filter((r) => r.status === 'NOT_ENOUGH_INFO').length,
          pageResults: results.map((r) => ({ pageId: r.pageId, status: r.status, jobId: r.jobId })),
        } as any,
        completedAt: new Date(),
        durationMs: 0,
      },
    });

    return { batchJobId: batchJob.id, results };
  }

  // ─── Private: Retrieval ────────────────────────────────

  private async retrieveChunks(
    courseId: string,
    query: string,
    selectedSourceIds: string[],
    scopePreference: string,
  ): Promise<ChunkWithScore[]> {
    if (selectedSourceIds.length > 0) {
      const chunks = await this.ragService.queryChunksFiltered(
        courseId,
        query,
        selectedSourceIds,
        15,
      );
      if (scopePreference === 'module_then_course' && chunks.length < 3) {
        const allChunks = await this.ragService.queryChunks(courseId, query, 15);
        const existingIds = new Set(chunks.map((c) => c.id));
        const additional = allChunks.filter((c) => !existingIds.has(c.id));
        return [...chunks, ...additional].slice(0, 15);
      }
      return chunks;
    }
    return this.ragService.queryChunks(courseId, query, 15);
  }

  // ─── Private: Source Names ─────────────────────────────

  private async resolveSourceNames(
    courseId: string,
    sourceIds: string[],
  ): Promise<Array<{ sourceId: string; name: string }>> {
    if (sourceIds.length === 0) return [];
    const docs = await this.prisma.sourceDocument.findMany({
      where: { courseId, id: { in: sourceIds } },
      select: { id: true, title: true, filename: true },
    });
    return docs.map((d) => ({ sourceId: d.id, name: d.title || d.filename }));
  }

  /**
   * Fetch selected source documents that are PDFs and return them in a form
   * suitable for attaching to a multimodal OpenAI request. Prefers the
   * cached OpenAI file_id (set at ingest time) so the request payload stays
   * small; falls back to inline base64 when no file_id is available.
   * Skips non-PDF sources (text sources already arrive via RAG chunks).
   * Enforces per-file and total size caps when falling back to inline bytes.
   *
   * Stage 3 note: Only called when the resolved chat model spec has
   * `supportsOpenAiFilesApi === true`. Gemini teachers fall back to the
   * chunked-text RAG path that's already injected into the user prompt.
   */
  private async fetchPdfAttachments(
    courseId: string,
    selectedSourceIds: string[],
  ): Promise<PdfAttachment[]> {
    if (!selectedSourceIds || selectedSourceIds.length === 0) return [];

    const docs = await this.prisma.sourceDocument.findMany({
      where: {
        id: { in: selectedSourceIds },
        courseId,
        mimeType: 'application/pdf',
      },
      select: {
        id: true,
        filename: true,
        blobKey: true,
        sizeBytes: true,
        openaiFileId: true,
      },
      orderBy: { createdAt: 'asc' },
      take: this.MAX_PDF_ATTACHMENTS,
    });

    const attachments: PdfAttachment[] = [];
    let totalInlineBytes = 0;

    for (const doc of docs) {
      // Preferred path: cached file_id, no bytes need to ride along.
      if (doc.openaiFileId) {
        attachments.push({
          kind: 'file_id',
          filename: doc.filename,
          fileId: doc.openaiFileId,
        });
        continue;
      }

      // Fallback: inline base64. Apply size caps to avoid blowing context.
      if (doc.sizeBytes && doc.sizeBytes > this.MAX_PDF_BYTES) {
        this.logger.warn(
          `Skipping PDF "${doc.filename}" (${doc.sizeBytes} bytes) — exceeds per-file cap of ${this.MAX_PDF_BYTES}`,
        );
        continue;
      }
      if (totalInlineBytes + (doc.sizeBytes ?? 0) > this.MAX_TOTAL_PDF_BYTES) {
        this.logger.warn(
          `Stopping PDF attachments at "${doc.filename}" — total would exceed ${this.MAX_TOTAL_PDF_BYTES} bytes`,
        );
        break;
      }
      try {
        const { body } = await this.blobService.get(doc.blobKey);
        if (body.length > this.MAX_PDF_BYTES) {
          this.logger.warn(`Skipping "${doc.filename}" — actual body ${body.length} bytes exceeds cap`);
          continue;
        }
        attachments.push({
          kind: 'inline',
          filename: doc.filename,
          base64: body.toString('base64'),
          byteLength: body.length,
        });
        totalInlineBytes += body.length;
      } catch (err) {
        this.logger.error(`Failed to fetch PDF blob "${doc.blobKey}": ${(err as Error).message}`);
      }
    }
    return attachments;
  }

  // ─── Private: Parse & Render ───────────────────────────

  private parsePageContentOutput(raw: string, fallbackTitle: string): any {
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1]!.trim();

    try {
      const parsed = JSON.parse(jsonStr);
      return {
        status: parsed.status || 'OK',
        pageTitle: parsed.pageTitle || fallbackTitle,
        content: parsed.content || {},
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        missingInfo: Array.isArray(parsed.missingInfo) ? parsed.missingInfo : [],
      };
    } catch (err: any) {
      this.logger.error(`Failed to parse page content JSON: ${err.message}`);
      throw new BadRequestException(`LLM returned invalid JSON. Parse error: ${err.message}`);
    }
  }

  /**
   * Convert parsed LLM output into a BlockDocument JSON string.
   * Each section maps to an appropriate block type with AI metadata.
   */
  private renderContentToBlocks(parsed: any, jobId: string): string {
    const c = parsed.content || {};
    let blockCounter = 0;
    const mkId = () => `blk_ai_${++blockCounter}`;
    const aiMeta = { generatedBy: 'ai', generationJobId: jobId };

    const blocks: any[] = [];

    // Title + Learning Outcomes text block
    let introHtml = `<h1>${this.esc(parsed.pageTitle)}</h1>`;
    if (c.learning_outcomes?.length) {
      introHtml += `<h2>Learning Outcomes</h2><ul>${c.learning_outcomes.map((o: string) => `<li>${this.esc(o)}</li>`).join('')}</ul>`;
    }
    if (c.key_concepts?.length) {
      introHtml += `<h2>Key Concepts</h2><ul>${c.key_concepts.map((k: string) => `<li>${this.esc(k)}</li>`).join('')}</ul>`;
    }
    blocks.push({ id: mkId(), type: 'text', data: { html: introHtml }, metadata: aiMeta });

    // Explanation text block
    if (c.explanation) {
      blocks.push({
        id: mkId(),
        type: 'text',
        data: { html: this.wrapInParagraphs(c.explanation) },
        metadata: aiMeta,
      });
    }

    // Worked examples
    if (c.worked_examples?.length) {
      let exHtml = `<h2>Worked Examples</h2>`;
      c.worked_examples.forEach((ex: any, i: number) => {
        exHtml += `<h3>Example ${i + 1}</h3>`;
        exHtml += `<p><strong>Problem:</strong> ${this.esc(ex.problem)}</p>`;
        exHtml += `<p><strong>Solution:</strong> ${this.esc(ex.solution)}</p>`;
      });
      blocks.push({ id: mkId(), type: 'text', data: { html: exHtml }, metadata: aiMeta });
    }

    // Misconceptions as callout blocks
    if (c.misconceptions?.length) {
      c.misconceptions.forEach((m: any) => {
        blocks.push({
          id: mkId(),
          type: 'callout',
          data: {
            variant: 'common-mistake',
            html: `<p><strong>Misconception:</strong> ${this.esc(m.misconception)}</p><p><strong>Correction:</strong> ${this.esc(m.correction)}</p>`,
          },
          metadata: aiMeta,
        });
      });
    }

    // Quick check
    if (c.quick_check?.length) {
      let qcHtml = `<h2>Quick Check</h2>`;
      c.quick_check.forEach((q: any, i: number) => {
        qcHtml += `<p><strong>Q${i + 1}:</strong> ${this.esc(q.question)}</p>`;
        qcHtml += `<p><em>Answer:</em> ${this.esc(q.answer)}${q.explanation ? ` — ${this.esc(q.explanation)}` : ''}</p>`;
      });
      blocks.push({ id: mkId(), type: 'text', data: { html: qcHtml }, metadata: aiMeta });
    }

    // Summary
    if (c.summary_next_steps) {
      blocks.push({
        id: mkId(),
        type: 'callout',
        data: {
          variant: 'tip',
          html: `<p><strong>Summary:</strong> ${this.esc(c.summary_next_steps)}</p>`,
        },
        metadata: aiMeta,
      });
    }

    // Citations divider + sources
    if (parsed.citations?.length) {
      blocks.push({ id: mkId(), type: 'divider', data: {}, metadata: aiMeta });
      const srcHtml = `<h3>Sources</h3><ul>${parsed.citations.map((cit: any) => `<li>${this.esc(cit.marker)}</li>`).join('')}</ul><p><em>AI-generated content. Review before publishing.</em></p>`;
      blocks.push({ id: mkId(), type: 'text', data: { html: srcHtml }, metadata: aiMeta });
    }

    return JSON.stringify({ version: 2, blocks });
  }

  private esc(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private wrapInParagraphs(text: string): string {
    if (!text) return '';
    // If it already looks like HTML, pass through
    if (/<[a-z][\s\S]*>/i.test(text)) return text;
    // Otherwise wrap paragraphs
    return text
      .split(/\n\n+/)
      .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
      .join('');
  }

  private async createVersionSnapshot(
    itemId: string,
    contentJson: string,
    source: string,
    userId?: string,
    jobId?: string,
  ) {
    try {
      const latest = await this.prisma.pageContentVersion.findFirst({
        where: { itemId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const nextVersion = (latest?.version ?? 0) + 1;

      await this.prisma.pageContentVersion.create({
        data: {
          itemId,
          version: nextVersion,
          contentJson,
          source,
          authorId: userId || null,
          jobId: jobId || null,
        },
      });
    } catch (err) {
      this.logger.error('Failed to create version snapshot', err);
    }
  }

  // ─── Private: Job Update ───────────────────────────────

  private async updateJob(
    jobId: string,
    status: string,
    result: any,
    chunks: ChunkWithScore[],
    durationMs: number,
  ) {
    await this.prisma.llmGenerationJob.update({
      where: { id: jobId },
      data: {
        status: status as any,
        outputPayload: result as any,
        retrievedChunkIds: chunks.map((c) => c.id),
        durationMs,
        completedAt: new Date(),
      },
    });
  }

  // ─── Private: Audit ────────────────────────────────────

  private async createAuditLog(data: {
    courseId: string;
    userId: string;
    action: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    inputPayload?: any;
    outputPayload?: any;
  }) {
    try {
      await this.prisma.llmAuditLog.create({ data });
    } catch (err) {
      this.logger.error('Failed to create audit log', err);
    }
  }
}
