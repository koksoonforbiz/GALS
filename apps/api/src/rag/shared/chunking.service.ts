/**
 * Stage 02 — Unified RAG chunker.
 *
 * Single source of truth for splitting any text document (teacher OR
 * student corpus) into retrieval-sized chunks. Promotes the student-side
 * context-aware splitter (previously living in
 * `apps/api/src/student-rag/chunking.service.ts`) into a corpus-agnostic
 * service so the teacher ingest path can drop its crude fixed-window
 * code (`apps/api/src/rag/rag.service.ts:305-366`, removed in this
 * stage) and BOTH corpora share the same paragraph/heading/sentence-
 * aware behaviour.
 *
 * Defaults (Stage 02 spec):
 *   - recursive structural split
 *   - 512 tokens (~2048 chars at CHARS_PER_TOKEN=4)
 *   - 80–100 token overlap (~320–400 chars)
 *   - MIN_CHUNK_SIZE=50 char minimum (drops noise/junk pages)
 *   - lone-surrogate strip preserved (PDF text extraction sometimes
 *     leaves these in; they break JSON serialization downstream)
 *
 * The student-rag `ChunkingService` is now a thin compatibility shim
 * that forwards into this module; see
 * `apps/api/src/student-rag/chunking.service.ts`. Teacher ingest calls
 * this module directly (`rag.service.ts:chunkDocument`).
 */

import { Injectable } from '@nestjs/common';

// ─── Public types ──────────────────────────────────────────────

/**
 * "Strategy" governs the BOUNDARY heuristic used during the recursive
 * split. The student-side branch was originally keyed on
 * `StudentFileType`; we generalise here so the teacher path (which only
 * knows MIME) and the student path (which knows file type) can both
 * resolve to the same enum.
 */
export type ChunkStrategy = 'markdown' | 'code' | 'paragraph' | 'auto';

export interface ChunkOptions {
  /** Boundary heuristic. `'auto'` picks `'markdown'` for `.md`-ish MIME,
   *  `'code'` for source files, `'paragraph'` otherwise. */
  strategy?: ChunkStrategy;
  /** Target chunk size in TOKENS. ~CHARS_PER_TOKEN-char approximation. */
  maxTokens?: number;
  /** Overlap appended to the head of each chunk from the previous one.
   *  In tokens. */
  overlapTokens?: number;
  /** Optional MIME type used by `strategy: 'auto'` for boundary
   *  resolution. */
  mimeType?: string;
  /** Optional filename — used as a last-resort hint when `mimeType` is
   *  vague (e.g. `application/octet-stream` for `.md`). */
  filename?: string;
}

export interface ChunkMetadata {
  heading?: string;
  section?: string;
  codeLanguage?: string;
  isHeader?: boolean;
  charStart: number;
  charEnd: number;
}

export interface SharedChunk {
  content: string;
  chunkIndex: number;
  pageNumber?: number;
  metadata: ChunkMetadata;
}

// ─── Internal constants ────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_OVERLAP_TOKENS = 100; // ~80-100 per Stage 02 spec
const CHARS_PER_TOKEN = 4; // rough approximation, same as legacy
const MIN_CHUNK_SIZE = 50;

const MARKDOWN_MIME = new Set(['text/markdown', 'text/x-markdown']);
const CODE_MIME_PREFIXES = ['application/javascript', 'application/typescript', 'text/x-'];

// ─── Service ───────────────────────────────────────────────────

@Injectable()
export class SharedChunkingService {
  /**
   * Main entry point. Same signature shape called for by the Stage 02
   * spec:
   *
   *   chunkDocument(text, { strategy, maxTokens, overlapTokens, mimeType }) => Chunk[]
   *
   * Idempotent + pure: no DB / network / file IO.
   */
  chunkDocument(text: string, opts: ChunkOptions = {}): SharedChunk[] {
    if (!text || !text.trim()) return [];

    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
    const overlapTokens = opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
    const chunkSizeChars = maxTokens * CHARS_PER_TOKEN;
    const overlapChars = overlapTokens * CHARS_PER_TOKEN;

    const strategy = this.resolveStrategy(opts.strategy, opts.mimeType, opts.filename);

    let rawChunks: SharedChunk[];
    switch (strategy) {
      case 'markdown':
        rawChunks = this.chunkMarkdown(text, chunkSizeChars);
        break;
      case 'code':
        rawChunks = this.chunkCode(text, chunkSizeChars);
        break;
      case 'paragraph':
      default:
        rawChunks = this.chunkParagraphBased(text, chunkSizeChars);
        break;
    }

    return this.applyOverlapAndFilter(rawChunks, overlapChars);
  }

  /**
   * Convenience helper for callers that just want plain `{content,
   * pageNumber}` rows compatible with the legacy teacher
   * `DocumentChunk` shape. Page-number heuristic = count of `\f` form-
   * feeds before the chunk start, plus 1 (matches the old
   * `splitByParagraph`/`splitByFixedSize` behaviour close enough that
   * displayed citations don't shift).
   */
  chunkDocumentWithPages(
    text: string,
    opts: ChunkOptions = {},
  ): Array<{ content: string; pageNumber: number | null }> {
    const chunks = this.chunkDocument(text, opts);
    return chunks.map((c) => ({
      content: c.content,
      pageNumber: c.pageNumber ?? this.estimatePageNumber(text, c.metadata.charStart),
    }));
  }

  // ─── Strategy resolution ───────────────────────────────────

  private resolveStrategy(
    explicit: ChunkStrategy | undefined,
    mimeType: string | undefined,
    filename: string | undefined,
  ): Exclude<ChunkStrategy, 'auto'> {
    if (explicit && explicit !== 'auto') return explicit;

    const mt = (mimeType || '').toLowerCase();
    if (MARKDOWN_MIME.has(mt)) return 'markdown';
    if (CODE_MIME_PREFIXES.some((p) => mt.startsWith(p))) return 'code';
    if (mt === 'application/json') return 'code';

    if (filename) {
      const lower = filename.toLowerCase();
      if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
      if (
        lower.endsWith('.js') ||
        lower.endsWith('.ts') ||
        lower.endsWith('.tsx') ||
        lower.endsWith('.jsx') ||
        lower.endsWith('.py') ||
        lower.endsWith('.java') ||
        lower.endsWith('.cpp') ||
        lower.endsWith('.c') ||
        lower.endsWith('.cs') ||
        lower.endsWith('.go') ||
        lower.endsWith('.rb') ||
        lower.endsWith('.rs') ||
        lower.endsWith('.json')
      ) {
        return 'code';
      }
    }

    return 'paragraph';
  }

  // ─── Markdown ──────────────────────────────────────────────

  private chunkMarkdown(text: string, chunkSizeChars: number): SharedChunk[] {
    const chunks: SharedChunk[] = [];
    const sections = text.split(/(?=^#{1,3}\s)/m);
    let chunkIndex = 0;
    let runningOffset = 0;

    for (const section of sections) {
      if (!section.trim()) {
        runningOffset += section.length;
        continue;
      }

      const headingMatch = section.match(/^(#{1,3})\s+(.+)$/m);
      const heading = headingMatch?.[2]?.trim();
      const isHeader = !!headingMatch;
      const charStart = runningOffset;
      runningOffset += section.length;

      if (section.length <= chunkSizeChars) {
        chunks.push({
          content: section.trim(),
          chunkIndex: chunkIndex++,
          metadata: {
            heading,
            isHeader,
            charStart,
            charEnd: charStart + section.length,
          },
        });
      } else {
        const subChunks = this.splitByParagraphsAndSentences(
          section,
          chunkSizeChars,
          charStart,
          heading,
        );
        for (const sub of subChunks) {
          sub.chunkIndex = chunkIndex++;
          chunks.push(sub);
        }
      }
    }

    return chunks;
  }

  // ─── Code ──────────────────────────────────────────────────

  private chunkCode(text: string, chunkSizeChars: number): SharedChunk[] {
    const langMatch = text.match(/^```(\w+)/);
    const codeLanguage = langMatch?.[1];
    const codeText = text.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');

    if (codeText.length <= chunkSizeChars) {
      return [
        {
          content: codeText.trim(),
          chunkIndex: 0,
          metadata: {
            codeLanguage,
            charStart: 0,
            charEnd: codeText.length,
          },
        },
      ];
    }

    const boundaries = this.findCodeBoundaries(codeText);
    if (boundaries.length === 0) {
      return this.chunkParagraphBased(codeText, chunkSizeChars);
    }

    const chunks: SharedChunk[] = [];
    let chunkIndex = 0;
    for (const boundary of boundaries) {
      const content = boundary.content.trim();
      if (content.length <= chunkSizeChars) {
        chunks.push({
          content,
          chunkIndex: chunkIndex++,
          metadata: {
            codeLanguage,
            section: boundary.name,
            charStart: boundary.start,
            charEnd: boundary.end,
          },
        });
      } else {
        const lineChunks = this.splitByLines(content, chunkSizeChars, boundary.start);
        for (const lc of lineChunks) {
          lc.metadata.codeLanguage = codeLanguage;
          lc.chunkIndex = chunkIndex++;
          chunks.push(lc);
        }
      }
    }
    return chunks;
  }

  private findCodeBoundaries(
    code: string,
  ): Array<{ name: string; content: string; start: number; end: number }> {
    const boundaries: Array<{
      name: string;
      content: string;
      start: number;
      end: number;
    }> = [];

    const patterns = [
      /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=)/gm,
      /^(?:async\s+)?(?:def|class)\s+(\w+)/gm,
      /^(?:public|private|protected|static|\s)*(?:func|void|int|string|bool|class)\s+(\w+)/gm,
    ];

    const lines = code.split('\n');
    const lineStarts: number[] = [];
    let pos = 0;
    for (const line of lines) {
      lineStarts.push(pos);
      pos += line.length + 1;
    }

    const defLines: Array<{ lineIndex: number; name: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.match(/^\s{2,}/) && !line.match(/^export/)) continue;
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          const name = match[1] || match[2] || match[3] || 'unknown';
          defLines.push({ lineIndex: i, name });
          break;
        }
      }
    }

    if (defLines.length === 0) return [];

    for (let i = 0; i < defLines.length; i++) {
      const startLine = defLines[i]!.lineIndex;
      const endLine = i < defLines.length - 1 ? defLines[i + 1]!.lineIndex : lines.length;
      const start = lineStarts[startLine]!;
      const end = endLine < lineStarts.length ? lineStarts[endLine]! : code.length;
      const content = code.slice(start, end);
      boundaries.push({ name: defLines[i]!.name, content, start, end });
    }

    if (defLines[0]!.lineIndex > 0) {
      const leadContent = code.slice(0, lineStarts[defLines[0]!.lineIndex]!);
      if (leadContent.trim()) {
        boundaries.unshift({
          name: 'imports',
          content: leadContent,
          start: 0,
          end: lineStarts[defLines[0]!.lineIndex]!,
        });
      }
    }

    return boundaries;
  }

  private splitByLines(
    text: string,
    chunkSizeChars: number,
    baseOffset: number,
  ): SharedChunk[] {
    const chunks: SharedChunk[] = [];
    const lines = text.split('\n');
    let currentChunk = '';
    let chunkStart = baseOffset;
    let chunkIndex = 0;

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > chunkSizeChars && currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          metadata: { charStart: chunkStart, charEnd: chunkStart + currentChunk.length },
        });
        chunkStart += currentChunk.length;
        currentChunk = '';
      }
      currentChunk += (currentChunk ? '\n' : '') + line;
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        metadata: { charStart: chunkStart, charEnd: chunkStart + currentChunk.length },
      });
    }

    return chunks;
  }

  // ─── Paragraph (default) ───────────────────────────────────

  private chunkParagraphBased(text: string, chunkSizeChars: number): SharedChunk[] {
    const chunks: SharedChunk[] = [];
    const paragraphs = text.split(/\n\s*\n/);
    let chunkIndex = 0;
    let currentChunk = '';
    let chunkStart = 0;
    let offset = 0;

    for (const para of paragraphs) {
      const paraWithSep = para + '\n\n';

      if (currentChunk.length + para.length > chunkSizeChars && currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          metadata: { charStart: chunkStart, charEnd: chunkStart + currentChunk.length },
        });
        chunkStart = offset;
        currentChunk = '';
      }

      if (para.length > chunkSizeChars) {
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            chunkIndex: chunkIndex++,
            metadata: { charStart: chunkStart, charEnd: chunkStart + currentChunk.length },
          });
          currentChunk = '';
        }

        const sentenceChunks = this.splitBySentences(para, chunkSizeChars, offset);
        for (const sc of sentenceChunks) {
          sc.chunkIndex = chunkIndex++;
          chunks.push(sc);
        }
        chunkStart = offset + para.length + 2;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }

      offset += paraWithSep.length;
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        metadata: { charStart: chunkStart, charEnd: chunkStart + currentChunk.length },
      });
    }

    return chunks;
  }

  private splitByParagraphsAndSentences(
    text: string,
    chunkSizeChars: number,
    baseOffset: number,
    heading?: string,
  ): SharedChunk[] {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: SharedChunk[] = [];
    let currentChunk = '';
    let chunkStart = baseOffset;
    let offset = baseOffset;
    let chunkIndex = 0;

    for (const para of paragraphs) {
      if (currentChunk.length + para.length > chunkSizeChars && currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          metadata: { heading, charStart: chunkStart, charEnd: offset },
        });
        chunkStart = offset;
        currentChunk = '';
      }

      if (para.length > chunkSizeChars) {
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            chunkIndex: chunkIndex++,
            metadata: { heading, charStart: chunkStart, charEnd: offset },
          });
          currentChunk = '';
        }
        const sentenceChunks = this.splitBySentences(para, chunkSizeChars, offset);
        for (const sc of sentenceChunks) {
          sc.metadata.heading = heading;
          sc.chunkIndex = chunkIndex++;
          chunks.push(sc);
        }
        chunkStart = offset + para.length + 2;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }

      offset += para.length + 2;
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        metadata: { heading, charStart: chunkStart, charEnd: offset },
      });
    }

    return chunks;
  }

  private splitBySentences(
    text: string,
    chunkSizeChars: number,
    baseOffset: number,
  ): SharedChunk[] {
    const chunks: SharedChunk[] = [];
    const sentences = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
    let currentChunk = '';
    let chunkStart = baseOffset;
    let chunkIndex = 0;
    let offset = baseOffset;

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > chunkSizeChars && currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          metadata: { charStart: chunkStart, charEnd: offset },
        });
        chunkStart = offset;
        currentChunk = '';
      }
      currentChunk += sentence;
      offset += sentence.length;
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        metadata: { charStart: chunkStart, charEnd: offset },
      });
    }

    return chunks;
  }

  // ─── Overlap + minimum-size filter ─────────────────────────

  private applyOverlapAndFilter(chunks: SharedChunk[], overlapChars: number): SharedChunk[] {
    const result: SharedChunk[] = [];
    let finalIndex = 0;
    const stripSurrogates = (s: string) => s.replace(/[\uD800-\uDFFF]/g, '�');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      if (chunk.content.length < MIN_CHUNK_SIZE) continue;

      let content = chunk.content;
      if (i > 0 && overlapChars > 0) {
        const prev = chunks[i - 1]!;
        const overlapText = prev.content.slice(-overlapChars);
        if (overlapText.trim()) {
          content = overlapText + '\n' + content;
        }
      }

      result.push({
        ...chunk,
        content: stripSurrogates(content),
        chunkIndex: finalIndex++,
      });
    }

    return result;
  }

  // ─── Page heuristic ────────────────────────────────────────

  private estimatePageNumber(fullText: string, charStart: number): number {
    if (charStart <= 0) return 1;
    // \f form-feed = PDF page break in the extracted text stream.
    const before = fullText.slice(0, charStart);
    const breaks = (before.match(/\f/g) || []).length;
    return 1 + breaks;
  }
}
