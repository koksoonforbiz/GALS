import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface SimilarityPair {
  kcA: { id: string; name: string };
  kcB: { id: string; name: string };
  similarity: number;
}

interface KcHealthIndicator {
  id: string;
  name: string;
  status: string;
  pageCount: number;
  hasDescription: boolean;
  confidenceLevel: string;
  duplicateCount: number;
  coverageStatus: 'uncovered' | 'low' | 'moderate' | 'high';
  similarKcs: Array<{ id: string; name: string; similarity: number }>;
}

@Injectable()
export class KcNormalizationService {
  private readonly logger = new Logger(KcNormalizationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find similar KC pairs within a course using name-based fuzzy matching.
   * Returns pairs with similarity >= threshold.
   */
  async findSimilarPairs(courseId: string, threshold = 0.6): Promise<SimilarityPair[]> {
    const kcs = await this.prisma.proposedKC.findMany({
      where: { courseId, status: { not: 'ARCHIVED' } },
      select: { id: true, name: true },
    });

    const pairs: SimilarityPair[] = [];

    for (let i = 0; i < kcs.length; i++) {
      for (let j = i + 1; j < kcs.length; j++) {
        const a = kcs[i]!;
        const b = kcs[j]!;
        const sim = this.computeSimilarity(a.name, b.name);
        if (sim >= threshold) {
          pairs.push({
            kcA: { id: a.id, name: a.name },
            kcB: { id: b.id, name: b.name },
            similarity: Math.round(sim * 100) / 100,
          });
        }
      }
    }

    return pairs.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Compute health indicators for all KCs in a course.
   */
  async getHealthIndicators(courseId: string): Promise<KcHealthIndicator[]> {
    const kcs = await this.prisma.proposedKC.findMany({
      where: { courseId },
      select: {
        id: true,
        name: true,
        description: true,
        status: true,
        confidenceLevel: true,
        pageIds: true,
        duplicates: { select: { id: true } },
      },
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });

    // Pre-compute similarity map for non-archived KCs
    const activeKcs = kcs.filter((k: any) => k.status !== 'ARCHIVED');
    const similarityMap = new Map<
      string,
      Array<{ id: string; name: string; similarity: number }>
    >();

    for (let i = 0; i < activeKcs.length; i++) {
      const a = activeKcs[i]!;
      const similars: Array<{ id: string; name: string; similarity: number }> = [];

      for (let j = 0; j < activeKcs.length; j++) {
        if (i === j) continue;
        const b = activeKcs[j]!;
        const sim = this.computeSimilarity(a.name, b.name);
        if (sim >= 0.5) {
          similars.push({ id: b.id, name: b.name, similarity: Math.round(sim * 100) / 100 });
        }
      }

      similars.sort((a, b) => b.similarity - a.similarity);
      similarityMap.set(a.id, similars.slice(0, 5));
    }

    return kcs.map((kc: any) => {
      const pageCount = kc.pageIds.length;
      let coverageStatus: KcHealthIndicator['coverageStatus'];
      if (pageCount === 0) coverageStatus = 'uncovered';
      else if (pageCount === 1) coverageStatus = 'low';
      else if (pageCount <= 3) coverageStatus = 'moderate';
      else coverageStatus = 'high';

      return {
        id: kc.id,
        name: kc.name,
        status: kc.status,
        pageCount,
        hasDescription: !!kc.description,
        confidenceLevel: kc.confidenceLevel,
        duplicateCount: kc.duplicates.length,
        coverageStatus,
        similarKcs: similarityMap.get(kc.id) || [],
      };
    });
  }

  /**
   * Compute similarity between two KC names using Jaccard similarity
   * on normalized word tokens, plus a substring bonus.
   */
  private computeSimilarity(nameA: string, nameB: string): number {
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 1);

    const wordsA = normalize(nameA);
    const wordsB = normalize(nameB);

    if (wordsA.length === 0 || wordsB.length === 0) return 0;

    const setA = new Set(wordsA);
    const setB = new Set(wordsB);

    const intersection = [...setA].filter((w) => setB.has(w)).length;
    const union = new Set([...setA, ...setB]).size;

    const jaccard = intersection / union;

    // Substring bonus: if one name fully contains the other
    const normA = nameA.toLowerCase().trim();
    const normB = nameB.toLowerCase().trim();
    const substringBonus = normA.includes(normB) || normB.includes(normA) ? 0.2 : 0;

    return Math.min(1, jaccard + substringBonus);
  }
}
