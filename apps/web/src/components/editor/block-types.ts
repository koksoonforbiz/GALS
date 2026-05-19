/**
 * Block-based lesson content data model.
 * Stored as JSON string in ModuleItem.contentMdx.
 */

export type BlockType = 'text' | 'image' | 'video' | 'diagram' | 'callout' | 'divider';

// ─── Block Data Types ─────────────────────────────────

export interface TextBlockData {
  html: string;
}

export interface ImageBlockData {
  src: string; // URL or blob key
  caption: string;
  alt: string;
  size: 'small' | 'medium' | 'full';
  align: 'left' | 'center' | 'right';
}

export interface VideoBlockData {
  url: string; // YouTube / Vimeo URL
  startTime: number; // seconds, 0 = beginning
}

export interface DiagramBlockData {
  code: string; // Mermaid syntax
}

export type CalloutVariant = 'tip' | 'warning' | 'exam-hint' | 'common-mistake';

export interface CalloutBlockData {
  variant: CalloutVariant;
  html: string;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DividerBlockData {}

// ─── Block Union ──────────────────────────────────────

export type BlockDataMap = {
  text: TextBlockData;
  image: ImageBlockData;
  video: VideoBlockData;
  diagram: DiagramBlockData;
  callout: CalloutBlockData;
  divider: DividerBlockData;
};

export interface BlockMetadata {
  generatedBy?: 'ai' | 'human';
  generationJobId?: string;
  editedAt?: string; // ISO timestamp of last human edit
}

export interface Block<T extends BlockType = BlockType> {
  id: string;
  type: T;
  data: BlockDataMap[T];
  metadata?: BlockMetadata;
}

// ─── Document Envelope ────────────────────────────────

export interface BlockDocument {
  version: 2;
  blocks: Block[];
}

// ─── Helpers ──────────────────────────────────────────

let _counter = 0;

export function genBlockId(): string {
  return `blk_${Date.now().toString(36)}_${(++_counter).toString(36)}`;
}

export function createBlock<T extends BlockType>(type: T, data?: Partial<BlockDataMap[T]>): Block<T> {
  const defaults: Record<BlockType, unknown> = {
    text: { html: '' } satisfies TextBlockData,
    image: { src: '', caption: '', alt: '', size: 'medium', align: 'center' } satisfies ImageBlockData,
    video: { url: '', startTime: 0 } satisfies VideoBlockData,
    diagram: { code: 'graph TD\n  A --> B' } satisfies DiagramBlockData,
    callout: { variant: 'tip', html: '' } satisfies CalloutBlockData,
    divider: {} satisfies DividerBlockData,
  };

  return {
    id: genBlockId(),
    type,
    data: { ...(defaults[type] as BlockDataMap[T]), ...data },
  };
}

/**
 * Parse contentMdx into a BlockDocument.
 * Handles:
 *  - null/empty → empty blocks
 *  - JSON (version: 2) → block document
 *  - Legacy HTML/text → single text block migration
 */
export function parseBlockDocument(raw: string | null): BlockDocument {
  if (!raw || !raw.trim()) {
    return { version: 2, blocks: [] };
  }

  // Try to parse as JSON block document
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 2 && Array.isArray(parsed.blocks)) {
      return parsed as BlockDocument;
    }
  } catch {
    // Not JSON — treat as legacy content
  }

  // Legacy: wrap existing HTML/text in a single text block
  return {
    version: 2,
    blocks: [createBlock('text', { html: raw })],
  };
}

export function serializeBlockDocument(doc: BlockDocument): string {
  return JSON.stringify(doc);
}
