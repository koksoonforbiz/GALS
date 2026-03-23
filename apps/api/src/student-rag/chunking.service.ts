import { Injectable } from '@nestjs/common';
import { StudentFileType } from '@prisma/client';

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

const MIN_CHUNK_SIZE = 50;
const CHARS_PER_TOKEN = 4; // rough approximation

@Injectable()
export class ChunkingService {
  chunk(text: string, options: ChunkOptions, fileType: StudentFileType): TextChunk[] {
    const chunkSizeChars = options.chunkSize * CHARS_PER_TOKEN;
    const overlapChars = options.chunkOverlap * CHARS_PER_TOKEN;

    let rawChunks: TextChunk[];

    switch (fileType) {
      case 'MD':
        rawChunks = this.chunkMarkdown(text, chunkSizeChars);
        break;
      case 'CODE':
        rawChunks = this.chunkCode(text, chunkSizeChars);
        break;
      case 'PDF':
      case 'DOCX':
      case 'DOC':
        rawChunks = this.chunkParagraphBased(text, chunkSizeChars);
        break;
      case 'TXT':
        rawChunks = this.chunkParagraphBased(text, chunkSizeChars);
        break;
      case 'IMAGE_PNG':
      case 'IMAGE_JPG':
      case 'IMAGE_WEBP':
        rawChunks = this.chunkParagraphBased(text, chunkSizeChars);
        break;
      default:
        rawChunks = this.chunkParagraphBased(text, chunkSizeChars);
    }

    // Apply overlap and filter short chunks
    return this.applyOverlapAndFilter(rawChunks, overlapChars);
  }

  // ─── Markdown chunking ──────────────────────────────────────

  private chunkMarkdown(text: string, chunkSizeChars: number): TextChunk[] {
    const chunks: TextChunk[] = [];
    // Split on headings
    const sections = text.split(/(?=^#{1,3}\s)/m);
    let chunkIndex = 0;

    for (const section of sections) {
      if (!section.trim()) continue;

      const headingMatch = section.match(/^(#{1,3})\s+(.+)$/m);
      const heading = headingMatch?.[2]?.trim();
      const isHeader = !!headingMatch;

      if (section.length <= chunkSizeChars) {
        const charStart = text.indexOf(section);
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
        // Recursively split oversized sections by paragraphs, then sentences
        const subChunks = this.splitByParagraphsAndSentences(
          section,
          chunkSizeChars,
          text.indexOf(section),
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

  // ─── Code chunking ──────────────────────────────────────────

  private chunkCode(text: string, chunkSizeChars: number): TextChunk[] {
    // Detect language from code fence
    const langMatch = text.match(/^```(\w+)/);
    const codeLanguage = langMatch?.[1];

    // Strip code fences if present
    const codeText = text.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');

    // If under chunk size, use entire file as one chunk
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

    // Split by top-level function/class definitions
    const chunks: TextChunk[] = [];
    const boundaries = this.findCodeBoundaries(codeText);

    if (boundaries.length === 0) {
      // No recognizable boundaries, fall back to paragraph-based
      return this.chunkParagraphBased(codeText, chunkSizeChars);
    }

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
        // Very long function - split by lines
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

    // Regex patterns for common language constructs
    const patterns = [
      // JavaScript/TypeScript: function, class, const/let/var arrow functions, export
      /^(?:export\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=)/gm,
      // Python: def, class
      /^(?:async\s+)?(?:def|class)\s+(\w+)/gm,
      // Java/C#/Go: public/private/protected/func
      /^(?:public|private|protected|static|\s)*(?:func|void|int|string|bool|class)\s+(\w+)/gm,
    ];

    const lines = code.split('\n');
    const lineStarts: number[] = [];
    let pos = 0;
    for (const line of lines) {
      lineStarts.push(pos);
      pos += line.length + 1;
    }

    // Find all top-level definitions
    const defLines: Array<{ lineIndex: number; name: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip indented lines (not top-level)
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

    // Build chunks between definitions
    for (let i = 0; i < defLines.length; i++) {
      const startLine = defLines[i]!.lineIndex;
      const endLine = i < defLines.length - 1 ? defLines[i + 1]!.lineIndex : lines.length;
      const start = lineStarts[startLine]!;
      const end = endLine < lineStarts.length ? lineStarts[endLine]! : code.length;
      const content = code.slice(start, end);

      boundaries.push({
        name: defLines[i]!.name,
        content,
        start,
        end,
      });
    }

    // Add any leading content before first definition
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

  private splitByLines(text: string, chunkSizeChars: number, baseOffset: number): TextChunk[] {
    const chunks: TextChunk[] = [];
    const lines = text.split('\n');
    let currentChunk = '';
    let chunkStart = baseOffset;
    let chunkIndex = 0;

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > chunkSizeChars && currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          metadata: {
            charStart: chunkStart,
            charEnd: chunkStart + currentChunk.length,
          },
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
        metadata: {
          charStart: chunkStart,
          charEnd: chunkStart + currentChunk.length,
        },
      });
    }

    return chunks;
  }

  // ─── Paragraph-based chunking ───────────────────────────────

  private chunkParagraphBased(text: string, chunkSizeChars: number): TextChunk[] {
    const chunks: TextChunk[] = [];
    // Split by double newlines (paragraphs)
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
          metadata: {
            charStart: chunkStart,
            charEnd: chunkStart + currentChunk.length,
          },
        });
        chunkStart = offset;
        currentChunk = '';
      }

      if (para.length > chunkSizeChars) {
        // Flush current chunk first
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            chunkIndex: chunkIndex++,
            metadata: {
              charStart: chunkStart,
              charEnd: chunkStart + currentChunk.length,
            },
          });
          currentChunk = '';
        }

        // Split by sentences
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
        metadata: {
          charStart: chunkStart,
          charEnd: chunkStart + currentChunk.length,
        },
      });
    }

    return chunks;
  }

  // ─── Helpers ────────────────────────────────────────────────

  private splitByParagraphsAndSentences(
    text: string,
    chunkSizeChars: number,
    baseOffset: number,
    heading?: string,
  ): TextChunk[] {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: TextChunk[] = [];
    let currentChunk = '';
    let chunkStart = baseOffset;
    let offset = baseOffset;
    let chunkIndex = 0;

    for (const para of paragraphs) {
      if (currentChunk.length + para.length > chunkSizeChars && currentChunk.trim()) {
        chunks.push({
          content: currentChunk.trim(),
          chunkIndex: chunkIndex++,
          metadata: {
            heading,
            charStart: chunkStart,
            charEnd: offset,
          },
        });
        chunkStart = offset;
        currentChunk = '';
      }

      if (para.length > chunkSizeChars) {
        if (currentChunk.trim()) {
          chunks.push({
            content: currentChunk.trim(),
            chunkIndex: chunkIndex++,
            metadata: {
              heading,
              charStart: chunkStart,
              charEnd: offset,
            },
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

      offset += para.length + 2; // +2 for \n\n
    }

    if (currentChunk.trim()) {
      chunks.push({
        content: currentChunk.trim(),
        chunkIndex: chunkIndex++,
        metadata: {
          heading,
          charStart: chunkStart,
          charEnd: offset,
        },
      });
    }

    return chunks;
  }

  private splitBySentences(text: string, chunkSizeChars: number, baseOffset: number): TextChunk[] {
    const chunks: TextChunk[] = [];
    // Simple sentence splitter: split on . ! ? followed by space or end
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
          metadata: {
            charStart: chunkStart,
            charEnd: offset,
          },
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
        metadata: {
          charStart: chunkStart,
          charEnd: offset,
        },
      });
    }

    return chunks;
  }

  private applyOverlapAndFilter(chunks: TextChunk[], overlapChars: number): TextChunk[] {
    const result: TextChunk[] = [];
    let finalIndex = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;

      // Skip chunks shorter than minimum
      if (chunk.content.length < MIN_CHUNK_SIZE) continue;

      let content = chunk.content;

      // Add overlap from previous chunk
      if (i > 0 && overlapChars > 0) {
        const prev = chunks[i - 1]!;
        const overlapText = prev.content.slice(-overlapChars);
        if (overlapText.trim()) {
          content = overlapText + '\n' + content;
        }
      }

      result.push({
        ...chunk,
        content,
        chunkIndex: finalIndex++,
      });
    }

    return result;
  }
}
