export interface GeneratePracticeTestDto {
  selectedText: string;
  courseId: string;
  contentId?: string;
  pageType?: string;
  questionCount?: number; // default 5, min 1, max 10
}

export interface SubmitPracticeTestAnswersDto {
  answers: Array<{
    questionIndex: number;
    answer: string;
  }>;
}
