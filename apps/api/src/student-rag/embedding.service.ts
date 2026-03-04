import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

const EMBEDDING_DIMENSION = 1536;
const OPENAI_BATCH_SIZE = 100;

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  async embed(texts: string[], apiKey: string, provider: string): Promise<number[][]> {
    if (texts.length === 0) return [];

    if (provider === 'openai') {
      return this.embedOpenAI(texts, apiKey);
    }

    if (provider === 'gemini') {
      return this.embedGemini(texts, apiKey);
    }

    // Fallback: deterministic pseudo-embedding
    return texts.map((text) => this.generateFallbackEmbedding(text));
  }

  async embedOne(text: string, apiKey: string, provider: string): Promise<number[]> {
    const results = await this.embed([text], apiKey, provider);
    return results[0]!;
  }

  // ─── OpenAI Embeddings ──────────────────────────────────

  private async embedOpenAI(texts: string[], apiKey: string): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    // Batch up to OPENAI_BATCH_SIZE texts per request
    for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
      const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);

      try {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'text-embedding-ada-002',
            input: batch,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          this.logger.error(`OpenAI Embeddings API error: ${response.status} ${errorText}`);
          // Fall back for this batch
          allEmbeddings.push(...batch.map((t) => this.generateFallbackEmbedding(t)));
          continue;
        }

        const data = (await response.json()) as {
          data?: Array<{ embedding: number[]; index: number }>;
        };

        if (data.data) {
          // Sort by index to maintain order
          const sorted = data.data.sort((a, b) => a.index - b.index);
          allEmbeddings.push(...sorted.map((d) => d.embedding));
        } else {
          allEmbeddings.push(...batch.map((t) => this.generateFallbackEmbedding(t)));
        }
      } catch (error) {
        this.logger.error('OpenAI embedding request failed', error);
        allEmbeddings.push(...batch.map((t) => this.generateFallbackEmbedding(t)));
      }
    }

    return allEmbeddings;
  }

  // ─── Gemini Embeddings ──────────────────────────────────

  private async embedGemini(texts: string[], apiKey: string): Promise<number[][]> {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${apiKey}`;

      const requests = texts.map((text) => ({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] },
      }));

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Gemini Embeddings API error: ${response.status} ${errorText}`);
        return texts.map((t) => this.generateFallbackEmbedding(t));
      }

      const data = (await response.json()) as {
        embeddings?: Array<{ values: number[] }>;
      };

      if (data.embeddings) {
        return data.embeddings.map((e) => e.values);
      }

      return texts.map((t) => this.generateFallbackEmbedding(t));
    } catch (error) {
      this.logger.error('Gemini embedding request failed', error);
      return texts.map((t) => this.generateFallbackEmbedding(t));
    }
  }

  // ─── Fallback Pseudo-Embedding ──────────────────────────

  /**
   * Generate a deterministic pseudo-embedding using a hashing approach.
   * This won't be semantically meaningful but allows the system to function
   * without an API key.
   */
  private generateFallbackEmbedding(text: string): number[] {
    const embedding = new Float64Array(EMBEDDING_DIMENSION);

    // Tokenize into words
    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1);

    // Hash each word and distribute across embedding dimensions
    for (const word of words) {
      const hash = crypto.createHash('sha256').update(word).digest();
      for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
        const byteIndex = i % hash.length;
        // Use the byte value to contribute to this dimension
        embedding[i]! += (hash[byteIndex]! - 128) / 128;
      }
    }

    // Normalize to unit vector
    let magnitude = 0;
    for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
      magnitude += embedding[i]! * embedding[i]!;
    }
    magnitude = Math.sqrt(magnitude);

    if (magnitude > 0) {
      for (let i = 0; i < EMBEDDING_DIMENSION; i++) {
        embedding[i]! /= magnitude;
      }
    }

    return Array.from(embedding);
  }
}
