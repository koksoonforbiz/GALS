import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import { LlmService } from '../rag/llm.service';
import { FileParserService } from './file-parser.service';
import { ChunkingService } from './chunking.service';
import { EmbeddingService } from './embedding.service';
import { StudentFileType, Prisma } from '@prisma/client';
import { DialogueCourseSettingsSchema } from '@ats/shared';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const MIME_TO_FILE_TYPE: Record<string, StudentFileType> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'image/png': 'IMAGE_PNG',
  'image/jpeg': 'IMAGE_JPG',
  'image/webp': 'IMAGE_WEBP',
};

const EMBEDDING_BATCH_SIZE = 50;

@Injectable()
export class StudentRagService {
  private readonly logger = new Logger(StudentRagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blobService: BlobService,
    private readonly llmService: LlmService,
    private readonly fileParser: FileParserService,
    private readonly chunkingService: ChunkingService,
    private readonly embeddingService: EmbeddingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Upload & create document record ────────────────────

  async uploadDocument(
    enrollmentId: string,
    studentId: string,
    courseId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    // Determine file type
    const fileType = this.resolveFileType(file.mimetype, file.originalname);

    // Store file to MinIO
    const blobKey = `student-docs/${studentId}/${courseId}/${Date.now()}-${file.originalname}`;
    await this.blobService.put({
      key: blobKey,
      body: file.buffer,
      contentType: file.mimetype,
    });

    // Create DB record
    const document = await this.prisma.studentSourceDocument.create({
      data: {
        enrollmentId,
        studentId,
        courseId,
        fileName: file.originalname,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size,
        blobKey,
        fileType,
        processingStatus: 'PENDING',
      },
    });

    // Trigger async processing via NestJS EventEmitter
    this.eventEmitter.emit('student-document.uploaded', { documentId: document.id });

    return document;
  }

  // ─── Async document processing ──────────────────────────

  @OnEvent('student-document.uploaded')
  async handleDocumentUploaded(payload: { documentId: string }) {
    await this.processDocument(payload.documentId);
  }

  async processDocument(documentId: string): Promise<void> {
    const document = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
      include: {
        course: {
          select: {
            id: true,
            teacherId: true,
            dblSettings: true,
          },
        },
      },
    });

    if (!document) {
      this.logger.error(`Document ${documentId} not found for processing`);
      return;
    }

    try {
      // 1. Set processingStatus = PROCESSING
      await this.prisma.studentSourceDocument.update({
        where: { id: documentId },
        data: { processingStatus: 'PROCESSING' },
      });

      // 2. Fetch blob from MinIO
      const blob = await this.blobService.get(document.blobKey);

      // 3. Parse file
      let parsed;
      if (IMAGE_MIME_TYPES.has(document.mimeType)) {
        // Use LLM vision for images
        parsed = await this.fileParser.parseImageWithVision(
          blob.body,
          document.mimeType,
          document.fileName,
          document.course.teacherId,
          document.courseId,
        );
      } else {
        parsed = await this.fileParser.parse(blob.body, document.mimeType, document.fileName);
      }

      if (!parsed.text || parsed.text.trim().length < 10) {
        throw new Error('Parsed document text is empty or too short');
      }

      // 4. Parse course settings for chunk options
      const dblSettings = this.parseDblSettings(document.course.dblSettings);
      const chunkOptions = {
        chunkSize: dblSettings.chunkSize,
        chunkOverlap: dblSettings.chunkOverlap,
      };

      // 5. Chunk the text
      const textChunks = this.chunkingService.chunk(parsed.text, chunkOptions, document.fileType);

      if (textChunks.length === 0) {
        throw new Error('No chunks generated from document');
      }

      // 6. Delete existing chunks for this document (for re-processing)
      await this.prisma.studentRagChunk.deleteMany({
        where: { documentId },
      });

      // 7. Batch-create StudentRagChunk records (without embeddings first)
      // Strip lone surrogates that can appear in extracted PDF text and break JSON serialization
      const stripSurrogates = (s: string) => s.replace(/[\uD800-\uDFFF]/g, '\uFFFD');

      await this.prisma.studentRagChunk.createMany({
        data: textChunks.map((chunk) => ({
          documentId,
          studentId: document.studentId,
          courseId: document.courseId,
          content: stripSurrogates(chunk.content),
          chunkIndex: chunk.chunkIndex,
          pageNumber: chunk.pageNumber ?? null,
          metadata: chunk.metadata as Prisma.InputJsonValue,
        })),
      });

      // 8. Fetch created chunks to get their IDs
      const createdChunks = await this.prisma.studentRagChunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
        select: { id: true, content: true },
      });

      // 9. Get teacher's LLM credentials
      const { apiKey, provider } = await this.getTeacherCredentials(
        document.course.teacherId,
        dblSettings,
      );

      // 10. Generate embeddings in batches and update
      for (let i = 0; i < createdChunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batch = createdChunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        const texts = batch.map((c) => c.content);
        const embeddings = await this.embeddingService.embed(texts, apiKey, provider);

        // Update each chunk's embedding as JSON (JSONB column)
        await Promise.all(
          batch.map((chunk, idx) =>
            this.prisma.studentRagChunk.update({
              where: { id: chunk.id },
              data: { embedding: embeddings[idx] as unknown as Prisma.InputJsonValue },
            }),
          ),
        );
      }

      // 11. Set processingStatus = COMPLETED
      await this.prisma.studentSourceDocument.update({
        where: { id: documentId },
        data: {
          processingStatus: 'COMPLETED',
          processingError: null,
        },
      });

      // 12. Publish generate_source_guide event
      this.eventEmitter.emit('student-document.processed', { documentId });

      this.logger.log(`Document ${documentId} processed: ${createdChunks.length} chunks created`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown processing error';
      this.logger.error(`Document processing failed for ${documentId}: ${errorMessage}`, error);

      await this.prisma.studentSourceDocument.update({
        where: { id: documentId },
        data: {
          processingStatus: 'FAILED',
          processingError: errorMessage,
        },
      });
    }
  }

  // ─── Toggle source active/inactive ─────────────────────

  async toggleSource(documentId: string, studentId: string, isActive: boolean) {
    const doc = await this.verifyOwnership(documentId, studentId);
    return this.prisma.studentSourceDocument.update({
      where: { id: doc.id },
      data: { isActive },
    });
  }

  // ─── Delete a source and all its chunks ─────────────────

  async deleteDocument(documentId: string, studentId: string) {
    const doc = await this.verifyOwnership(documentId, studentId);

    // Delete blob from storage
    try {
      await this.blobService.delete(doc.blobKey);
    } catch (error) {
      this.logger.warn(`Failed to delete blob for document ${documentId}`, error);
    }

    // Cascade deletes chunks and guide via Prisma relations
    await this.prisma.studentSourceDocument.delete({
      where: { id: documentId },
    });

    return { deleted: true };
  }

  // ─── List all sources for a student in a course ─────────

  async listSources(enrollmentId: string) {
    return this.prisma.studentSourceDocument.findMany({
      where: { enrollmentId },
      orderBy: { createdAt: 'desc' },
      include: {
        autoGuide: true,
        _count: { select: { chunks: true } },
      },
    });
  }

  // ─── Get a single source with its guide ─────────────────

  async getSource(documentId: string, studentId: string) {
    const doc = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
      include: {
        autoGuide: true,
        _count: { select: { chunks: true } },
      },
    });

    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.studentId !== studentId) {
      throw new ForbiddenException('You can only view your own documents');
    }

    return doc;
  }

  // ─── Helpers ────────────────────────────────────────────

  private resolveFileType(mimeType: string, fileName: string): StudentFileType {
    const fromMime = MIME_TO_FILE_TYPE[mimeType];
    if (fromMime) return fromMime;

    // Check file extension for code files
    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    const codeExtensions = new Set([
      '.js',
      '.jsx',
      '.ts',
      '.tsx',
      '.py',
      '.java',
      '.cpp',
      '.c',
      '.cs',
      '.go',
      '.rb',
      '.php',
      '.rs',
      '.swift',
      '.kt',
      '.scala',
      '.r',
      '.sql',
      '.sh',
      '.bash',
      '.html',
      '.css',
      '.scss',
      '.yaml',
      '.yml',
      '.json',
      '.xml',
    ]);

    if (codeExtensions.has(ext)) return 'CODE';

    // Default to TXT
    return 'TXT';
  }

  private parseDblSettings(raw: unknown) {
    try {
      const parsed = DialogueCourseSettingsSchema.parse(raw || {});
      return parsed;
    } catch {
      // Return defaults
      return DialogueCourseSettingsSchema.parse({});
    }
  }

  private async getTeacherCredentials(
    teacherId: string,
    dblSettings: { llmProvider: string },
  ): Promise<{ apiKey: string; provider: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { encryptedApiKey: true, llmProvider: true },
    });

    // If teacher has API key, use their credentials
    if (user?.encryptedApiKey) {
      return {
        apiKey: user.encryptedApiKey, // Will be decrypted by LlmService when needed
        provider: user.llmProvider || dblSettings.llmProvider || 'fallback',
      };
    }

    // No API key — use fallback
    return { apiKey: '', provider: 'fallback' };
  }

  private async verifyOwnership(documentId: string, studentId: string) {
    const doc = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
    });

    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.studentId !== studentId) {
      throw new ForbiddenException('You can only modify your own documents');
    }

    return doc;
  }
}
