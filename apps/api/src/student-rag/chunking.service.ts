/**
 * Stage 02 — Student RAG ChunkingService is now a thin compatibility
 * shim that delegates to the unified `SharedChunkingService` in
 * `apps/api/src/rag/shared/chunking.service.ts`.
 *
 * Reason: the teacher corpus (`document_chunks`) previously used a crude
 * fixed-window/paragraph splitter while the student corpus
 * (`student_rag_chunks`) used this context-aware splitter. Stage 02 of
 * the RAG upgrade unifies both onto the single shared module. The old
 * student-side implementation lives in the shared module now; this file
 * keeps the original `ChunkingService.chunk(text, options, fileType)`
 * call shape so `StudentRagService.processDocument:277` keeps working
 * without a wide refactor of the wrapper.
 *
 * Old exports preserved (`TextChunk`, `ChunkOptions`) so any external
 * consumer of those types compiles. The internal `MIN_CHUNK_SIZE` /
 * `CHARS_PER_TOKEN` constants moved into the shared module.
 */

import { Injectable } from '@nestjs/common';
import { StudentFileType } from '@prisma/client';
import {
  SharedChunkingService,
  type ChunkStrategy,
  type SharedChunk,
} from '../rag/shared/chunking.service';

export interface ChunkOptions {
  chunkSize: number; // default 512 tokens (approx 2000 chars)
  chunkOverlap: number; // default 100 tokens (approx 400 chars)
}

export interface TextChunk {
  content: string;
  chunkIndex: number;
  pageNumber?: number;
  metadata: {
    heading?: string;
    section?: string;
    codeLanguage?: string;
    isHeader?: boolean;
    charStart: number;
    charEnd: number;
  };
}

@Injectable()
export class ChunkingService {
  constructor(private readonly shared: SharedChunkingService) {}

  /**
   * Legacy entry point preserved for `StudentRagService.processDocument`.
   * Translates `StudentFileType` → shared `ChunkStrategy` enum and
   * forwards. Behaviour-equivalent to the pre-Stage-02 implementation
   * (recursive structural split, MIN_CHUNK_SIZE=50, surrogate strip).
   */
  chunk(text: string, options: ChunkOptions, fileType: StudentFileType): TextChunk[] {
    const strategy: ChunkStrategy = this.resolveStrategy(fileType);
    const chunks: SharedChunk[] = this.shared.chunkDocument(text, {
      strategy,
      maxTokens: options.chunkSize,
      overlapTokens: options.chunkOverlap,
    });
    // Shape passthrough — `SharedChunk` is structurally identical to
    // `TextChunk` so no field translation needed.
    return chunks;
  }

  private resolveStrategy(fileType: StudentFileType): ChunkStrategy {
    switch (fileType) {
      case 'MD':
        return 'markdown';
      case 'CODE':
        return 'code';
      case 'PDF':
      case 'DOCX':
      case 'DOC':
      case 'TXT':
      case 'IMAGE_PNG':
      case 'IMAGE_JPG':
      case 'IMAGE_WEBP':
      default:
        return 'paragraph';
    }
  }
}
