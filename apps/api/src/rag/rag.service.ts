import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
// pdf-parse is optionally loaded at runtime to avoid hard crashes if not installed
let PDFParseClass: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  PDFParseClass = require('pdf-parse').PDFParse;
} catch {
  // pdf-parse not available; will fall back to raw text extraction
}

export interface ChunkWithScore {
  id: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  tokenCount: number;
  similarityScore: number;
  rerankerScore: number;
}

export interface RagQueryResult {
  query: string;
  retrievedChunks: ChunkWithScore[];
  finalChunks: ChunkWithScore[];
  answer: string | null;
  citations: Array<{
    chunkId: string;
    documentTitle: string;
    pageNumber: number | null;
    quote: string;
  }>;
  strictSourceValid: boolean;
  notEnoughInfo: boolean;
  debugInfo: {
    totalChunksSearched: number;
    retrievalTimeMs: number;
    rerankTimeMs: number;
    generationTimeMs: number;
  };
}

export interface DocumentProgress {
  status: string;
  pct: number;
  error?: string;
}

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  /** In-memory progress tracking for document chunking */
  readonly progress = new Map<string, DocumentProgress>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly blobService: BlobService,
  ) {}

  // ─── Document Management ────────────────────────────────

  async uploadDocument(
    courseId: string,
    userId: string,
    file: { filename: string; mimeType: string; sizeBytes: number; buffer: Buffer },
  ) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException(`Course ${courseId} not found`);
    if (course.teacherId !== userId) {
      throw new ForbiddenException('Only the course teacher can upload documents');
    }

    const blobKey = `rag/${courseId}/${Date.now()}-${file.filename}`;
    await this.blobService.put({
      key: blobKey,
      body: file.buffer,
      contentType: file.mimeType,
    });

    const doc = await this.prisma.sourceDocument.create({
      data: {
        courseId,
        uploadedById: userId,
        title: file.filename.replace(/\.[^.]+$/, ''),
        filename: file.filename,
        blobKey,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
      },
    });

    // Trigger chunking asynchronously (progress tracked in-memory)
    this.chunkDocument(doc.id).catch((err) => {
      this.logger.error(`Failed to chunk document ${doc.id}`, err);
    });

    return doc;
  }

  async listDocuments(courseId: string) {
    return this.prisma.sourceDocument.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        pageCount: true,
        chunkCount: true,
        chunkingStrategy: true,
        indexedAt: true,
        createdAt: true,
        uploadedBy: { select: { id: true, name: true } },
      },
    });
  }

  async deleteDocument(documentId: string, userId: string) {
    const doc = await this.prisma.sourceDocument.findUnique({
      where: { id: documentId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    if (doc.course.teacherId !== userId) {
      throw new ForbiddenException('Only the course teacher can delete documents');
    }

    await this.blobService.delete(doc.blobKey);
    await this.prisma.sourceDocument.delete({ where: { id: documentId } });
    return { deleted: true };
  }

  // ─── Chunking ───────────────────────────────────────────

  private setProgress(documentId: string, status: string, pct: number, error?: string) {
    this.progress.set(documentId, { status, pct, error });
  }

  async chunkDocument(documentId: string) {
    const doc = await this.prisma.sourceDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    this.setProgress(documentId, 'Starting', 5);

    // Clear previous state
    await this.prisma.sourceDocument.update({
      where: { id: documentId },
      data: { indexedAt: null },
    });

    try {
      // Step 1: Download (10%)
      this.setProgress(documentId, 'Downloading file', 10);
      this.logger.log(`Downloading blob for document ${documentId}: ${doc.blobKey}`);
      const { body } = await this.blobService.get(doc.blobKey);
      this.logger.log(`Downloaded ${body.length} bytes, mimeType=${doc.mimeType}`);

      // Step 2: Extract text (30-50%)
      this.setProgress(documentId, 'Extracting text', 30);
      const { text, pageCount } = await this.extractText(body, doc.mimeType);
      this.logger.log(`Extracted text: ${text.length} chars, ${pageCount} pages`);
      this.setProgress(documentId, 'Text extracted', 50);

      if (!text || text.trim().length === 0) {
        throw new Error('No text could be extracted from the document');
      }

      // Step 3: Chunk (60%)
      this.setProgress(documentId, 'Splitting into chunks', 60);
      const chunks = this.splitIntoChunks(text, doc.chunkingStrategy);
      this.logger.log(`Split into ${chunks.length} chunks`);

      // Step 4: Save chunks (75%)
      this.setProgress(documentId, `Saving ${chunks.length} chunks`, 75);
      await this.prisma.documentChunk.deleteMany({ where: { documentId } });

      const chunkRecords = chunks.map((chunk, index) => ({
        documentId,
        chunkIndex: index,
        content: chunk.content,
        pageNumber: chunk.pageNumber,
        tokenCount: this.estimateTokenCount(chunk.content),
      }));

      await this.prisma.documentChunk.createMany({ data: chunkRecords });
      this.setProgress(documentId, 'Finalising', 90);

      // Step 5: Done (100%)
      await this.prisma.sourceDocument.update({
        where: { id: documentId },
        data: {
          chunkCount: chunks.length,
          pageCount: pageCount,
          indexedAt: new Date(),
        },
      });

      this.setProgress(documentId, 'Done', 100);
      this.logger.log(`Chunked document ${documentId} into ${chunks.length} chunks`);
      return { chunkCount: chunks.length };
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error during chunking';
      this.logger.error(`Chunking failed for document ${documentId}: ${errorMsg}`, err?.stack);
      this.setProgress(documentId, 'Failed', 0, errorMsg);
      throw err;
    }
  }

  private async extractText(
    buffer: Buffer,
    mimeType: string,
  ): Promise<{ text: string; pageCount: number | null }> {
    if (mimeType === 'text/plain' || mimeType === 'text/markdown') {
      return { text: buffer.toString('utf-8'), pageCount: null };
    }

    if (mimeType === 'application/pdf') {
      if (!PDFParseClass) {
        this.logger.warn('pdf-parse not installed. Run: cd apps/api && pnpm add pdf-parse');
        // Attempt basic text extraction from PDF bytes
        const rawText = buffer.toString('utf-8');
        // Try to extract readable text between stream/endstream markers
        const streamTexts: string[] = [];
        const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
        let match: RegExpExecArray | null;
        while ((match = streamRegex.exec(rawText)) !== null) {
          const content = match[1] || '';
          // Extract text from PDF text operators: (text) Tj or [(...)] TJ
          const textOps = content.match(/\(([^)]+)\)\s*T[jJ]/g);
          if (textOps) {
            for (const op of textOps) {
              const textMatch = op.match(/\(([^)]+)\)/);
              if (textMatch?.[1]) streamTexts.push(textMatch[1]);
            }
          }
        }
        if (streamTexts.length > 0) {
          const text = streamTexts.join(' ');
          this.logger.log(`Extracted ${text.length} chars from PDF using basic parser`);
          return { text, pageCount: null };
        }
        throw new Error('pdf-parse package not installed. Run: cd apps/api && pnpm add pdf-parse');
      }

      try {
        const pdfData = new Uint8Array(buffer);
        const pdf = new PDFParseClass({ data: pdfData });
        const textResult = await pdf.getText();
        const pageCount = textResult.total || null;
        const text = textResult.text;
        await pdf.destroy();
        this.logger.log(`Extracted ${text.length} chars from PDF (${pageCount} pages)`);
        return { text, pageCount };
      } catch (err) {
        this.logger.error('PDF parsing failed', err);
        throw new Error(`PDF text extraction failed: ${(err as Error)?.message || 'Unknown error'}`);
      }
    }

    // Fallback for other formats
    return { text: buffer.toString('utf-8'), pageCount: null };
  }

  private splitIntoChunks(
    text: string,
    strategy: string,
  ): Array<{ content: string; pageNumber: number | null }> {
    const maxChunkSize = 1000; // characters
    const overlap = 200;

    if (strategy === 'PARAGRAPH') {
      return this.splitByParagraph(text);
    }

    // FIXED_SIZE or SEMANTIC (fallback to fixed size for now)
    return this.splitByFixedSize(text, maxChunkSize, overlap);
  }

  private splitByParagraph(text: string): Array<{ content: string; pageNumber: number | null }> {
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
    const chunks: Array<{ content: string; pageNumber: number | null }> = [];
    let currentChunk = '';
    let pageNum = 1;

    for (const para of paragraphs) {
      // Detect page breaks (common in extracted PDFs)
      const pageBreaks = (para.match(/\f/g) || []).length;
      if (pageBreaks > 0) pageNum += pageBreaks;

      if (currentChunk.length + para.length > 1500 && currentChunk.length > 0) {
        chunks.push({ content: currentChunk.trim(), pageNumber: pageNum });
        currentChunk = '';
      }
      currentChunk += para + '\n\n';
    }

    if (currentChunk.trim().length > 0) {
      chunks.push({ content: currentChunk.trim(), pageNumber: pageNum });
    }

    return chunks.length > 0 ? chunks : [{ content: text.trim(), pageNumber: 1 }];
  }

  private splitByFixedSize(
    text: string,
    maxSize: number,
    overlap: number,
  ): Array<{ content: string; pageNumber: number | null }> {
    const chunks: Array<{ content: string; pageNumber: number | null }> = [];
    let start = 0;
    let pageNum = 1;

    while (start < text.length) {
      const end = Math.min(start + maxSize, text.length);
      const chunk = text.slice(start, end);
      const pageBreaks = (chunk.match(/\f/g) || []).length;
      if (pageBreaks > 0) pageNum += pageBreaks;

      chunks.push({ content: chunk.trim(), pageNumber: pageNum });
      start = end - overlap;
      if (start >= text.length) break;
    }

    return chunks;
  }

  private estimateTokenCount(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  // ─── Retrieval ──────────────────────────────────────────

  async queryChunks(courseId: string, query: string, topK: number = 10): Promise<ChunkWithScore[]> {
    const startTime = Date.now();

    // Get all chunks for this course's documents
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        document: { courseId },
      },
      include: {
        document: { select: { id: true, title: true } },
      },
    });

    if (chunks.length === 0) return [];

    // Score chunks using TF-IDF-like keyword matching
    // (In production, use vector similarity with embeddings)
    const scored: ChunkWithScore[] = chunks.map((chunk: any) => ({
      id: chunk.id,
      documentId: chunk.document.id,
      documentTitle: chunk.document.title,
      chunkIndex: chunk.chunkIndex,
      content: chunk.content,
      pageNumber: chunk.pageNumber,
      tokenCount: chunk.tokenCount,
      similarityScore: this.computeKeywordScore(query, chunk.content),
      rerankerScore: 0,
    }));

    // Sort by similarity and take topK
    scored.sort((a, b) => b.similarityScore - a.similarityScore);
    const topChunks = scored.slice(0, topK);

    // Apply reranker scoring (cross-encoder simulation)
    for (const chunk of topChunks) {
      chunk.rerankerScore = this.computeRerankerScore(query, chunk.content);
    }

    // Re-sort by reranker score
    topChunks.sort((a, b) => b.rerankerScore - a.rerankerScore);

    const elapsed = Date.now() - startTime;
    this.logger.debug(
      `RAG query for course ${courseId} took ${elapsed}ms, found ${topChunks.length} chunks`,
    );

    return topChunks;
  }

  private computeKeywordScore(query: string, content: string): number {
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const contentLower = content.toLowerCase();
    if (queryTerms.length === 0) return 0;

    let matchCount = 0;
    for (const term of queryTerms) {
      const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const matches = contentLower.match(regex);
      if (matches) matchCount += matches.length;
    }

    // Normalize by query terms and content length
    const termCoverage =
      queryTerms.filter((t) => contentLower.includes(t)).length / queryTerms.length;
    const density = matchCount / (content.length / 100);

    return termCoverage * 0.6 + Math.min(density, 1) * 0.4;
  }

  private computeRerankerScore(query: string, content: string): number {
    // Simulated cross-encoder reranker
    // Combines keyword overlap, position bias, and length normalization
    const keywordScore = this.computeKeywordScore(query, content);

    // Bonus for exact phrase matches
    const queryLower = query.toLowerCase();
    const contentLower = content.toLowerCase();
    const phraseBonus = contentLower.includes(queryLower) ? 0.3 : 0;

    // Length penalty for very short or very long chunks
    const idealLength = 500;
    const lengthRatio = Math.min(content.length, idealLength * 2) / idealLength;
    const lengthScore = lengthRatio > 1 ? 1 / lengthRatio : lengthRatio;

    return keywordScore * 0.5 + phraseBonus + lengthScore * 0.2;
  }

  // ─── Citation Validation (Strict-Source Mode) ───────────

  validateCitations(
    contentMdx: string,
    citations: Array<{
      chunkId: string;
      documentTitle: string;
      pageNumber: number | null;
      quote: string;
    }>,
    chunks: ChunkWithScore[],
  ): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Split content into paragraphs
    const paragraphs = contentMdx.split(/\n\s*\n/).filter((p) => p.trim().length > 20);

    // Check each paragraph has at least one citation reference
    const citationPattern = /\[(\d+)\]/g;
    for (let i = 0; i < paragraphs.length; i++) {
      const matches = paragraphs[i]!.match(citationPattern);
      if (!matches) {
        issues.push(`Paragraph ${i + 1} has no citation references`);
      }
    }

    // Verify each citation maps to a real chunk
    for (const citation of citations) {
      const chunk = chunks.find((c) => c.id === citation.chunkId);
      if (!chunk) {
        issues.push(
          `Citation references chunk ${citation.chunkId} which was not in retrieved chunks`,
        );
      } else if (citation.quote) {
        // Verify the quote actually appears in the chunk
        if (!chunk.content.toLowerCase().includes(citation.quote.toLowerCase().slice(0, 50))) {
          issues.push(`Citation quote from "${citation.documentTitle}" not found in source chunk`);
        }
      }
    }

    return { valid: issues.length === 0, issues };
  }
}
