export interface GenerateStudioDto {
  type: 'BRIEFING_DOC' | 'FLASHCARD_SET' | 'TABLE_COMPARISON' | 'MIND_MAP' | 'TIMELINE' | 'FAQ';
  sourceIds: string[];
  promptHint?: string;
  sessionId?: string;
}
