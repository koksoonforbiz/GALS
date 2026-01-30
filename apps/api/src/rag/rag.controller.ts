import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RagService } from './rag.service';
import { LlmService } from './llm.service';

interface RequestUser {
  id: string;
  role: string;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly llmService: LlmService,
  ) {}

  // ─── Document Management ────────────────────────────────

  @Get('courses/:courseId/documents')
  @Roles('teacher', 'admin')
  listDocuments(@Param('courseId') courseId: string) {
    return this.ragService.listDocuments(courseId);
  }

  @Post('courses/:courseId/documents')
  @Roles('teacher', 'admin')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.ragService.uploadDocument(courseId, req.user.id, {
      filename: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      buffer: file.buffer,
    });
  }

  @Delete('documents/:documentId')
  @Roles('teacher', 'admin')
  deleteDocument(
    @Request() req: { user: RequestUser },
    @Param('documentId') documentId: string,
  ) {
    return this.ragService.deleteDocument(documentId, req.user.id);
  }

  @Post('documents/:documentId/rechunk')
  @Roles('teacher', 'admin')
  rechunkDocument(@Param('documentId') documentId: string) {
    return this.ragService.chunkDocument(documentId);
  }

  // ─── RAG Query (with debug info) ───────────────────────

  @Post('courses/:courseId/rag/query')
  @Roles('teacher', 'admin')
  async ragQuery(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body() body: { query: string; topK?: number; strictSource?: boolean },
  ) {
    if (!body.query?.trim()) throw new BadRequestException('Query is required');

    const topK = body.topK ?? 10;
    const strictSource = body.strictSource ?? true;

    // 1. Retrieve chunks
    const retrievalStart = Date.now();
    const retrievedChunks = await this.ragService.queryChunks(courseId, body.query, topK * 2);
    const retrievalTimeMs = Date.now() - retrievalStart;

    // 2. Final chunks (top-K after reranking)
    const finalChunks = retrievedChunks.slice(0, topK);

    // 3. Generate answer with LLM
    const generationStart = Date.now();
    const llmResult = await this.llmService.generateRagAnswer({
      courseId,
      userId: req.user.id,
      query: body.query,
      chunks: finalChunks,
      strictSource,
    });
    const generationTimeMs = Date.now() - generationStart;

    return {
      query: body.query,
      retrievedChunks: retrievedChunks.map((c) => ({
        id: c.id,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        chunkIndex: c.chunkIndex,
        content: c.content.slice(0, 300) + (c.content.length > 300 ? '...' : ''),
        pageNumber: c.pageNumber,
        similarityScore: Math.round(c.similarityScore * 1000) / 1000,
        rerankerScore: Math.round(c.rerankerScore * 1000) / 1000,
      })),
      finalChunks: finalChunks.map((c) => ({
        id: c.id,
        documentId: c.documentId,
        documentTitle: c.documentTitle,
        chunkIndex: c.chunkIndex,
        content: c.content,
        pageNumber: c.pageNumber,
        tokenCount: c.tokenCount,
        similarityScore: Math.round(c.similarityScore * 1000) / 1000,
        rerankerScore: Math.round(c.rerankerScore * 1000) / 1000,
      })),
      answer: llmResult.answer,
      citations: llmResult.citations,
      strictSourceValid: llmResult.strictSourceValid,
      notEnoughInfo: llmResult.notEnoughInfo,
      debugInfo: {
        totalChunksSearched: retrievedChunks.length,
        retrievalTimeMs,
        rerankTimeMs: 0,
        generationTimeMs,
        model: llmResult.model,
        promptTokens: llmResult.promptTokens,
        completionTokens: llmResult.completionTokens,
      },
    };
  }

  // ─── Content Generation (Human-in-the-Loop) ────────────

  @Post('courses/:courseId/rag/generate')
  @Roles('teacher', 'admin')
  async generateContent(
    @Request() req: { user: RequestUser },
    @Param('courseId') courseId: string,
    @Body()
    body: {
      title: string;
      prompt: string;
      topK?: number;
      strictSource?: boolean;
    },
  ) {
    if (!body.prompt?.trim()) throw new BadRequestException('Prompt is required');
    if (!body.title?.trim()) throw new BadRequestException('Title is required');

    const topK = body.topK ?? 8;
    const strictSource = body.strictSource ?? true;

    // 1. Retrieve relevant chunks
    const chunks = await this.ragService.queryChunks(courseId, body.prompt, topK);

    // 2. Generate content draft with LLM
    const result = await this.llmService.generateContentDraft({
      courseId,
      userId: req.user.id,
      title: body.title,
      prompt: body.prompt,
      chunks,
      strictSource,
    });

    return result;
  }

  // ─── Draft Management ──────────────────────────────────

  @Get('courses/:courseId/drafts')
  @Roles('teacher', 'admin')
  async listDrafts(@Param('courseId') courseId: string) {
    return this.llmService.listDrafts(courseId);
  }

  @Get('drafts/:draftId')
  @Roles('teacher', 'admin')
  async getDraft(@Param('draftId') draftId: string) {
    return this.llmService.getDraft(draftId);
  }

  @Post('drafts/:draftId/approve')
  @Roles('teacher', 'admin')
  async approveDraft(
    @Request() req: { user: RequestUser },
    @Param('draftId') draftId: string,
    @Body() body: { contentMdx?: string },
  ) {
    return this.llmService.approveDraft(draftId, req.user.id, body.contentMdx);
  }

  @Post('drafts/:draftId/reject')
  @Roles('teacher', 'admin')
  async rejectDraft(
    @Request() req: { user: RequestUser },
    @Param('draftId') draftId: string,
  ) {
    return this.llmService.rejectDraft(draftId, req.user.id);
  }

  // ─── Audit Logs ────────────────────────────────────────

  @Get('courses/:courseId/llm-logs')
  @Roles('teacher', 'admin')
  async getLlmLogs(
    @Param('courseId') courseId: string,
    @Query('limit') limit?: string,
  ) {
    return this.llmService.getAuditLogs(courseId, parseInt(limit || '50', 10));
  }

  // ─── LLM Settings (API Key Management) ────────────────

  @Get('llm-settings')
  @Roles('teacher', 'admin')
  async getLlmSettings(@Request() req: { user: RequestUser }) {
    return this.llmService.getUserLlmSettings(req.user.id);
  }

  @Post('llm-settings')
  @Roles('teacher', 'admin')
  async saveLlmSettings(
    @Request() req: { user: RequestUser },
    @Body() body: { provider: string; apiKey: string; model?: string },
  ) {
    if (!body.provider?.trim()) throw new BadRequestException('Provider is required');
    if (!body.apiKey?.trim()) throw new BadRequestException('API key is required');
    return this.llmService.saveApiKey(req.user.id, body.provider, body.apiKey, body.model);
  }

  @Delete('llm-settings')
  @Roles('teacher', 'admin')
  async removeLlmSettings(@Request() req: { user: RequestUser }) {
    return this.llmService.removeApiKey(req.user.id);
  }
}
