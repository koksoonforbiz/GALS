import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { Prisma } from '@prisma/client';

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  pageNumber: number | null;
  score: number;
  metadata: Record<string, unknown>;
}

// Common English stopwords to filter from sparse search
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'shall',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'at',
  'by',
  'from',
  'as',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'between',
  'out',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
  'just',
  'because',
  'but',
  'and',
  'or',
  'if',
  'while',
  'about',
  'up',
  'it',
  'its',
  'this',
  'that',
  'what',
  'which',
  'who',
  'whom',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'him',
  'his',
  'she',
  'her',
  'they',
  'them',
  'their',
]);

const RRF_K = 60;

@Injectable()
export class StudentRagRetrievalService {
  private readonly logger = new Logger(StudentRagRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  async retrieve(
    query: string,
    studentId: string,
    courseId: string,
    activeSourceIds: string[],
    topK: number,
    apiKey: string,
    provider: string,
  ): Promise<RetrievedChunk[]> {
    if (activeSourceIds.length === 0) return [];

    // Run dense and sparse retrieval in parallel
    const [denseResults, sparseResults] = await Promise.all([
      this.denseRetrieval(query, studentId, courseId, activeSourceIds, topK * 2, apiKey, provider),
      this.sparseRetrieval(query, studentId, courseId, activeSourceIds, topK),
    ]);

    // Merge with Reciprocal Rank Fusion
    const merged = this.reciprocalRankFusion(denseResults, sparseResults, topK);

    // Fetch document names for the results
    const docIds = [...new Set(merged.map((r) => r.documentId))];
    const docs = await this.prisma.studentSourceDocument.findMany({
      where: { id: { in: docIds } },
      select: { id: true, originalName: true },
    });
    const docNameMap = new Map(docs.map((d) => [d.id, d.originalName]));

    // Deduplicate by content similarity
    const deduped = this.deduplicateChunks(merged);

    return deduped.slice(0, topK).map((r) => ({
      ...r,
      documentName: docNameMap.get(r.documentId) || 'Unknown',
    }));
  }

  // ─── Dense Retrieval (Embedding Similarity) ─────────────

  private async denseRetrieval(
    query: string,
    studentId: string,
    courseId: string,
    activeSourceIds: string[],
    limit: number,
    apiKey: string,
    provider: string,
  ): Promise<RetrievedChunk[]> {
    try {
      const queryEmbedding = await this.embeddingService.embedOne(query, apiKey, provider);

      // Since embeddings are stored as JSONB (not pgvector), we compute similarity in JS
      const chunks = await this.prisma.studentRagChunk.findMany({
        where: {
          studentId,
          courseId,
          documentId: { in: activeSourceIds },
          embedding: { not: Prisma.JsonNull },
        },
        select: {
          id: true,
          documentId: true,
          content: true,
          pageNumber: true,
          metadata: true,
          embedding: true,
        },
      });

      // Compute cosine similarity for each chunk
      const scored = chunks
        .map((chunk) => {
          const chunkEmbedding = chunk.embedding as number[];
          if (!Array.isArray(chunkEmbedding) || chunkEmbedding.length === 0) {
            return null;
          }
          const similarity = this.cosineSimilarity(queryEmbedding, chunkEmbedding);
          return {
            chunkId: chunk.id,
            documentId: chunk.documentId,
            documentName: '',
            content: chunk.content,
            pageNumber: chunk.pageNumber,
            score: similarity,
            metadata: (chunk.metadata as Record<string, unknown>) || {},
          };
        })
        .filter((r): r is RetrievedChunk => r !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      return scored;
    } catch (error) {
      this.logger.error('Dense retrieval failed', error);
      return [];
    }
  }

  // ─── Sparse Retrieval (BM25-like keyword search) ────────

  private async sparseRetrieval(
    query: string,
    studentId: string,
    courseId: string,
    activeSourceIds: string[],
    limit: number,
  ): Promise<RetrievedChunk[]> {
    try {
      // Extract key terms from query
      const terms = query
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t));

      if (terms.length === 0) return [];

      // Build ILIKE conditions for each term
      const chunks = await this.prisma.studentRagChunk.findMany({
        where: {
          studentId,
          courseId,
          documentId: { in: activeSourceIds },
          OR: terms.map((term) => ({
            content: { contains: term, mode: 'insensitive' as const },
          })),
        },
        select: {
          id: true,
          documentId: true,
          content: true,
          pageNumber: true,
          metadata: true,
        },
        take: limit * 3, // Fetch more for ranking
      });

      // Score by term frequency (simple BM25-like scoring)
      const scored = chunks.map((chunk) => {
        const contentLower = chunk.content.toLowerCase();
        let matchCount = 0;
        for (const term of terms) {
          const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          const matches = contentLower.match(regex);
          matchCount += matches ? matches.length : 0;
        }
        // Normalize by content length (BM25-like)
        const score =
          matchCount / (matchCount + 1.5 * (1 - 0.75 + (0.75 * chunk.content.length) / 2000));

        return {
          chunkId: chunk.id,
          documentId: chunk.documentId,
          documentName: '',
          content: chunk.content,
          pageNumber: chunk.pageNumber,
          score,
          metadata: (chunk.metadata as Record<string, unknown>) || {},
        };
      });

      return scored.sort((a, b) => b.score - a.score).slice(0, limit);
    } catch (error) {
      this.logger.error('Sparse retrieval failed', error);
      return [];
    }
  }

  // ─── Reciprocal Rank Fusion ─────────────────────────────

  private reciprocalRankFusion(
    denseResults: RetrievedChunk[],
    sparseResults: RetrievedChunk[],
    topK: number,
  ): RetrievedChunk[] {
    const scoreMap = new Map<string, { chunk: RetrievedChunk; rrfScore: number }>();

    // Score dense results
    denseResults.forEach((chunk, rank) => {
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = scoreMap.get(chunk.chunkId);
      if (existing) {
        existing.rrfScore += rrfScore;
      } else {
        scoreMap.set(chunk.chunkId, { chunk, rrfScore });
      }
    });

    // Score sparse results
    sparseResults.forEach((chunk, rank) => {
      const rrfScore = 1 / (RRF_K + rank + 1);
      const existing = scoreMap.get(chunk.chunkId);
      if (existing) {
        existing.rrfScore += rrfScore;
      } else {
        scoreMap.set(chunk.chunkId, { chunk, rrfScore });
      }
    });

    // Sort by RRF score and return
    return Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .slice(0, topK * 2)
      .map(({ chunk, rrfScore }) => ({ ...chunk, score: rrfScore }));
  }

  // ─── Deduplication ──────────────────────────────────────

  private deduplicateChunks(chunks: RetrievedChunk[]): RetrievedChunk[] {
    const result: RetrievedChunk[] = [];

    for (const chunk of chunks) {
      const isDuplicate = result.some(
        (existing) => this.contentOverlap(existing.content, chunk.content) > 0.9,
      );
      if (!isDuplicate) {
        result.push(chunk);
      }
    }

    return result;
  }

  private contentOverlap(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length === 0 || b.length === 0) return 0;

    // Use character-level Jaccard similarity for efficiency
    const setA = new Set(a.toLowerCase().split(/\s+/));
    const setB = new Set(b.toLowerCase().split(/\s+/));

    let intersection = 0;
    for (const word of setA) {
      if (setB.has(word)) intersection++;
    }

    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }

  // ─── Cosine Similarity ──────────────────────────────────

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}
