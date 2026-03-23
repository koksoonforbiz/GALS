import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../rag/llm.service';

export interface ParsedDocument {
  text: string;
  pageCount?: number;
  metadata: {
    title?: string;
    language?: string;
    codeLanguage?: string;
    hasImages?: boolean;
  };
}

const CODE_EXTENSIONS: Record<string, string> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'c',
  '.cs': 'csharp',
  '.go': 'go',
  '.rb': 'ruby',
  '.php': 'php',
  '.rs': 'rust',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.r': 'r',
  '.R': 'r',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.json': 'json',
  '.xml': 'xml',
};

const CODE_MIME_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'text/x-python',
  'text/x-java',
  'text/x-c',
  'text/x-c++',
  'text/x-csharp',
  'text/x-go',
  'text/x-ruby',
  'text/x-php',
  'text/x-rust',
  'text/x-swift',
  'text/x-kotlin',
  'text/x-scala',
  'text/x-sql',
  'text/x-shellscript',
  'text/html',
  'text/css',
  'application/json',
  'application/xml',
  'text/xml',
  'text/x-yaml',
]);

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  constructor(private readonly llmService: LlmService) {}

  async parse(buffer: Buffer, mimeType: string, fileName: string): Promise<ParsedDocument> {
    if (mimeType === 'application/pdf') {
      return this.parsePdf(buffer, fileName);
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return this.parseDocx(buffer, fileName);
    }

    if (mimeType === 'text/plain') {
      return this.parsePlainText(buffer, fileName);
    }

    if (mimeType === 'text/markdown') {
      return this.parseMarkdown(buffer, fileName);
    }

    if (IMAGE_MIME_TYPES.has(mimeType)) {
      return this.parseImage(buffer, mimeType, fileName);
    }

    if (CODE_MIME_TYPES.has(mimeType) || this.isCodeFile(fileName)) {
      return this.parseCodeFile(buffer, fileName);
    }

    // Fallback: try UTF-8 text decode
    this.logger.warn(`Unknown MIME type "${mimeType}" for ${fileName}, attempting text decode`);
    return this.parsePlainText(buffer, fileName);
  }

  private async parsePdf(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(buffer) });

    try {
      const textResult = await parser.getText();
      let info;
      try {
        info = await parser.getInfo();
      } catch {
        // Info extraction may fail for some PDFs
      }

      return {
        text: textResult.text,
        pageCount: textResult.total,
        metadata: {
          title: info?.info?.Title || this.extractTitleFromFileName(fileName),
          language: undefined,
          hasImages: false,
        },
      };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  private async parseDocx(buffer: Buffer, fileName: string): Promise<ParsedDocument> {
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });

    return {
      text: result.value,
      metadata: {
        title: this.extractTitleFromFileName(fileName),
        language: undefined,
        hasImages: false,
      },
    };
  }

  private parsePlainText(buffer: Buffer, fileName: string): ParsedDocument {
    const text = buffer.toString('utf-8');
    return {
      text,
      metadata: {
        title: this.extractTitleFromFileName(fileName),
        language: undefined,
      },
    };
  }

  private parseMarkdown(buffer: Buffer, fileName: string): ParsedDocument {
    const text = buffer.toString('utf-8');

    // Try to extract title from first heading
    const headingMatch = text.match(/^#\s+(.+)$/m);
    const title = headingMatch?.[1] || this.extractTitleFromFileName(fileName);

    return {
      text,
      metadata: {
        title,
        language: undefined,
        hasImages: text.includes('!['),
      },
    };
  }

  private async parseImage(
    _buffer: Buffer,
    _mimeType: string,
    fileName: string,
  ): Promise<ParsedDocument> {
    try {
      // For image OCR, we return a placeholder that will be processed
      // during the pipeline via parseImageWithVision() which has user credentials.
      return {
        text: `[Image: ${fileName}]\n\nThis image requires OCR processing via LLM vision capabilities.`,
        metadata: {
          title: this.extractTitleFromFileName(fileName),
          hasImages: true,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to parse image ${fileName}`, error);
      return {
        text: `[Image: ${fileName}] - Unable to extract text from image.`,
        metadata: {
          title: this.extractTitleFromFileName(fileName),
          hasImages: true,
        },
      };
    }
  }

  /**
   * Parse image with LLM vision - called from the processing pipeline
   * where we have access to a user's API credentials.
   */
  async parseImageWithVision(
    buffer: Buffer,
    mimeType: string,
    fileName: string,
    teacherUserId: string,
    courseId: string,
  ): Promise<ParsedDocument> {
    const base64 = buffer.toString('base64');

    const systemPrompt =
      'You are an OCR and image analysis assistant. Extract all visible text from the image. ' +
      'Also describe any diagrams, charts, tables, or visual content. Return the text in a structured format.';

    const userPrompt =
      `Analyze the following base64-encoded image and extract all text content.\n\n` +
      `Image (base64, ${mimeType}): ${base64}\n\n` +
      `File name: ${fileName}\n\n` +
      `Please extract:\n1. All visible text\n2. Description of any diagrams or charts\n3. Table content if any`;

    try {
      const result = await this.llmService.callLlmForUser(teacherUserId, systemPrompt, userPrompt, {
        feature: 'image_ocr',
        courseId,
      });

      return {
        text: result.content,
        metadata: {
          title: this.extractTitleFromFileName(fileName),
          hasImages: true,
        },
      };
    } catch (error) {
      this.logger.error(`LLM vision OCR failed for ${fileName}`, error);
      return {
        text: `[Image: ${fileName}] - OCR extraction failed.`,
        metadata: {
          title: this.extractTitleFromFileName(fileName),
          hasImages: true,
        },
      };
    }
  }

  private parseCodeFile(buffer: Buffer, fileName: string): ParsedDocument {
    const text = buffer.toString('utf-8');
    const ext = this.getExtension(fileName);
    const codeLanguage = CODE_EXTENSIONS[ext] || 'unknown';

    // Wrap in code fence markers for context
    const wrappedText = `\`\`\`${codeLanguage}\n${text}\n\`\`\``;

    return {
      text: wrappedText,
      metadata: {
        title: this.extractTitleFromFileName(fileName),
        codeLanguage,
      },
    };
  }

  private isCodeFile(fileName: string): boolean {
    const ext = this.getExtension(fileName);
    return ext in CODE_EXTENSIONS;
  }

  private getExtension(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    if (lastDot === -1) return '';
    return fileName.slice(lastDot).toLowerCase();
  }

  private extractTitleFromFileName(fileName: string): string {
    const lastDot = fileName.lastIndexOf('.');
    const name = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
    return name.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  }
}
