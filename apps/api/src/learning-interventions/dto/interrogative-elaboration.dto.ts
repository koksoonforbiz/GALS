export interface GenerateElaborationDto {
  selectedText: string; // min 20 chars
  courseId: string;
  contentId?: string;
  pageType?: string;
  questionCount?: number; // default 4, min 2, max 8
}

export interface SubmitElaborationDto {
  questionIndex: number;
  elaboration: string; // min 50 chars
}
